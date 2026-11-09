import type { ProviderSessionEvent } from '@/core/execution';
import { getTabProviderId } from '@/features/chat/tabs/providerResolution';
import { updatePlanModeUI } from '@/features/chat/tabs/TabProviderState';
import { enqueueTabSessionEvent } from '@/features/chat/tabs/TabSessionEvents';

jest.mock('@/features/chat/tabs/TabProviderState', () => ({
  updatePlanModeUI: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/chat/tabs/providerResolution', () => ({
  getTabProviderId: jest.fn(),
}));

const mockUpdatePlanModeUI = updatePlanModeUI as jest.MockedFunction<typeof updatePlanModeUI>;
const mockGetTabProviderId = getTabProviderId as jest.MockedFunction<typeof getTabProviderId>;

function createTab(): Parameters<typeof enqueueTabSessionEvent>[0] {
  return {
    executionCoordinator: { isEventContextCurrent: () => true },
    lifecycleState: 'open',
    state: { isCreatingConversation: false, isSwitchingConversation: false },
    session: { enqueueBackgroundWork: (work: () => Promise<void>) => work() },
  } as unknown as Parameters<typeof enqueueTabSessionEvent>[0];
}

async function emitMode(providerId: string, mode: string): Promise<void> {
  mockGetTabProviderId.mockReturnValue(providerId as ReturnType<typeof getTabProviderId>);
  await enqueueTabSessionEvent(
    createTab(),
    {} as Parameters<typeof enqueueTabSessionEvent>[1],
    { type: 'mode_changed', mode } as unknown as ProviderSessionEvent,
    { bindingId: 'binding-1' } as Parameters<typeof enqueueTabSessionEvent>[3],
  );
}

describe('TabSessionEvents mode_changed', () => {
  beforeEach(() => {
    mockUpdatePlanModeUI.mockClear();
  });

  it.each([
    ['acceptEdits', 'acceptEdits'],
    ['default', 'manual'],
    ['auto', 'auto'],
    ['bypassPermissions', 'yolo'],
    ['plan', 'plan'],
    ['manual', 'manual'],
    ['yolo', 'yolo'],
  ])('maps Claude mode %s to toolbar %s', async (mode, expected) => {
    await emitMode('claude', mode);

    expect(mockUpdatePlanModeUI).toHaveBeenCalledWith(expect.anything(), expect.anything(), expected);
  });

  it.each(['dontAsk', 'delegate', 'normal'])('leaves the Claude toolbar unchanged for %s', async (mode) => {
    await emitMode('claude', mode);

    expect(mockUpdatePlanModeUI).not.toHaveBeenCalled();
  });

  it.each([
    ['default', 'normal'],
    ['plan', 'plan'],
    ['bypassPermissions', 'yolo'],
  ])('keeps the legacy mapping for other providers: %s -> %s', async (mode, expected) => {
    await emitMode('grok', mode);

    expect(mockUpdatePlanModeUI).toHaveBeenCalledWith(expect.anything(), expect.anything(), expected);
  });
});
