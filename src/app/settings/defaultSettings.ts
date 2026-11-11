
import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { DEFAULT_REASONING_VALUE } from '../../core/providers/reasoning';
import { type ClaudianSettings, DEFAULT_ASSISTANT_NAME } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_CLAUDIAN_SETTINGS: ClaudianSettings = {
  userName: '',

  permissionMode: 'yolo',

  model: 'haiku',
  thinkingBudget: 'off',
  effortLevel: DEFAULT_REASONING_VALUE,
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationLocale: '',
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,
  showAriWidget: false,
  assistantName: DEFAULT_ASSISTANT_NAME,
  showAvatarBadge: true,
  accountSwitcherEnabled: false,
  accountsPanelUrl: 'http://127.0.0.1:7788',
  accountsPanelManaged: true,
  telegramBridgeEnabled: false,
  telegramBridgeMode: 'builtin',
  telegramBridgeDir: '',
  voiceName: 'pl_PL-gosia-medium',
  whisperModel: 'large-v3-turbo',
  promptSuggestions: true,
  promptSuggestionsLocal: false,

  locale: 'en',
  lastPlanRateLimits: null,

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'claude',
  lastSelectedChatModel: null,
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},
  pendingProviderSessionInvalidations: {},

  lastCustomModel: '',

  maxWarmAgentProcesses: 5,
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  sessionAutoArchiveAfter: 'off',
  chatViewPlacement: 'right-sidebar',
  enableDualPane: true,
  dualPaneSide: 'right',
  restoreTabsOnStartup: true,
  sessionManagerOrganization: 'list',
  sessionManagerSort: 'last-updated',
  pinnedLinkedContentPaths: [],
  projects: [],

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
