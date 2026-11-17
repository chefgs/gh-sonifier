import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clearCache, fetchYear } from '../src/ext/fetchYear.ts';
import { MESSAGES } from '../src/ext/protocol.ts';

const VALID = readFileSync(fileURLToPath(new URL('./fixtures/valid-small.html', import.meta.url)), 'utf8');

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
}

test('fetches, parses and returns a year', async () => {
  clearCache();
  const { impl, calls } = fakeFetch(() => html(VALID));
  const r = await fetchYear('octo-tester', 2025, { fetch: impl });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.days.length, 4);
  assert.equal(r.data.total, 1234);
  assert.equal(r.cached, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://github.com/users/octo-tester/contributions?from=2025-01-01&to=2025-12-31');
});

test('the request carries no cookies, follows no redirects and times out', async () => {
  clearCache();
  const { impl, calls } = fakeFetch(() => html(VALID));
  await fetchYear('octo-tester', 2025, { fetch: impl });
  const init = calls[0]!.init;
  assert.equal(init.credentials, 'omit', 'cookies must never be sent');
  assert.equal(init.redirect, 'error', 'a redirect must fail, not be followed');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.referrer, '');
  assert.equal(init.method, 'GET');
  assert.ok(init.signal instanceof AbortSignal, 'a timeout signal is attached');

  // Only the one header we need, and nothing resembling auth.
  const headers = init.headers as Record<string, string>;
  assert.deepEqual(Object.keys(headers), ['Accept']);
  for (const key of Object.keys(headers)) {
    assert.ok(!/auth|cookie|token|key/i.test(key), `unexpected header ${key}`);
  }
  assert.ok(!JSON.stringify(init).toLowerCase().includes('bearer'));
});

test('hostile usernames never reach the network', async () => {
  clearCache();
  const hostile = [
    '../settings', '../../etc/passwd', 'octo/cat', 'https://evil.com/octocat',
    'github.com.evil.com', 'octocat%2F..%2Fsettings', 'оctocat', 'octo cat', '',
    'a'.repeat(40), 'octo@evil.com', 'javascript:alert(1)', 'settings',
    undefined, null, 42, {}, [],
  ];
  for (const user of hostile) {
    const { impl, calls } = fakeFetch(() => html(VALID));
    const r = await fetchYear(user, 2025, { fetch: impl });
    assert.equal(r.ok, false, `allowed ${JSON.stringify(user)}`);
    assert.equal(calls.length, 0, `fetched for ${JSON.stringify(user)}`);
    if (!r.ok) assert.equal(r.code, 'invalid-user');
  }
});

test('whatever the year argument is, the URL stays a github.com contributions URL', async () => {
  for (const year of [2025, '2025', 1800, 9999, NaN, Infinity, -Infinity, null, undefined, {}, '2025 OR 1=1']) {
    clearCache();
    const { impl, calls } = fakeFetch(() => html(VALID));
    await fetchYear('octo-tester', year, { fetch: impl });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.pathname, '/users/octo-tester/contributions');
    assert.match(url.search, /^\?from=\d{4}-01-01&to=\d{4}-12-31$/, calls[0]!.url);
  }
});

test('a response from anywhere but github.com is refused', async () => {
  clearCache();
  const { impl } = fakeFetch(() => {
    const response = html(VALID);
    Object.defineProperty(response, 'url', { value: 'https://evil.example/users/x/contributions' });
    return response;
  });
  const r = await fetchYear('octo-tester', 2025, { fetch: impl });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'upstream');
});

