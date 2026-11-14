# Security Posture

Everything the design asked of a proxy is done locally instead.

| Concern | How it is handled |
| --- | --- |
| Untrusted input | A strict validator: ASCII only, GitHub's own username rules, reserved paths rejected. Fuzzed with 40,000 inputs. |
| URL construction | The browser never fetches a user-supplied URL. `buildContributionsUrl` re-validates and builds the only URL ever requested; a test asserts the origin and path for hostile inputs. |
| Request hardening | 8s timeout, `credentials: 'omit'`, `redirect: 'error'`, `referrer: ''`, one `Accept` header, response origin re-checked, 6 MB streamed body cap. |
| Rate limiting | 20 requests per minute, self-imposed, to avoid hammering GitHub. |
| Caching | In-memory, 1 hour, 40 entries. Failures are never cached. |
| Parser safety | Hand-written scanner, size and tag caps, never throws, fails closed, output always clamped (level 0–4, count ≥ 0, real calendar dates, sorted, deduplicated). |
| XSS | No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` anywhere; all text set via `textContent`. Enforced by a test that scans the source. |
| Dynamic code | No `eval`, no `new Function`. Also forbidden by the extension's CSP, which allows only `script-src 'self'` and restricts `connect-src` to `https://github.com`. |
| Secrets | A test scans every source and test file for tokens, keys, credentials, emails and real usernames. |

## User-Agent Limitation

One thing the original design asked for that an extension cannot do: **set a fixed
`User-Agent`.** `User-Agent` is a forbidden header for `fetch`, so the browser's own is sent.
There is no CORS allowlist either, because there is no server with an origin to allow.
