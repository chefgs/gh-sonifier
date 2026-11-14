# Contribution Sonifier

Hear a GitHub contribution graph. Each day's shade becomes a note — darker green is lower,
brighter is higher, an empty day is a rest.

A toy project, built twice, two different ways. Both are Chrome extensions with no runtime
dependencies and raw Web Audio. Neither sends anything anywhere.

## [`page-player/`](page-player/) — start here

Adds a player **under the graph on a GitHub profile page**. It reads the squares already in
the page, so it makes no network request at all and asks for **no permissions**. Click any
square to hear that day. Exports MIDI.

```
chrome://extensions → Developer mode → Load unpacked → pick page-player/
```

Then open any GitHub profile. No build step; the folder loads as it is.

## [`fetch-player/`](fetch-player/) — the other approach

A standalone tab where you **paste any username** and it fetches that profile's calendar
itself. Plays any profile without navigating to it, at the cost of a `host_permissions` grant
for `github.com/users/*` and a parser for GitHub's HTML. Needs a build, has 74 tests, and
[documents itself at length](fetch-player/README.md).

## Which one is better

`page-player`, for almost every purpose. GitHub's contributions endpoint sends no
`Access-Control-Allow-Origin` header, so a web page can request it but never read the reply —
that constraint is what pushed `fetch-player` into fetching and re-parsing the page in a
service worker. A content script sidesteps the whole problem by reading the DOM that is
already there: no permissions, no network, no parser to break.

`fetch-player` keeps one genuine advantage: it can play a profile you are not looking at.

## How the mapping works

| Contribution data | Becomes |
| --- | --- |
| An empty day | a rest |
| Shade levels 1–4 | ascending notes of the chosen scale |
| The exact daily count | how loud the note is |
| Each week | a chord or a bass note underneath |

Both default to a pentatonic scale, so nothing can sound wrong. Audio only ever starts from a
click, and the volume is capped with a mute button.

## Notes

- **Public data only.** Both read what a signed-out visitor sees. Neither asks for a token.
  Private contributions show up only if the profile owner already publishes them.
- **This depends on GitHub's markup** (`td.ContributionCalendar-day`, `tool-tip`), which can
  change without warning. Checked against the live site on 2026-11-14: 365 day cells, and the
  tooltip counts summed exactly to the heading total. If GitHub changes it, `page-player`
  simply does not appear and `fetch-player` says so rather than playing an empty year.
- GitHub loads the calendar lazily via `<include-fragment>`, so `page-player` watches for it
  with a `MutationObserver` plus the Turbo navigation events.

## Credit

`page-player` was written by Claude on the web; `fetch-player` by Claude Code. The
interesting part is that they reached different architectures from the same brief — and the
simpler one, with no tests, got the architecture right.
