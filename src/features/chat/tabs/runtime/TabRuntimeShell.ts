import { Notice } from 'obsidian';

import type { ProviderInteractionPort } from '../../../../core/execution';
import { resolveNewConversationModel } from '../../../../core/providers/conversationModel';
import { getEnabledProviderForModel } from '../../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../../core/providers/types';
import { t } from '../../../../i18n/i18n';
import { getCurrentAccountId } from '../../../../utils/claudeAccount';
import { getVaultPath } from '../../../../utils/path';
import { ChatExecutionCoordinator } from '../../execution/ChatExecutionCoordinator';
import { cleanupThinkingBlock } from '../../rendering/ThinkingBlockRenderer';
import { createWelcomeElement } from '../../rendering/WelcomeRenderer';
import { GoalStatusTracker } from '../../services/goalStatus';
import { formatResumeTime, resolveLimitWait } from '../../services/limitWait';
import { notifyTurn } from '../../services/TurnNotifier';
import { ChatState } from '../../state/ChatState';
import { placeholderFor } from '../../ui/promptSuggestion';
import { restorePrePlanMode } from '../TabProviderState';
import { TabSession } from '../TabSession';
import {
  createTabMessageId,
  enqueueTabSessionEvent,
} from '../TabSessionEvents';
import type { TabDOMElements, TabId, TabProviderCatalogContext } from '../types';
import { generateTabId } from '../types';
import type {
  PublishedTabRuntimeRef,
  TabRuntimeConstructionContext,
  TabRuntimeShellBundle,
} from './TabRuntimeConstruction';

