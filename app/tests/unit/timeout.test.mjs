import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropic } from '../../council.js';

const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
  vi.restoreAllMocks();
});

describe('Anthropic request deadline', () => {
  it('aborts a stalled upstream request', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    globalThis.fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));

    await expect(anthropic('test', { timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
