// Per-member profile store: preferences, last-10 run history, daily run cap.
//
// ponytail: a synchronously-written JSON file. Survives local restarts;
// on the PLN sandbox the container filesystem is ephemeral, so history
// resets on redeploy — move to the PLN-provisioned Postgres (deploy skill's
// database flow) when persistence across deploys matters.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PROFILE_DATA_DIR override keeps tests out of the real store.
const DATA_DIR = process.env.PROFILE_DATA_DIR
  || join(dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = join(DATA_DIR, 'users.json');

export const DAILY_RUN_CAP = 5;
export const HISTORY_MAX = 10;
const PREFS_MAX_CHARS = 2000;

let users = {};
try {
  users = JSON.parse(readFileSync(FILE, 'utf8'));
} catch { /* first run */ }

function save() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(users));
}

function user(uid) {
  if (!users[uid]) users[uid] = { preferences: '', history: [], usage: { date: '', count: 0 } };
  return users[uid];
}

const today = () => new Date().toISOString().slice(0, 10);

export function getProfile(uid) {
  const u = user(uid);
  const used = u.usage.date === today() ? u.usage.count : 0;
  return { preferences: u.preferences, usage: { used, cap: DAILY_RUN_CAP } };
}

export function getPreferences(uid) {
  return user(uid).preferences;
}

export function setPreferences(uid, text) {
  user(uid).preferences = String(text ?? '').trim().slice(0, PREFS_MAX_CHARS);
  save();
}

export function getHistory(uid) {
  return user(uid).history;
}

export function addHistory(uid, entry) {
  const u = user(uid);
  u.history.unshift(entry);
  u.history = u.history.slice(0, HISTORY_MAX);
  save();
}

// Counts one run (council or table) against the member's daily cap.
// Throws a 429-shaped error when the cap is already spent.
export function reserveRun(uid) {
  const u = user(uid);
  if (u.usage.date !== today()) { u.usage.date = today(); u.usage.count = 0; }
  if (u.usage.count >= DAILY_RUN_CAP) {
    const err = new Error('user_daily_cap');
    err.status = 429;
    throw err;
  }
  u.usage.count += 1;
  save();
}
