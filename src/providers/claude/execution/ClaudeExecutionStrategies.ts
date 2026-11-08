import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { loadClaudeAgentQuery } from '../loadClaudeAgentSdk';
import { runColdStartQuery } from '../runtime/claudeColdStartQuery';
import { MessageChannel } from '../runtime/ClaudeMessageChannel';
import { buildClaudeSDKUserMessage } from '../runtime/ClaudeUserMessageFactory';
import type { ClaudeEncodedExecutionRequest } from './ClaudeExecutionRequestEncoder';
import { ClaudeTurnInputs, isSessionIdle } from './ClaudeTurnInputs';

export interface ClaudeExecutionStrategySink {
  readonly sessionInstanceId: string;
  getProviderSessionId(): string | null;
  setPendingNativeUserMessageId(
    nativeUserMessageId: string,
    queryToken: number,
  ): void;
  bindNativeTurnInputs(inputs: ClaudeTurnInputs, queryToken: number): void;
  markNativeTurnHandedOff(queryToken: number): void;
  handleNativeMessage(message: SDKMessage, queryToken: number): Promise<void>;
  handleNativeFailure(error: unknown, queryToken: number): void;
  handleNativeEnd(queryToken: number): void;
  releaseNativeTurnFence(queryToken: number): void;
  handleNativeQueryOpened(query: Query): void;
  handleNativeQueryClosed(query: Query): void;
  handleAuthoritativeContextWindow(
    query: Query,
    model: string,
    contextWindow: number,
  ): void;
  publishCommands(query: Query, queryToken: number): void;
}

