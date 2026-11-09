import type { PermissionMode as SDKPermissionMode } from '@anthropic-ai/claude-agent-sdk';

import { getClaudeProviderSettings } from './settings';

export const CLAUDE_PERMISSION_MODES = ['auto', 'manual', 'acceptEdits', 'yolo'] as const;
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];
/** Toolbar values that map to an SDK mode, including plan (offered only when the provider supports it). */
export type ClaudeToolbarPermissionMode = ClaudePermissionMode | 'plan';

const SDK_PERMISSION_MODES: Record<ClaudeToolbarPermissionMode, SDKPermissionMode> = {
  auto: 'auto',
  manual: 'default',
  acceptEdits: 'acceptEdits',
  yolo: 'bypassPermissions',
  plan: 'plan',
};

/** Retired `safeMode` values, which the retired Safe toggle ran in place of `normal`. */
export const LEGACY_SAFE_MODES: Readonly<Record<string, ClaudePermissionMode>> = {
  auto: 'auto',
  default: 'manual',
  acceptEdits: 'acceptEdits',
};

export function isClaudePermissionMode(value: unknown): value is ClaudePermissionMode {
  return (CLAUDE_PERMISSION_MODES as readonly unknown[]).includes(value);
}

export function toClaudeSDKPermissionMode(mode: ClaudeToolbarPermissionMode): SDKPermissionMode {
  return SDK_PERMISSION_MODES[mode];
}

/** Native modes outside the toolbar (dontAsk, delegate, ...) have no toolbar value. */
export function fromClaudeSDKPermissionMode(mode: unknown): ClaudeToolbarPermissionMode | null {
  return (Object.keys(SDK_PERMISSION_MODES) as ClaudeToolbarPermissionMode[])
    .find(value => SDK_PERMISSION_MODES[value] === mode) ?? null;
}

/** Maps the retired `normal` to the mode its `safeMode` ran; other values fall to the policy fallback. */
export function migrateLegacyClaudeMode(
  value: string,
  settings: Record<string, unknown>,
): ClaudePermissionMode | undefined {
  if (value !== 'normal') return undefined;
  // getClaudeProviderSettings reads missing safeMode as acceptEdits and an invalid one as default.
  return LEGACY_SAFE_MODES[getClaudeProviderSettings(settings).safeMode];
}
