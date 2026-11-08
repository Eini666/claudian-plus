import { isInactiveArchiveCandidate } from '@/features/chat/services/inactiveArchive';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const closed = () => false;

function conv(daysAgo: number, extra: Record<string, unknown> = {}) {
  return { id: 'c1', lastActivityAt: NOW - daysAgo * DAY, ...extra };
}

describe('isInactiveArchiveCandidate', () => {
  it('archives an old, unpinned, closed conversation past the threshold', () => {
    expect(isInactiveArchiveCandidate(conv(15), '14d', closed, NOW)).toBe(true);
    expect(isInactiveArchiveCandidate(conv(13), '14d', closed, NOW)).toBe(false);
  });

  it('does nothing while the setting is off or missing', () => {
    expect(isInactiveArchiveCandidate(conv(400), 'off', closed, NOW)).toBe(false);
    expect(isInactiveArchiveCandidate(conv(400), undefined, closed, NOW)).toBe(false);
  });

  it('never touches pinned, already archived, or open conversations', () => {
    expect(isInactiveArchiveCandidate(conv(60, { isPinned: true }), '7d', closed, NOW)).toBe(false);
    expect(isInactiveArchiveCandidate(conv(60, { isArchived: true }), '7d', closed, NOW)).toBe(false);
    expect(isInactiveArchiveCandidate(conv(60), '7d', id => id === 'c1', NOW)).toBe(false);
  });
});
