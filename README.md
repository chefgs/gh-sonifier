# Contribution Sonifier

Hear a GitHub contribution graph. Paste a profile, and the year plays as music: each day's
shade becomes a note, an empty day is a rest, and the playhead sweeps the calendar in time
with the audio.

Built as a Chrome extension with **no runtime dependencies** — no audio library, no
framework, no web fonts, nothing fetched at runtime except the one page it reads.

## Why an extension and not a web page

GitHub's contribution calendar lives at
`https://github.com/users/<user>/contributions?from=<year>-01-01&to=<year>-12-31`. That
endpoint returns HTML and **sends no `Access-Control-Allow-Origin` header**, so a normal web
page can issue the request but can never read the reply. A public web app would need a proxy
server in the middle.

An extension does not: with `host_permissions`, its service worker can fetch that URL and
read the body. So there is no server to deploy, no third-party proxy seeing every lookup,
no rate limiting to operate, and your data never leaves your machine.

Worth knowing: since Chrome 85 **content scripts are subject to CORS too**, so the fetch has
to happen in the service worker, not in a script injected into the page.

## Install

```bash
npm install
npm run build          # outputs dist/ext
```

Then in Chrome: **Extensions → Manage extensions → Developer mode → Load unpacked →
`dist/ext`**. Click the toolbar icon to open the app in a tab.

`dist/ext` is a build artifact and is gitignored: it is generated from `src/`, so rebuild it
rather than relying on a checked-in copy. The packaged `dist/*.zip` **is** committed, so the
extension can be downloaded and loaded without installing a toolchain.

### Distributing it

```bash
npm run package        # build, then zip for the store -> dist/contribution-sonifier-<version>.zip
```

The archive must have `manifest.json` at its **root**, not nested inside a folder. The
packaging script zips from inside `dist/ext` to guarantee that, strips macOS resource forks,
and fails loudly if either check does not hold — a nested manifest is the most common store
rejection.

Three ways to get it to people:

| Route | What it costs | What the user sees |
| --- | --- | --- |
| **Chrome Web Store** | $5 one-time developer registration, plus review (days, longer when host permissions are involved) | A normal one-click install |
| **GitHub Release** | Nothing, works today | They download the zip, unzip it, and load it unpacked with developer mode on. Chrome nags about developer-mode extensions on startup |
| Self-hosted `.crx` | — | Effectively enterprise-policy only now; not a consumer route |

For the store listing, this extension will specifically be asked to justify its
`host_permissions`. The honest answer is the whole design: *it reads one page,
`https://github.com/users/<user>/contributions`, to get the contribution calendar, because
that endpoint sends no CORS header and there is no token-free API for it.* The data-use
disclosure is straightforward — nothing is collected, transmitted or sold — but the form is
mandatory even when every answer is "no". You will also need at least one 1280x800 or
640x400 screenshot; the built-in share card makes a reasonable one.

```bash
npm test               # 74 tests, no test runner dependency
npm run typecheck      # tsc --noEmit
```

Requires Node 23.6+ (the project runs TypeScript directly, via Node's built-in type
stripping and test runner). `esbuild` and `typescript` are the only dependencies, and both
are build-time only.

## How the mapping works

`sonify(days, settings)` is a pure function: contribution days in, a plain array of
`SoundEvent` objects out. It makes no audio calls, reads no clock, and uses no unseeded
randomness, so the same data and settings always produce **byte-identical** output. The
player, the share card and the tests all read from that one array.

| Contribution data | Becomes |
| --- | --- |
| Level 0 (empty day) | a rest — no note at all |
| Levels 1–4 | scale degrees 0–3: a darker green is a lower note, a brighter green higher |
| The exact daily count | velocity, on a log curve against the busiest day in the data |
| Each week | one bass note underneath, pitched by how busy that week was |
| A month passing | optional drift up and down the scale (off by default) |
| The weekday | optional octave, Sunday lowest (off by default) |

Pitch is only ever produced by `degreeToMidi`, which indexes into the chosen scale and wraps
octaves. **Every note is therefore in the chosen scale by construction**, and a test asserts
it across all four scales and every combination of options.

