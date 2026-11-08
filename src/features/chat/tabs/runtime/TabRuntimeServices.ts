import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import { SubagentManager } from '../../services/SubagentManager';
import { syncTabProviderServices } from '../TabProviderState';
import type { TabServices } from '../types';
import type {
  PublishedTabRuntimeRef,
  TabRuntimeConstructionContext,
  TabRuntimeShellBundle,
} from './TabRuntimeConstruction';

export function buildTabRuntimeServices(
  shell: TabRuntimeShellBundle,
  options: TabRuntimeConstructionContext,
  runtimeRef: PublishedTabRuntimeRef,
): TabServices {
  const subagentManager = new SubagentManager((subagent) => {
    runtimeRef.requirePublished().controllers.streamController.onAsyncSubagentStateChange(subagent);
    options.onWorkChanged?.(runtimeRef.requirePublished());
  });
  options.registerCleanup('tab subagent state', () => subagentManager.clear());

  const titleGenerationService = ProviderRegistry.createTitleGenerationService(
    options.plugin.providerHost,
  );
  options.registerCleanup(
    'tab title generation',
    () => titleGenerationService.cancel(),
  );

  // Sesja pomocnicza od sugestii jest TRZYMANA miedzy turami (7,9 s zimnego startu
  // kontra 0,3 s w stojacym procesie), wiec karta musi ja po sobie zamknac.
  const promptSuggestionService = ProviderRegistry.createPromptSuggestionService(
    options.plugin.providerHost,
  );
  options.registerCleanup(
    'tab prompt suggestion',
    () => { void promptSuggestionService.dispose(); },
  );

  const services: TabServices = {
    subagentManager,
    instructionRefineService: null,
    promptSuggestionService,
    titleGenerationService,
  };
  options.registerCleanup('tab instruction refinement state', () => {
    services.instructionRefineService?.resetConversation();
  });
  options.registerCleanup('tab instruction refinement', () => {
    services.instructionRefineService?.cancel();
  });

  syncTabProviderServices(shell, services, options.plugin);
  return services;
}
