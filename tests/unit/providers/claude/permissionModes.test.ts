import {
  CLAUDE_PERMISSION_MODES,
  fromClaudeSDKPermissionMode,
  isClaudePermissionMode,
  migrateLegacyClaudeMode,
  toClaudeSDKPermissionMode,
} from '@/providers/claude/permissionModes';

function withSafeMode(safeMode: unknown): Record<string, unknown> {
  return { providerConfigs: { claude: { safeMode } } };
}

describe('claude permission modes', () => {
  it('offers the four non-plan modes in menu order', () => {
    expect(CLAUDE_PERMISSION_MODES).toEqual(['auto', 'manual', 'acceptEdits', 'yolo']);
  });

  it.each([
    ['auto', 'auto'],
    ['manual', 'default'],
    ['acceptEdits', 'acceptEdits'],
    ['yolo', 'bypassPermissions'],
    ['plan', 'plan'],
  ] as const)('maps %s to SDK mode %s and back', (mode, sdkMode) => {
    expect(toClaudeSDKPermissionMode(mode)).toBe(sdkMode);
    expect(fromClaudeSDKPermissionMode(sdkMode)).toBe(mode);
  });

  it.each(['dontAsk', 'delegate', 'normal', undefined, 42])(
    'has no toolbar value for SDK mode %p',
    (sdkMode) => {
      expect(fromClaudeSDKPermissionMode(sdkMode)).toBeNull();
    },
  );

  it('recognizes only current Claude modes', () => {
    expect(isClaudePermissionMode('manual')).toBe(true);
    expect(isClaudePermissionMode('normal')).toBe(false);
    expect(isClaudePermissionMode('plan')).toBe(false);
  });

  describe('migrateLegacyClaudeMode', () => {
    it.each([
      ['auto', 'auto'],
      ['default', 'manual'],
      ['acceptEdits', 'acceptEdits'],
      ['cokolwiek', 'manual'],
    ])('migrates normal with safeMode %s to %s', (safeMode, expected) => {
      expect(migrateLegacyClaudeMode('normal', withSafeMode(safeMode))).toBe(expected);
    });

    it('migrates normal without safeMode to the former default acceptEdits', () => {
      expect(migrateLegacyClaudeMode('normal', {})).toBe('acceptEdits');
    });

    it('reads the pre-provider-config claudeSafeMode key', () => {
      expect(migrateLegacyClaudeMode('normal', { claudeSafeMode: 'auto' })).toBe('auto');
    });

    it('leaves non-legacy values to the policy fallback', () => {
      expect(migrateLegacyClaudeMode('zupelnie-obce', withSafeMode('auto'))).toBeUndefined();
    });
  });
});