test('each failure has its own actionable message', async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => html('nope', 404), 'not-found'],
    [() => html('slow down', 429), 'rate-limited'],
    [() => html('boom', 500), 'upstream'],
    [() => html('bad gateway', 502), 'upstream'],
    [() => html('<html><body>no calendar here</body></html>'), 'unrecognised'],
    [() => html('x'.repeat(100), 200, { 'content-length': String(7 * 1024 * 1024) }), 'too-large'],
    [() => { throw new TypeError('Failed to fetch'); }, 'network'],
    [() => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }, 'timeout'],
  ];

  for (const [handler, expected] of cases) {
    clearCache();
    const { impl } = fakeFetch(handler);
    const r = await fetchYear('octo-tester', 2025, { fetch: impl });
    assert.equal(r.ok, false, `expected failure for ${expected}`);
    if (!r.ok) {
      assert.equal(r.code, expected);
      assert.equal(r.message, MESSAGES[r.code]);
      assert.ok(r.message.length > 25, `message too terse: ${r.message}`);
      assert.ok(/[.!]$/.test(r.message), `not a sentence: ${r.message}`);
    }
  }
});

test('no error message leaks upstream details, status codes alone, or internals', async () => {
  for (const message of Object.values(MESSAGES)) {
    assert.ok(!/\b(4\d\d|5\d\d)\b/.test(message), `leaks a bare status code: ${message}`);
    assert.ok(!/stack|TypeError|Error:|undefined|cloudflare|nginx|x-github/i.test(message), `leaks internals: ${message}`);
    assert.ok(!/^(Error|Invalid|Failed|Something went wrong)\.?$/i.test(message), `too generic: ${message}`);
    // Every message either says what to do, or offers the offline path.
    assert.match(message, /try again|check|wait|JSON|Reload|spelling|letters/i, `not actionable: ${message}`);
  }
});

test('an oversized streamed body is refused even without a content-length', async () => {
  clearCache();
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
  const { impl } = fakeFetch(() => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(chunk); }, // endless
  }), { status: 200 }));
  const r = await fetchYear('octo-tester', 2025, { fetch: impl });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'too-large');
});

test('a second lookup of the same year is served from cache', async () => {
  clearCache();
  // The parser clips to the requested year, so the fake has to answer per year.
  const { impl, calls } = fakeFetch((url) => {
    const year = new URL(url).searchParams.get('from')!.slice(0, 4);
    return html(VALID.replaceAll('2025-', `${year}-`).replace('in 2025', `in ${year}`));
  });
  const first = await fetchYear('octo-tester', 2025, { fetch: impl });
  const second = await fetchYear('OCTO-TESTER', 2025, { fetch: impl });
  assert.ok(first.ok && second.ok);
  assert.equal(calls.length, 1, 'the cache should prevent a second request');
  assert.equal(second.cached, true);
  assert.deepEqual(second.data, first.data);

  const other = await fetchYear('octo-tester', 2024, { fetch: impl });
  assert.ok(other.ok);
  assert.equal(calls.length, 2, 'a different year is a different request');
});

test('a stale cache entry is refetched', async () => {
  clearCache();
  const { impl, calls } = fakeFetch(() => html(VALID));
  await fetchYear('octo-tester', 2025, { fetch: impl });
  const later = Date.now() + 61 * 60 * 1000;
  await fetchYear('octo-tester', 2025, { fetch: impl, now: () => later });
  assert.equal(calls.length, 2);
});

test('a burst of lookups is rate limited rather than hammering github.com', async () => {
  clearCache();
  let served = 0;
  const { impl } = fakeFetch(() => { served++; return html(VALID); });
  const codes: string[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await fetchYear('octo-tester', 2000 + i, { fetch: impl });
    if (!r.ok) codes.push(r.code);
  }
  assert.ok(served <= 20, `made ${served} requests, over the limit`);
  assert.ok(codes.includes('busy'), 'the user is told to wait');
});

test('failures are not cached', async () => {
  clearCache();
  let status = 500;
  const { impl, calls } = fakeFetch(() => html(status === 200 ? VALID : 'boom', status));
  const bad = await fetchYear('octo-tester', 2025, { fetch: impl });
  assert.equal(bad.ok, false);
  status = 200;
  const good = await fetchYear('octo-tester', 2025, { fetch: impl });
  assert.ok(good.ok, 'a retry after a failure must really retry');
  assert.equal(calls.length, 2);
});