Two time mappings:

- **A note per day** — about 365 steps, one bar per week. The default.
- **A chord per week** — 53 steps; each week's distinct shades sound together.

Scales: minor pentatonic (default), major pentatonic, dorian, hirajoshi. Default root A3,
default tempo 120 BPM. The speed slider sets days (or weeks) per second. Master gain is
hard-capped at 0.5 before a limiter, there is a mute button and a volume slider, and the
`AudioContext` is only ever created inside a click handler — **no sound happens without a
deliberate user action**.

The current year is partial, so playback stops at today; the remaining days still render in
the grid, marked as future, and are never played.

## Privacy

- **Public data only.** The extension reads the same page a signed-out visitor sees. It never
  asks for a token, a password, or a login.
- **No cookies are sent.** The fetch sets `credentials: 'omit'`, so even when you are signed
  in to GitHub, the request goes out unauthenticated.
- **Nothing is stored or logged.** No usernames are persisted, no request URL is logged, no
  analytics, no telemetry, no remote fonts or images. The only cache is in memory, holds at
  most 40 years of data for an hour, and dies with the service worker.
- **Private contributions** appear only if the profile owner has turned on *"Include private
  contributions on my profile"* in their GitHub settings — in which case GitHub itself is
  already showing those shades publicly. This extension cannot see anything GitHub does not
  already show.
- **Permissions**: `host_permissions` is scoped to `https://github.com/users/*` and the
  extension requests no API permissions at all. Chrome will still describe this as access to
  github.com, which is accurate — that is the one host it reads.

## This is scraping, and scraping breaks

There is no public, unauthenticated API for the contribution calendar (the GraphQL API has
one, but it requires a token, which this project will not ask for). So the calendar is read
by parsing GitHub's HTML.

The parser was verified against the live endpoint on **2026-11-14**, where it read 365 day
cells whose tooltip counts summed exactly to the heading total. It relies on:

```html
<td data-date="2026-01-04" data-level="1" id="contribution-day-component-0-1"
    class="ContributionCalendar-day">
<tool-tip for="contribution-day-component-0-1">6 contributions on January 4th.</tool-tip>
<h2 id="js-contribution-activity-description">4,317 contributions in 2026</h2>
```

**If GitHub changes that markup, fetching will stop working.** It is written to fail closed
and say so plainly rather than play a silently empty year, and offline mode keeps working
regardless. The parser is a hand-written, quote-aware tag scanner rather than regexes over
HTML, because GitHub puts a JSON blob containing `>` and a URL inside the `<table>`'s own
attributes — a naive regex reads those as data.

## Offline mode

If the fetch fails for any reason, drop or paste a JSON file in the same schema and the
player works identically:

```json
{ "user": "octocat", "year": 2025, "total": 42,
  "days": [{ "date": "2025-01-01", "level": 2, "count": 4 }] }
```

A bare array of days, or `{ "days": [...] }`, is accepted too. The app can export this
format, and the UI includes a console snippet that builds it from your own profile page
without the extension fetching anything at all. Imported files are treated as untrusted:
every field is validated and clamped, unreadable entries are skipped and counted, and you
are told how many.

## Security posture

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

One thing the original design asked for that an extension cannot do: **set a fixed
`User-Agent`.** `User-Agent` is a forbidden header for `fetch`, so the browser's own is sent.
There is no CORS allowlist either, because there is no server with an origin to allow.

## Layout

```
src/core/     pure, no DOM and no audio: username, parse, sonify, scales, stats, calendar, importJson
src/player/   Web Audio: synth, generated reverb impulse, look-ahead scheduler
src/ui/       app page, grid, share card, console snippet
src/ext/      manifest, service worker, the one fetch, message protocol
tests/        74 tests on node:test, with HTML fixtures
scripts/      build (esbuild), store packaging, and a dependency-free PNG icon generator
```

`src/core` is deliberately free of DOM and audio calls, which is what makes the security and
determinism tests possible without a browser.

## Not built yet

- WAV export via `OfflineAudioContext` (the pure mapping layer is ready for it).
- A Firefox or Safari port.
- A public web version, which would need the proxy this design deliberately avoided.
