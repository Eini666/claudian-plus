import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Wiadomosci uzytkownika nalezace do jednego runu Claudiana: prompt, ktory go
 * zaczal, plus steery wyslane do zywego wejscia w trakcie pracy.
 *
 * CLI dokleja steer do biezacej tury albo — gdy tura juz sie konczy — puszcza go
 * jako nastepna natywna ture. W obu przypadkach run zostaje otwarty, dopoki
 * `result` nie skonsumuje kazdej jego wiadomosci (wzor: upstream #1448).
 * Zmierzone 25.10 na CLI 2.1.310: `result.user_message_uuids` i `queued_turn_count`
 * przychodza w runtime, choc SDK 0.3.226 ich nie typuje.
 */
export class ClaudeTurnInputs {
  readonly #ids: string[] = [];
  readonly #unconsumed = new Set<string>();
  readonly #undeliveredSteers = new Set<string>();
  /** Tylko jawne echo konsumpcji z `result` — bez niego steer nie jest „pewnie przyjety”. */
  readonly #consumed = new Set<string>();
  #settled = false;

  constructor(primaryId: string) {
    this.#ids.push(primaryId);
    this.#unconsumed.add(primaryId);
  }

  get primaryId(): string {
    return this.#ids[0];
  }

  get ids(): readonly string[] {
    return this.#ids;
  }

  /** Prawda, gdy `result` skonsumowal kazda wiadomosc runu albo CLI nie ma nic w kolejce. */
  get settled(): boolean {
    return this.#settled;
  }

  addSteer(id: string): void {
    if (this.#settled) throw new Error('Claude turn inputs are already settled');
    this.#ids.push(id);
    this.#unconsumed.add(id);
    this.#undeliveredSteers.add(id);
  }

  /** Steer czekajacy w kolejce CLI przezywa interrupt — trzeba go odwolac zamknieciem procesu. */
  hasUndeliveredSteers(): boolean {
    return this.#undeliveredSteers.size > 0;
  }

  wasConsumed(id: string): boolean {
    return this.#consumed.has(id);
  }

  /**
   * Zapisuje dowod dostarczenia i zwraca id steera, ktory ta wiadomosc
   * wprowadzila do tury (replay), jesli jakis.
   */
  observe(message: SDKMessage): string | undefined {
    if (this.#settled) return undefined;
    if (isSessionIdle(message)) {
      // `idle` przychodzi dopiero po ostatnim resulcie (tez po turze spoznionego steera),
      // wiec konczy run, ktorego steer CLI porzucilo. Steery bez potwierdzenia odrzuci koniec runu.
      if (this.#ids.length > 1) this.#settled = true;
      return undefined;
    }
    const replayedId = getReplayedUserMessageId(message);
    if (replayedId && this.#undeliveredSteers.delete(replayedId)) {
      return replayedId;
    }
    if (message.type !== 'result') return undefined;

    const consumed = getConsumedUserMessageIds(message);
    if (!consumed || this.#ids.length === 1) {
      // Bez steera albo bez echa konsumpcji: pierwszy result konczy run, jak przed steerem.
      this.#consumeAll();
      return undefined;
    }
    if (!consumed.some((id) => this.#unconsumed.has(id))) return undefined;
    for (const id of consumed) {
      if (this.#unconsumed.delete(id)) this.#consumed.add(id);
      this.#undeliveredSteers.delete(id);
    }
    const queued = (message as { queued_turn_count?: number }).queued_turn_count ?? 0;
    // Steer bez replay przed resultem: CLI odpali go jako nastepna ture, wiec czekamy
    // na jego result albo na `idle` (porzucony steer).
    if (this.#unconsumed.size === 0 || (queued === 0 && this.#undeliveredSteers.size === 0)) {
      this.#settled = true;
    }
    return undefined;
  }

  /** Konczy run bez potwierdzania steerow: te o nieznanym losie odrzuci koniec runu. */
  #consumeAll(): void {
    this.#unconsumed.clear();
    this.#undeliveredSteers.clear();
    this.#settled = true;
  }
}

/** Stan sesji `idle` — wysylany tylko z CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1. */
export function isSessionIdle(message: SDKMessage): boolean {
  return message.type === 'system'
    && (message as { subtype?: string }).subtype === 'session_state_changed'
    && (message as { state?: string }).state === 'idle';
}

/** Replay to potwierdzenie CLI, ze przyjelo wyslana wiadomosc do tury. */
export function getReplayedUserMessageId(message: SDKMessage): string | undefined {
  return message.type === 'user'
    && 'isReplay' in message
    && message.isReplay === true
    && message.parent_tool_use_id === null
    && typeof message.uuid === 'string'
    ? message.uuid
    : undefined;
}

function getConsumedUserMessageIds(message: SDKMessage): string[] | null {
  const loose = message as { user_message_uuids?: unknown; user_message_uuid?: unknown };
  if (Array.isArray(loose.user_message_uuids) && loose.user_message_uuids.length > 0) {
    return loose.user_message_uuids.filter((id): id is string => typeof id === 'string');
  }
  return typeof loose.user_message_uuid === 'string' ? [loose.user_message_uuid] : null;
}
