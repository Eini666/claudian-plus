import * as fs from 'fs';

import {
  bumpAccountGeneration,
  forCurrentAccount,
  getAccountGeneration,
  getCurrentAccountId,
} from '@/utils/claudeAccount';

jest.mock('fs');
const statSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;
const readFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

const CURRENT = '00000000-0000-4000-8000-000000000001';
const OTHER = '11111111-2222-3333-4444-555555555555';

function mockConfig(body: string, mtimeMs = Date.now() + Math.random()): void {
  statSync.mockReturnValue({ mtimeMs } as fs.Stats);
  readFileSync.mockReturnValue(body);
}

const limits = { fiveHour: { percentage: 71, resetsAt: null } };

describe('claudeAccount', () => {
  afterEach(() => jest.resetAllMocks());

  it('bumps the account generation so live processes restart after a switch', () => {
    const before = getAccountGeneration();
    bumpAccountGeneration();
    expect(getAccountGeneration()).toBe(before + 1);
  });

  it('reads accountUuid from the config file', () => {
    mockConfig(`{"foo":1,"oauthAccount":{"accountUuid":"${CURRENT}","emailAddress":"a@b.c"}}`);
    expect(getCurrentAccountId()).toBe(CURRENT);
  });

  it('returns null when the config file is unreadable', () => {
    statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getCurrentAccountId()).toBeNull();
  });

  it('drops limits stamped with another account', () => {
    mockConfig(`{"oauthAccount":{"accountUuid":"${CURRENT}"}}`);
    expect(forCurrentAccount({ ...limits, accountId: OTHER })).toBeNull();
  });

  it('keeps limits stamped with the current account', () => {
    mockConfig(`{"oauthAccount":{"accountUuid":"${CURRENT}"}}`);
    expect(forCurrentAccount({ ...limits, accountId: CURRENT })).not.toBeNull();
  });

  it('keeps unstamped limits — they predate the stamping patch', () => {
    mockConfig(`{"oauthAccount":{"accountUuid":"${CURRENT}"}}`);
    expect(forCurrentAccount(limits)).not.toBeNull();
  });

  it('keeps stamped limits when the current account is unknown', () => {
    statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(forCurrentAccount({ ...limits, accountId: OTHER })).not.toBeNull();
  });

  it('passes null through', () => {
    expect(forCurrentAccount(null)).toBeNull();
    expect(forCurrentAccount(undefined)).toBeNull();
  });
});
