import type { ProviderExecutionRequest } from './ProviderExecutionRequest';
import type { ProviderExecutionSession } from './ProviderExecutionSession';

export interface ChatRewindResult {
  readonly canRewind: boolean;
  readonly error?: string;
  readonly filesChanged?: readonly string[];
  readonly insertions?: number;
  readonly deletions?: number;
  readonly sessionStrategy?: ChatRewindSessionStrategy;
}

export interface ChatRewindConflict {
  readonly conflictType: string;
  readonly path: string;
}

export interface ChatRewindPreview {
  readonly canRewind: boolean;
  readonly conflicts?: readonly ChatRewindConflict[];
  readonly error?: string;
  readonly filesChanged?: readonly string[];
}

export type ChatRewindMode = 'conversation' | 'code-and-conversation';

export type ChatRewindSessionStrategy =
  | 'checkpoint-resume'
  | 'preserve-provider-session';

export interface SteerableExecutionSession {
  /**
   * Hands additional input to the active native turn.
   *
   * Resolves `true` only after definite native acceptance. Resolves `false`
   * only when the request was definitely not handed off or was explicitly
   * rejected by the provider. Once handoff may have occurred, a transport
   * close, cancellation, session replacement, timeout, malformed or
   * mismatched acknowledgement, or any otherwise unknown disposition must
   * reject instead of resolving `false`.
   *
   * This distinction lets callers discard durable staged input only after a
   * definite rejection and retain ambiguous input for history reconciliation.
   */
  steer(request: ProviderExecutionRequest): Promise<boolean>;
}

/** Odpowiedz na pytanie poboczne (`/btw`): z kontekstu rozmowy, bez narzedzi, poza historia. */
export interface SideQuestionAnswer {
  readonly response: string;
  /** Prawda, gdy CLI nie mialo odpowiedzi i podalo wlasny komunikat zastepczy. */
  readonly synthetic: boolean;
}

export interface SideQuestionExecutionSession {
  /** null = brak zywej sesji natywnej, na ktorej da sie zadac pytanie. */
  askSideQuestion(question: string): Promise<SideQuestionAnswer | null>;
}

/**
 * Independent capability contracts intentionally omit unsupported operations
 * from base sessions instead of requiring provider parity no-ops.
 */
export interface ModeConfigurableExecutionSession {
  setMode(mode: string): Promise<boolean>;
}

export interface RewindableExecutionSession {
  previewRewind(
    userMessageId: string,
    assistantMessageId: string | undefined,
    mode?: ChatRewindMode,
  ): Promise<ChatRewindPreview>;
  rewind(
    userMessageId: string,
    assistantMessageId: string | undefined,
    mode?: ChatRewindMode,
  ): Promise<ChatRewindResult>;
}

type UnknownExecutionSession = ProviderExecutionSession & Record<string, unknown>;

export function isSteerableExecutionSession(
  session: ProviderExecutionSession,
): session is ProviderExecutionSession & SteerableExecutionSession {
  return typeof (session as UnknownExecutionSession).steer === 'function';
}

export function isSideQuestionExecutionSession(
  session: ProviderExecutionSession,
): session is ProviderExecutionSession & SideQuestionExecutionSession {
  return typeof (session as UnknownExecutionSession).askSideQuestion === 'function';
}

export function isModeConfigurableExecutionSession(
  session: ProviderExecutionSession,
): session is ProviderExecutionSession & ModeConfigurableExecutionSession {
  return typeof (session as UnknownExecutionSession).setMode === 'function';
}

export function isRewindableExecutionSession(
  session: ProviderExecutionSession,
): session is ProviderExecutionSession & RewindableExecutionSession {
  const candidate = session as UnknownExecutionSession;
  return (
    typeof candidate.previewRewind === 'function' &&
    typeof candidate.rewind === 'function'
  );
}
