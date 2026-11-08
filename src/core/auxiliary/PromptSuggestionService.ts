import {
  buildPromptSuggestionPrompt,
  buildPromptSuggestionSystemPrompt,
  parsePromptSuggestionResponse,
} from '../prompt/promptSuggestion';
import type { ProviderId } from '../providers/types';
import type { AuxiliaryExecutionContext } from './AuxiliaryExecutionContext';
import { AuxiliarySessionController } from './AuxiliarySessionController';

export interface PromptSuggestionSetup {
  readonly context: AuxiliaryExecutionContext;
  readonly ensureInitialized: () => Promise<void>;
  readonly providerId: ProviderId;
  readonly resolveLocale: () => string | undefined;
  readonly resolveModel: () => string | undefined;
}

/** Po tylu sugestiach sesja startuje od nowa — inaczej kontekst rosnie bez konca. */
const MAX_SUGESTII_NA_SESJE = 25;

/** Bezczynnosc dluzsza niz to zwalnia proces CLI. Wraca przy nastepnej turze. */
const BEZCZYNNOSC_MS = 5 * 60 * 1000;

/**
 * Jeden strzal obok rozmowy: z ostatniej odpowiedzi asystenta robi propozycje
 * nastepnej wiadomosci uzytkownika.
 *
 * Sesja jest TRZYMANA miedzy turami. Zmierzone 14.09: postawienie nowego procesu
 * CLI kosztuje 7,9 s, a kolejna tura w tym samym procesie 0,3 s — sugestia
 * stawiana od zera dolatywala, kiedy nikomu nie byla juz potrzebna.
 */
export class PromptSuggestionService {
  private controller: AuxiliarySessionController | null = null;
  private providerId: ProviderId | null = null;
  private uzycia = 0;
  private bezczynnosc: number | null = null;

  constructor(private readonly resolveSetup: () => PromptSuggestionSetup) {}

  /** `null` przy bledzie albo gdy nie ma czego podpowiadac — sugestia jest ozdoba, nie robota. */
  async suggest(assistantReply: string): Promise<string | null> {
    const text = assistantReply.trim();
    if (!text) return null;

    try {
      const setup = this.resolveSetup();
      const controller = await this.ensureController(setup);
      this.uzycia += 1;
      const response = await controller.execute({
        model: setup.resolveModel(),
        prompt: buildPromptSuggestionPrompt(text),
        systemPrompt: buildPromptSuggestionSystemPrompt(setup.resolveLocale()),
      });
      this.planujZwolnienie();
      return parsePromptSuggestionResponse(response);
    } catch {
      // Zepsuta sesja nie ma prawa zepsuc kolejnej tury — nastepna zaczyna od zera.
      await this.dispose();
      return null;
    }
  }

  cancel(): void {
    this.controller?.cancel();
  }

  async dispose(): Promise<void> {
    this.clearBezczynnosc();
    const controller = this.controller;
    this.controller = null;
    this.providerId = null;
    this.uzycia = 0;
    await controller?.dispose();
  }

  private async ensureController(
    setup: PromptSuggestionSetup,
  ): Promise<AuxiliarySessionController> {
    const przeterminowana = this.controller
      && (this.providerId !== setup.providerId
        || this.controller.requiresReset
        || !this.controller.hasSession
        || this.uzycia >= MAX_SUGESTII_NA_SESJE);
    if (przeterminowana) {
      await this.dispose();
    }
    if (this.controller) {
      this.clearBezczynnosc();
      return this.controller;
    }

    await setup.ensureInitialized();
    const controller = new AuxiliarySessionController(
      setup.context,
      'suggestion',
      { kind: 'passive' },
    );
    await controller.startRoot();
    this.controller = controller;
    this.providerId = setup.providerId;
    this.uzycia = 0;
    return controller;
  }

  private planujZwolnienie(): void {
    this.clearBezczynnosc();
    this.bezczynnosc = window.setTimeout(() => {
      void this.dispose();
    }, BEZCZYNNOSC_MS);
    // Wiszacy timer nie ma prawa trzymac procesu Obsidiana przy zamykaniu.
    (this.bezczynnosc as { unref?: () => void }).unref?.();
  }

  private clearBezczynnosc(): void {
    if (this.bezczynnosc) {
      window.clearTimeout(this.bezczynnosc);
      this.bezczynnosc = null;
    }
  }
}
