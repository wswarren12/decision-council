// Per-member profile store: preferences round-trip, history capped at 10,
// and the 5-runs-per-day cap.

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway dir BEFORE importing it — tests must never
// write into the real data/users.json.
process.env.PROFILE_DATA_DIR = mkdtempSync(join(tmpdir(), 'profile-store-'));
const {
  DAILY_RUN_CAP,
  HISTORY_MAX,
  addHistory,
  getHistory,
  getProfile,
  getPreferences,
  reserveRun,
  setPreferences,
} = await import('../../store.js');

const uid = () => `test:${Math.random().toString(36).slice(2)}`;

describe('profile store', () => {
  it('round-trips preferences and length-caps them', () => {
    const u = uid();
    setPreferences(u, '  favor low-ops options  ');
    expect(getPreferences(u)).toBe('favor low-ops options');
    setPreferences(u, 'x'.repeat(9000));
    expect(getPreferences(u).length).toBe(2000);
  });

  it('keeps only the last 10 history entries, newest first', () => {
    const u = uid();
    for (let i = 1; i <= 13; i++) {
      addHistory(u, { id: String(i), kind: 'table', title: `t${i}`, created_at: 'now', table: {} });
    }
    const h = getHistory(u);
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0].title).toBe('t13');
    expect(h.at(-1).title).toBe('t4');
  });

  it('allows 5 runs per day then throws user_daily_cap with status 429', () => {
    const u = uid();
    for (let i = 0; i < DAILY_RUN_CAP; i++) reserveRun(u);
    expect(getProfile(u).usage).toEqual({ used: 5, cap: 5 });
    let err = null;
    try { reserveRun(u); } catch (e) { err = e; }
    expect(err?.message).toBe('user_daily_cap');
    expect(err?.status).toBe(429);
  });
});