export function buildTabRuntimeShell(
  options: TabRuntimeConstructionContext,
  runtimeRef: PublishedTabRuntimeRef,
): TabRuntimeShellBundle {
  const { plugin, conversation } = options;
  const id = options.tabId ?? generateTabId();
  const contentEl = options.containerEl.createDiv({
    cls: 'claudian-tab-content claudian-hidden',
  });
  options.registerCleanup('tab DOM root', () => contentEl.remove());

  const dom = buildTabDOM(contentEl);
  // Panel celu `/goal`: przed ChatState, bo jej zdarzenia go odswiezaja; do opublikowania karty nic nie robi.
  const goalTracker = new GoalStatusTracker();
  const refreshGoal = (): void => {
    const tab = runtimeRef.current();
    if (!tab) return;
    const sessionId = tab.executionCoordinator.snapshot?.providerSessionId ?? null;
    const vaultPath = getVaultPath(plugin.app);
    const sessionPath = sessionId && vaultPath
      ? ProviderRegistry.getConversationHistoryService(tab.providerId)
        .getSessionFilePath?.(sessionId, vaultPath) ?? null
      : null;
    void goalTracker.refresh(sessionPath).then(goal => tab.ui.statusPanel.updateGoal(goal));
  };
  // Karta „Limit sesji · wznowie o …”: tylko w trakcie tury; po resecie sprawdzamy jeszcze raz.
  let limitWaitTimer: number | null = null;
  const refreshLimitWait = (): void => {
    const tab = runtimeRef.current();
    if (!tab) return;
    if (limitWaitTimer !== null) {
      window.clearTimeout(limitWaitTimer);
      limitWaitTimer = null;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const wait = tab.state.isStreaming
      ? resolveLimitWait(tab.state.planRateLimits, tab.state.limitRetryAt, nowSeconds)
      : null;
    const label = wait ? (wait.resumesAt !== null ? formatResumeTime(wait.resumesAt) : '') : null;
    tab.state.limitWaitLabel = label;
    tab.ui.statusPanel.updateLimitWait(label, () => tab.controllers.inputController.cancelStreaming());
    if (wait?.resumesAt != null) {
      limitWaitTimer = window.setTimeout(refreshLimitWait, (wait.resumesAt - nowSeconds + 5) * 1000);
    }
  };
  options.registerCleanup('limit wait timer', () => {
    if (limitWaitTimer !== null) window.clearTimeout(limitWaitTimer);
  });
  const state = new ChatState({
    onStreamingStateChanged: isStreaming => {
      options.onStreamingChanged?.(runtimeRef.requirePublished(), isStreaming);
      if (!isStreaming) state.limitRetryAt = null;
      refreshLimitWait();
      // Pasek zadan: pomaranczowa kropka, gdy Ari pracuje, a Obsidian jest w tle.
      // Start tury to `thinking`, nie `working`: model rozumuje, zanim cokolwiek
      // wysle, a pierwszy fragment i tak zaraz przestawi stan na wlasciwy.
      // Zmierzone 13.09: bloki myslenia z SDK sa w 91% PUSTE (464 z 512 — model
      // zwraca sam podpis), wiec fragment `thinking` prawie nigdy nie dociera
      // i to okno jest jedynym uczciwym sygnalem „mysli".
      if (isStreaming) {
        notifyTurn({ kind: 'thinking' });
        // Sugestia opisuje stan sprzed tej tury — po jej starcie jest juz nieprawda.
        state.setPromptSuggestion(null);
      } else {
        // Sprawdzenie celu zapisuje sie po ostatnim usage tury, wiec dopiero tu jest w pliku.
        refreshGoal();
      }
    },
    onRewindingStateChanged: isRewinding => {
      options.onRewindingChanged?.(runtimeRef.requirePublished(), isRewinding);
    },
    onAttentionChanged: attention => {
      options.onAttentionChanged?.(runtimeRef.requirePublished(), attention);
      // Pytanie z opcjami, prosba o zgode, decyzja o planie — robota stoi, dopoki użytkownik nie odpowie.
      if (attention?.kind === 'action-required') notifyTurn({ kind: 'waiting' });
    },
    onConversationChanged: conversationId => {
      options.onConversationIdChanged?.(runtimeRef.requirePublished(), conversationId);
      refreshGoal();
    },
    onUsageChanged: usage => {
      const { ui } = runtimeRef.requirePublished();
      ui.planLimitsMeter.updateContext(usage);
      ui.cacheWarmthPill.update(usage, state.lastTurn);
      // Niespelniony cel wznawia prace w tej samej turze — kolejne sprawdzenia lapiemy po drodze.
      refreshGoal();
    },
    onLimitRetryChanged: () => refreshLimitWait(),
    onPlanRateLimitsChanged: limits => {
      runtimeRef.requirePublished().ui.planLimitsMeter.update(limits);
      refreshLimitWait();
      // Zapamietujemy, zeby po ponownym otwarciu pasek nie byl pusty do pierwszej
      // wymiany. Zapis tylko przy realnej zmianie — event potrafi sie powtarzac.
      // Stempel konta: po przelaczeniu w trakcie sesji zapamietane liczby naleza do
      // poprzedniego konta i pasek pokazywalby cudze zuzycie.
      const accountId = getCurrentAccountId();
      const stamped = limits && accountId ? { ...limits, accountId } : limits;
      const previous = plugin.settings.lastPlanRateLimits;
      if (JSON.stringify(previous ?? null) !== JSON.stringify(stamped ?? null)) {
        void plugin.mutateSettings(settings => {
          settings.lastPlanRateLimits = stamped;
        });
      }
    },
    onTodosChanged: todos => runtimeRef.requirePublished().ui.statusPanel.updateTodos(todos),
    onAutoScrollChanged: () => runtimeRef.requirePublished().ui.navigationSidebar.updateVisibility(),
    onPromptSuggestionChanged: suggestion => {
      // Placeholder, nie nakladka: widac go dokladnie wtedy, gdy pole jest puste.
      dom.inputEl.placeholder = placeholderFor(
        suggestion,
        t('chat.ui.inputPlaceholder'),
      );
    },
  });
  state.queueIndicatorEl = dom.queueIndicatorEl;

  options.registerCleanup('tab thinking state', () => {
    cleanupThinkingBlock(state.currentThinkingState);
    state.currentThinkingState = null;
  });

  const isBound = !!conversation?.id;
  const restoredDraftModel = typeof options.draftModel === 'string'
    ? options.draftModel.trim()
    : '';
  const newConversationModel = !isBound && !restoredDraftModel
    ? resolveNewConversationModel(plugin.settings)
    : null;
  const draftModel = isBound
    ? null
    : (restoredDraftModel || newConversationModel?.model || null);
  const initialProviderId = conversation?.providerId
    ?? newConversationModel?.providerId
    ?? (draftModel
      ? getEnabledProviderForModel(draftModel, plugin.settings)
      : DEFAULT_CHAT_PROVIDER_ID);
  const sessionState = {
    id,
    lifecycleState: options.lifecycleState ?? 'cold',
    draftModel,
    providerId: initialProviderId,
    conversationId: conversation?.id ?? null,
  };
  const executionCoordinator = createTabExecutionCoordinator(
    id,
    state,
    options,
    runtimeRef,
  );
  const session = new TabSession(
    sessionState,
    executionCoordinator,
    () => options.onWorkChanged?.(runtimeRef.requirePublished()),
  );
  options.registerCleanup(
    'tab execution coordinator',
    () => session.disposeExecutionCoordinator(),
  );
  const providerCatalogContext: TabProviderCatalogContext = Object.freeze({
    get id() {
      return session.id;
    },
    get lifecycleState() {
      return session.lifecycleState;
    },
    get draftModel() {
      return session.draftModel;
    },
    get providerId() {
      return session.providerId;
    },
    get conversationId() {
      return session.conversationId;
    },
  });

  return {
    session,
    get id() {
      return session.id;
    },
    get lifecycleState() {
      return session.lifecycleState;
    },
    set lifecycleState(value) {
      session.lifecycleState = value;
    },
    hydrationState: isBound ? 'idle' : 'ready',
    get draftModel() {
      return session.draftModel;
    },
    set draftModel(value) {
      session.draftModel = value;
    },
    get providerId() {
      return session.providerId;
    },
    set providerId(value) {
      session.providerId = value;
    },
    get conversationId() {
      return session.conversationId;
    },
    set conversationId(value) {
      session.conversationId = value;
    },
    executionCoordinator,
    providerCatalogResolver: () => options.getProviderCatalogConfig(providerCatalogContext),
    captureReviewableSettlement: options.captureReviewableSettlement
      ? outcome => options.captureReviewableSettlement!(runtimeRef.requirePublished(), outcome)
      : null,
    state,
    dom,
  };
}

function buildTabDOM(contentEl: HTMLElement): TabDOMElements {
  const messagesWrapperEl = contentEl.createDiv({ cls: 'claudian-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'claudian-messages' });
  const welcomeEl = createWelcomeElement(messagesEl);
  const statusPanelContainerEl = contentEl.createDiv({ cls: 'claudian-status-panel-container' });
  const inputComposerEl = contentEl.createDiv({ cls: 'claudian-input-composer' });
  const inputContainerEl = inputComposerEl.createDiv({ cls: 'claudian-input-container' });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'claudian-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'claudian-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'claudian-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'claudian-context-row' });
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'claudian-input',
    attr: {
      placeholder: t('chat.ui.inputPlaceholder'),
      rows: '3',
      dir: 'auto',
    },
  });

  return {
    contentEl,
    messagesWrapperEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputComposerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    inputEl,
    navRowEl,
    contextRowEl,
  };
}

function createTabExecutionCoordinator(
  id: TabId,
  state: ChatState,
  options: TabRuntimeConstructionContext,
  runtimeRef: PublishedTabRuntimeRef,
): ChatExecutionCoordinator {
  const { plugin } = options;
  const interactionKinds = new Map<
    string,
    'approval' | 'question' | 'plan-decision'
  >();
  const interactionPort: ProviderInteractionPort = {
    requestApproval: async (request) => {
      const tab = runtimeRef.requirePublished();
      interactionKinds.set(request.interactionId, request.kind);
      state.beginActionRequired(request.interactionId);
      try {
        const decision = await tab.controllers.inputController.handleApprovalRequest(
          request.toolName,
          { ...request.input },
          request.description,
          {
            ...(request.decisionReason ? { decisionReason: request.decisionReason } : {}),
            ...(request.blockedPath ? { blockedPath: request.blockedPath } : {}),
            ...(request.decisionOptions
              ? { decisionOptions: request.decisionOptions.map(option => ({ ...option })) }
              : {}),
            ...(request.additionalPermissions !== undefined
              ? { additionalPermissions: request.additionalPermissions }
              : {}),
          },
        );
        return { interactionId: request.interactionId, decision };
      } finally {
        interactionKinds.delete(request.interactionId);
        state.endActionRequired(request.interactionId);
      }
    },
    askUserQuestion: async (request, signal) => {
      const tab = runtimeRef.requirePublished();
      interactionKinds.set(request.interactionId, request.kind);
      state.beginActionRequired(request.interactionId);
      try {
        const answers = await tab.controllers.inputController.handleAskUserQuestion(
          { ...request.input },
          signal,
        );
        return { interactionId: request.interactionId, answers };
      } finally {
        interactionKinds.delete(request.interactionId);
        state.endActionRequired(request.interactionId);
      }
    },
    requestPlanDecision: async (request, signal) => {
      const tab = runtimeRef.requirePublished();
      interactionKinds.set(request.interactionId, request.kind);
      state.beginActionRequired(request.interactionId);
      try {
        const decision = await tab.controllers.inputController.handleExitPlanMode(
          { ...request.input },
          signal,
          request.presentation,
        );
        if (decision !== null && decision.type !== 'feedback') {
          await restorePrePlanMode(tab, plugin);
          if (decision.type === 'approve-new-session') {
            tab.state.pendingNewSessionPlan = decision.planContent;
            tab.state.cancelRequested = true;
          }
        }
        return { interactionId: request.interactionId, decision };
      } finally {
        interactionKinds.delete(request.interactionId);
        state.endActionRequired(request.interactionId);
      }
    },
    dismissInteraction: (interactionId) => {
      const tab = runtimeRef.requirePublished();
      const kind = interactionKinds.get(interactionId);
      if (kind) {
        tab.controllers.inputController.dismissProviderInteraction(kind);
        interactionKinds.delete(interactionId);
        state.endActionRequired(interactionId);
      }
    },
  };
  return new ChatExecutionCoordinator({
    lifecycleRegistry: plugin.providerHost.executionLifecycleRegistry,
    resolveBackend: providerId => ProviderRegistry.createExecutionBackend(
      plugin.providerHost,
      providerId,
    ),
    persistence: plugin.executionPersistence,
    interactionPort,
    vaultWorkingDirectory: getVaultPath(plugin.app) ?? '.',
    createId: createTabMessageId,
    onRequestedEvent: event => (
      runtimeRef.requirePublished().controllers.inputController.handleExecutionEvent(event)
    ),
    onSessionEvent: (event, context) => enqueueTabSessionEvent(
      runtimeRef.requirePublished(),
      plugin,
      event,
      context,
    ),
    onBackgroundWorkChanged: () => {
      options.onWorkChanged?.(runtimeRef.requirePublished());
    },
    resolveMissingProviderSession: (conversationId, missingProviderSessionId) =>
      plugin.handleMissingProviderSession(conversationId, missingProviderSessionId),
    onError: error => {
      new Notice(error instanceof Error ? error.message : 'Provider execution failed.');
    },
    warmExecution: {
      ownerId: id,
      pool: plugin.warmExecutionPool,
      canCool: () => {
        const tab = runtimeRef.requirePublished();
        return !state.isStreaming
          && !state.isRewinding
          && !state.requiresAction
          && tab.session.activeTurn === null
          && tab.lifecycleState !== 'closing';
      },
      onWarmStateChanged: (isWarm) => {
        const tab = runtimeRef.requirePublished();
        if (tab.lifecycleState === 'closing') return;
        tab.lifecycleState = isWarm ? 'warm' : 'cold';
      },
    },
  });
}