export interface ClaudeExecutionStrategy {
  startTurn(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<void>;
  /**
   * Oddaje steer zywej turze `queryToken`. Falsz tylko wtedy, gdy nic nie
   * zostalo przekazane do CLI.
   */
  steerTurn(message: SDKUserMessage & { readonly uuid: string }, queryToken: number): boolean;
  /** `/btw` na zywym procesie CLI; null, gdy procesu nie ma (ephemeral albo przed pierwsza tura). */
  askSideQuestion(question: string): Promise<{ response: string; synthetic: boolean } | null>;
  cancel(queryToken: number | null, nativeTurnHandedOff: boolean): void;
  setMode(mode: Parameters<Query['setPermissionMode']>[0]): Promise<boolean>;
  getRewindQuery(): Query | null;
  ensureReadyForRewind(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<Query | null>;
  dispose(): Promise<void>;
}

/** Metoda z runtime SDK 0.3.226, ktorej brakuje w jego typach. */
interface SideQuestionCapableQuery {
  askSideQuestion?: (question: string) => Promise<{ response: string; synthetic: boolean } | null>;
}

type PersistentNativeTurnOutcome =
  | { readonly type: 'completed' }
  | { readonly type: 'failed'; readonly error: unknown };

interface PersistentNativeTurn {
  readonly inputs: ClaudeTurnInputs | null;
  readonly query: Query;
  readonly queryToken: number;
  readonly completion: Promise<PersistentNativeTurnOutcome>;
  settle(outcome: PersistentNativeTurnOutcome): void;
}

export class ClaudePersistentExecutionStrategy
implements ClaudeExecutionStrategy {
  private query: Query | null = null;
  private messageChannel: MessageChannel | null = null;
  private abortController: AbortController | null = null;
  private consumerPromise: Promise<void> | null = null;
  private currentConfig: ClaudeEncodedExecutionRequest | null = null;
  private activeNativeTurn: PersistentNativeTurn | null = null;
  private authoritativeContextWindow: {
    readonly query: Query;
    readonly model: string;
    readonly contextWindow: number;
  } | null = null;
  private contextWindowDiscovery: {
    readonly query: Query;
    readonly model: string;
    readonly promise: Promise<void>;
  } | null = null;
  private preparingTurnToken: number | null = null;
  private disposed = false;

  constructor(private readonly sink: ClaudeExecutionStrategySink) {}

  async startTurn(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<void> {
    const requestSignal = request.options.abortController?.signal;
    const priorTurn = this.activeNativeTurn;
    if (priorTurn) {
      const outcome = await priorTurn.completion;
      requestSignal?.throwIfAborted();
      if (outcome.type === 'failed') {
        throw outcome.error;
      }
    }

    requestSignal?.throwIfAborted();
    this.preparingTurnToken = queryToken;
    try {
      await this.ensureQuery(request, queryToken);
      requestSignal?.throwIfAborted();
      if (!this.query || !this.messageChannel) {
        throw new Error('Claude persistent query is unavailable');
      }

      await this.applyDynamicUpdates(request);
      requestSignal?.throwIfAborted();
      void this.refreshAuthoritativeContextWindow(request.model);
      const message = buildClaudeSDKUserMessage(
        request.prompt,
        this.sink.getProviderSessionId() ?? '',
        request.images,
      );
      if (message.uuid) {
        this.sink.setPendingNativeUserMessageId(message.uuid, queryToken);
      }
      const inputs = message.uuid ? new ClaudeTurnInputs(message.uuid) : null;
      if (inputs) {
        this.sink.bindNativeTurnInputs(inputs, queryToken);
      }
      requestSignal?.throwIfAborted();
      const query = this.query;
      this.messageChannel.enqueue(message);
      this.activeNativeTurn = createPersistentNativeTurn(query, queryToken, inputs);
      this.sink.markNativeTurnHandedOff(queryToken);
    } finally {
      if (this.preparingTurnToken === queryToken) {
        this.preparingTurnToken = null;
      }
    }
  }

  steerTurn(
    message: SDKUserMessage & { readonly uuid: string },
    queryToken: number,
  ): boolean {
    const nativeTurn = this.activeNativeTurn;
    if (
      this.disposed
      || !nativeTurn
      || nativeTurn.queryToken !== queryToken
      || nativeTurn.query !== this.query
      || !nativeTurn.inputs
      || nativeTurn.inputs.settled
      || !this.messageChannel
    ) {
      return false;
    }
    // 'next' dokleja na najblizszej granicy; 'now' przerwalby dzialajace narzedzie.
    if (!this.messageChannel.steer({ ...message, priority: 'next' })) {
      return false;
    }
    // Replay przychodzi asynchronicznie, wiec rejestracja po wyslaniu nie przegapi potwierdzenia.
    nativeTurn.inputs.addSteer(message.uuid);
    return true;
  }

  async askSideQuestion(question: string): Promise<{ response: string; synthetic: boolean } | null> {
    // SDK 0.3.226 ma te metode w runtime, ale nie w typach (zmierzone sonda 25.10:
    // odpowiedz w ~2 s w trakcie trwajacej tury, z kontekstem rozmowy, bez narzedzi).
    const query: (Query & SideQuestionCapableQuery) | null = this.query;
    if (this.disposed || !query?.askSideQuestion) return null;
    return query.askSideQuestion(question);
  }

  cancel(
    queryToken: number | null,
    nativeTurnHandedOff: boolean,
  ): void {
    if (
      !nativeTurnHandedOff
      && queryToken !== null
      && this.preparingTurnToken === queryToken
    ) {
      void this.closeCurrentQuery().catch(() => undefined);
      return;
    }
    const nativeTurn = this.activeNativeTurn;
    if (
      nativeTurnHandedOff
      && (
        queryToken === null
        || nativeTurn?.queryToken === queryToken
      )
    ) {
      if (nativeTurn?.inputs?.hasUndeliveredSteers()) {
        // Steer w kolejce CLI przezywa interrupt; zamkniecie procesu go odwoluje.
        void this.closeCurrentQuery().catch(() => undefined);
        return;
      }
      void this.query?.interrupt().catch(() => undefined);
    }
  }

  async setMode(
    mode: Parameters<Query['setPermissionMode']>[0],
  ): Promise<boolean> {
    if (!this.query) return false;
    await this.query.setPermissionMode(mode);
    return true;
  }

  getRewindQuery(): Query | null {
    return this.query;
  }

  async ensureReadyForRewind(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<Query | null> {
    await this.ensureQuery(request, queryToken);
    return this.query;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const query = this.query;
    this.messageChannel?.close();
    this.abortController?.abort();
    this.query = null;
    this.messageChannel = null;
    this.abortController = null;
    this.authoritativeContextWindow = null;
    this.contextWindowDiscovery = null;
    if (query) {
      this.sink.handleNativeQueryClosed(query);
      this.finishNativeTurn(query, {
        type: 'failed',
        error: new Error('Claude persistent query was disposed.'),
      });
      await query.interrupt().catch(() => undefined);
    }
    await this.consumerPromise?.catch(() => undefined);
    this.consumerPromise = null;
    this.currentConfig = null;
  }

  private async ensureQuery(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<void> {
    const requestSignal = request.options.abortController?.signal;
    requestSignal?.throwIfAborted();
    if (this.disposed) {
      throw new Error('Claude persistent strategy is disposed');
    }
    if (
      this.query
      && this.currentConfig
      && this.currentConfig.restartKey !== request.restartKey
    ) {
      await this.closeCurrentQuery();
      requestSignal?.throwIfAborted();
    }
    if (this.query) {
      return;
    }

    const agentQuery = await loadClaudeAgentQuery();
    requestSignal?.throwIfAborted();
    if (this.disposed) {
      return;
    }
    if (this.query) {
      return;
    }
    const abortController = new AbortController();
    const messageChannel = new MessageChannel();
    const options: Options = {
      ...request.options,
      abortController,
    };
    const query = agentQuery({
      prompt: messageChannel,
      options,
    });
    this.abortController = abortController;
    this.messageChannel = messageChannel;
    this.query = query;
    this.currentConfig = request;
    this.authoritativeContextWindow = null;
    this.contextWindowDiscovery = null;
    this.sink.handleNativeQueryOpened(query);
    this.consumerPromise = this.consume(query, queryToken);
  }

  private async applyDynamicUpdates(
    request: ClaudeEncodedExecutionRequest,
  ): Promise<void> {
    const query = this.query;
    const current = this.currentConfig;
    if (!query || !current) return;

    if (request.model !== current.model) {
      await query.setModel(request.model);
      if (this.query !== query || this.disposed) return;
    }
    if (request.effort !== current.effort) {
      await query.applyFlagSettings({ effortLevel: request.effort });
      if (this.query !== query || this.disposed) return;
    }
    if (request.sdkPermissionMode !== current.sdkPermissionMode) {
      await query.setPermissionMode(request.sdkPermissionMode);
      if (this.query !== query || this.disposed) return;
    }
    this.currentConfig = request;
  }

  private refreshAuthoritativeContextWindow(model: string): Promise<void> {
    const query = this.query;
    if (!query || typeof query.getContextUsage !== 'function') {
      return Promise.resolve();
    }
    if (
      this.authoritativeContextWindow?.query === query
      && this.authoritativeContextWindow.model === model
    ) {
      return Promise.resolve();
    }
    if (
      this.contextWindowDiscovery?.query === query
      && this.contextWindowDiscovery.model === model
    ) {
      return this.contextWindowDiscovery.promise;
    }

    let request: ReturnType<Query['getContextUsage']>;
    try {
      request = query.getContextUsage();
    } catch {
      return Promise.resolve();
    }
    const promise = request
      .then((contextUsage) => {
        if (
          this.query !== query
          || this.currentConfig?.model !== model
          || this.disposed
        ) {
          return;
        }
        const contextWindow = contextUsage.rawMaxTokens;
        if (!isFinitePositiveNumber(contextWindow)) {
          return;
        }
        this.authoritativeContextWindow = { query, model, contextWindow };
        this.sink.handleAuthoritativeContextWindow(
          query,
          model,
          contextWindow,
        );
      })
      .catch(() => {
        // Result model metadata remains the fallback when control discovery fails.
      })
      .finally(() => {
        if (this.contextWindowDiscovery?.promise === promise) {
          this.contextWindowDiscovery = null;
        }
      });
    this.contextWindowDiscovery = { query, model, promise };
    return promise;
  }

  private async consume(query: Query, queryToken: number): Promise<void> {
    try {
      for await (const message of query) {
        if (this.query !== query || this.disposed) {
          return;
        }
        if (message.type === 'system' && message.subtype === 'init') {
          this.sink.publishCommands(query, queryToken);
        }
        const nativeTurn = this.getNativeTurn(query);
        nativeTurn?.inputs?.observe(message);
        await this.sink.handleNativeMessage(
          message,
          nativeTurn?.queryToken ?? queryToken,
        );
        if (
          message.type === 'system'
          && message.subtype === 'init'
          && message.session_id
        ) {
          this.messageChannel?.setSessionId(message.session_id);
        }
        // Steer odpalony jako nastepna natywna tura trzyma ture otwarta do jego resultu
        // albo do `idle`, gdy CLI steer porzucilo (tylko tura, ktora czekala na steer).
        const idleEndsSteeredTurn = isSessionIdle(message)
          && (nativeTurn?.inputs?.ids.length ?? 0) > 1
          && nativeTurn?.inputs?.settled === true;
        if (
          (message.type === 'result' && nativeTurn?.inputs?.settled !== false)
          || idleEndsSteeredTurn
        ) {
          this.messageChannel?.onTurnComplete();
          this.finishNativeTurn(query, { type: 'completed' });
        }
      }
      if (this.query === query && !this.disposed) {
        const nativeTurn = this.getNativeTurn(query);
        const nativeTurnToken = nativeTurn?.queryToken ?? queryToken;
        const error = new Error('Claude persistent query ended unexpectedly.');
        this.detachCurrentQuery(query);
        this.sink.handleNativeEnd(nativeTurnToken);
        this.finishNativeTurn(query, { type: 'failed', error });
      }
    } catch (error) {
      if (this.query === query && !this.disposed) {
        const nativeTurn = this.getNativeTurn(query);
        const nativeTurnToken = nativeTurn?.queryToken ?? queryToken;
        this.detachCurrentQuery(query);
        this.sink.handleNativeFailure(error, nativeTurnToken);
        this.finishNativeTurn(query, { type: 'failed', error });
      }
    }
  }

  private async closeCurrentQuery(): Promise<void> {
    const query = this.query;
    if (query) {
      this.detachCurrentQuery(query);
      this.finishNativeTurn(query, {
        type: 'failed',
        error: new Error('Claude persistent query was replaced.'),
      });
    }
    if (query) {
      await query.interrupt().catch(() => undefined);
    }
  }

  private getNativeTurn(query: Query): PersistentNativeTurn | null {
    return this.activeNativeTurn?.query === query
      ? this.activeNativeTurn
      : null;
  }

  private finishNativeTurn(
    query: Query,
    outcome: PersistentNativeTurnOutcome,
  ): void {
    const nativeTurn = this.getNativeTurn(query);
    if (!nativeTurn) return;
    this.activeNativeTurn = null;
    nativeTurn.settle(outcome);
  }

  private detachCurrentQuery(query: Query): void {
    if (this.query !== query) return;
    this.messageChannel?.close();
    this.abortController?.abort();
    this.query = null;
    this.messageChannel = null;
    this.abortController = null;
    this.currentConfig = null;
    this.authoritativeContextWindow = null;
    this.contextWindowDiscovery = null;
    this.sink.handleNativeQueryClosed(query);
  }
}

export class ClaudeEphemeralExecutionStrategy
implements ClaudeExecutionStrategy {
  private activeQuery: Query | null = null;
  private activeAbortController: AbortController | null = null;
  private turnBarrier: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly sink: ClaudeExecutionStrategySink) {}

  async startTurn(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<void> {
    const turn = this.turnBarrier
      .catch(() => undefined)
      .then(() => this.runTurn(request, queryToken));
    this.turnBarrier = turn;
    await turn;
  }

  private async runTurn(
    request: ClaudeEncodedExecutionRequest,
    queryToken: number,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error('Claude ephemeral strategy is disposed');
    }
    const abortController = request.options.abortController
      ?? new AbortController();
    const options: Options = {
      ...request.options,
      abortController,
    };
    const message = buildClaudeSDKUserMessage(
      request.prompt,
      this.sink.getProviderSessionId() ?? '',
      request.images,
    );
    if (message.uuid) {
      this.sink.setPendingNativeUserMessageId(message.uuid, queryToken);
    }
    const prompt = toSingleMessagePrompt(message);
    this.activeAbortController = abortController;
    let query: Query | null = null;
    try {
      await runColdStartQuery({
        options,
        prompt,
        stopAfterResult: true,
        onQuery: (openedQuery) => {
          query = openedQuery;
          this.activeQuery = openedQuery;
          this.sink.handleNativeQueryOpened(openedQuery);
          this.sink.markNativeTurnHandedOff(queryToken);
        },
        onMessage: async (message) => {
          if (
            !query
            || this.activeQuery !== query
            || this.disposed
          ) {
            return;
          }
          if (
            message.type === 'system'
            && message.subtype === 'init'
          ) {
            this.sink.publishCommands(query, queryToken);
          }
          await this.sink.handleNativeMessage(message, queryToken);
        },
      });
    } catch (error) {
      if (
        (!query || this.activeQuery === query)
        && !this.disposed
      ) {
        this.sink.handleNativeFailure(error, queryToken);
      }
    } finally {
      if (!query || this.activeQuery === query) {
        if (query) {
          this.sink.handleNativeQueryClosed(query);
        }
        this.activeQuery = null;
        this.activeAbortController = null;
      }
      this.sink.releaseNativeTurnFence(queryToken);
    }
  }

  steerTurn(): boolean {
    // Prompt z jedna wiadomoscia zamyka wejscie po pierwszym wyslaniu.
    return false;
  }

  askSideQuestion(): Promise<null> {
    // Proces zyje tylko przez jedna ture — nie ma na czym zadac pytania.
    return Promise.resolve(null);
  }

  cancel(
    _queryToken: number | null,
    _nativeTurnHandedOff: boolean,
  ): void {
    this.activeAbortController?.abort();
    void this.activeQuery?.interrupt().catch(() => undefined);
  }

  setMode(): Promise<boolean> {
    return Promise.resolve(false);
  }

  getRewindQuery(): Query | null {
    return null;
  }

  ensureReadyForRewind(): Promise<Query | null> {
    return Promise.resolve(null);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const query = this.activeQuery;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.activeQuery = null;
    if (query) {
      this.sink.handleNativeQueryClosed(query);
      await query.interrupt().catch(() => undefined);
    }
    await this.turnBarrier.catch(() => undefined);
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function* toSingleMessagePrompt(
  message: SDKUserMessage,
): AsyncGenerator<SDKUserMessage> {
  yield message;
}

function createPersistentNativeTurn(
  query: Query,
  queryToken: number,
  inputs: ClaudeTurnInputs | null,
): PersistentNativeTurn {
  let resolve!: (outcome: PersistentNativeTurnOutcome) => void;
  const completion = new Promise<PersistentNativeTurnOutcome>(
    (innerResolve) => {
      resolve = innerResolve;
    },
  );
  let settled = false;
  return {
    inputs,
    query,
    queryToken,
    completion,
    settle: (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    },
  };
}
