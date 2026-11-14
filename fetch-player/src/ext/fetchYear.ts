/**
 * The one place this project touches the network.
 *
 * Everything the brief asked a proxy to do, done locally instead: a timeout, a response
 * size cap, no cookies, no redirects off github.com, a cache, a self-imposed rate limit,
 * and errors that say something useful without echoing anything from upstream.
 *
 * Deliberately not here: forwarding any header from the page, reading any URL the user
 * supplied, or logging a URL. The only URL ever requested is the one buildContributionsUrl
 * constructs from a re-validated username.
 */

import { parseContributions } from '../core/parse.ts';
import { buildContributionsUrl, clampYear, parseUsernameInput, UPSTREAM_ORIGIN } from '../core/username.ts';
import { errorResponse } from './protocol.ts';
import type { FetchYearResponse } from './protocol.ts';
import type { YearData } from '../core/types.ts';

const TIMEOUT_MS = 8000;
const BODY_MAX = 6 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000; // one hour
const CACHE_MAX = 40;

/** A courtesy limit on our own traffic, so a stuck UI cannot hammer github.com. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;

interface CacheEntry {
  at: number;
  data: YearData;
}

const cache = new Map<string, CacheEntry>();
const recentRequests: number[] = [];

export function clearCache(): void {
  cache.clear();
  recentRequests.length = 0;
}

function allow(now: number): boolean {
  while (recentRequests.length > 0 && now - recentRequests[0]! > RATE_WINDOW_MS) recentRequests.shift();
  if (recentRequests.length >= RATE_MAX) return false;
  recentRequests.push(now);
  return true;
}

function remember(key: string, data: YearData): void {
  cache.set(key, { at: Date.now(), data });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

/** Read the body with a hard ceiling, so a huge or endless response cannot fill memory. */
async function readBounded(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > BODY_MAX) return null;

  const body = response.body;
  if (body === null) return null;

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) break;
      size += chunk.value.byteLength;
      if (size > BODY_MAX) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

export interface FetchDeps {
  fetch: typeof fetch;
  now?: () => number;
}

/**
 * Fetch and parse one year. `user` and `year` are treated as untrusted even though the
 * page validated them: the validation that matters is the one next to the request.
 */
export async function fetchYear(
  rawUser: unknown,
  rawYear: unknown,
  deps: FetchDeps,
): Promise<FetchYearResponse> {
  const parsed = parseUsernameInput(rawUser);
  if (!parsed.ok) return errorResponse('invalid-user', parsed.error);
  const user = parsed.user;
  const year = clampYear(rawYear);

  const key = `${user.toLowerCase()}:${year}`;
  const hit = cache.get(key);
  const now = deps.now?.() ?? Date.now();
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) {
    return { ok: true, data: hit.data, cached: true };
  }

  if (!allow(now)) return errorResponse('busy');

  const url = buildContributionsUrl(user, year);

  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: 'GET',
      credentials: 'omit', // never send GitHub cookies, even if the user is signed in
      cache: 'no-store',
      redirect: 'error', // a redirect anywhere is a failure, not something to follow
      referrer: '',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return errorResponse('timeout');
    return errorResponse('network');
  }

  // Defence in depth: refuse anything that did not come from github.com.
  try {
    if (response.url !== '' && new URL(response.url).origin !== UPSTREAM_ORIGIN) {
      return errorResponse('upstream');
    }
  } catch {
    return errorResponse('upstream');
  }

  if (response.status === 404) return errorResponse('not-found');
  if (response.status === 429) return errorResponse('rate-limited');
  if (!response.ok) return errorResponse('upstream');

  const html = await readBounded(response).catch(() => null);
  if (html === null) return errorResponse('too-large');

  const result = parseContributions(html, { user, year });
  if (!result.ok) {
    return errorResponse(result.error === 'too-large' ? 'too-large' : 'unrecognised');
  }

  remember(key, result.data);
  return { ok: true, data: result.data, cached: false };
}
