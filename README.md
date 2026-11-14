# Contribution Sonifier

Hear a GitHub contribution graph. Each day's shade becomes a note — darker green is lower,
brighter is higher, an empty day is a rest.

A toy project, built twice, two different ways. Both are Chrome extensions with no runtime
dependencies and raw Web Audio. Neither sends anything anywhere.

## [`page-player/`](page-player/) — start here

Adds a player **under the graph on a GitHub profile page**. It reads the squares already in
the page, so it makes no network request at all and asks for **no permissions**. Click any
square to hear that day. Exports MIDI.

No build step — the folder loads as it is.

1. Download this repo (**Code → Download ZIP**, then unzip) or `git clone` it. Keep the
   folder somewhere permanent: Chrome loads it from disk every time, so deleting it
   uninstalls the extension.
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and select the `page-player/` folder — the one containing
   `manifest.json`. Do not select the repo root.
5. Open any GitHub profile, for example `https://github.com/octocat`.
6. The player appears **under the contribution graph**. Press **Play**, or click any square
   to hear that day.

Switching the year on the graph rebuilds the player for that year.

**If the player does not appear**

- Hard reload the profile page: `Cmd+Shift+R` (macOS) or `Ctrl+Shift+R`. GitHub loads the
  calendar after the page, so the first paint can race it.
- Confirm you are on a profile page. It only mounts where a contribution graph exists, not on
  repos, issues or settings.
- Check `chrome://extensions` for an **Errors** button on the card, and the page's own
  DevTools console.

**After editing the files**, press the reload icon on the extension card, then refresh the
profile page. Both steps are needed.

## [`fetch-player/`](fetch-player/) — the other approach

A standalone tab where you **paste any username** and it fetches that profile's calendar
itself. Plays any profile without navigating to it, at the cost of a `host_permissions` grant
for `github.com/users/*` and a parser for GitHub's HTML.

> **Not verified in a browser, and known to have issues.** Its checks are all at the Node
> level — 74 tests and a clean typecheck — which says the code does what it intends, not that
> the extension works. Use `page-player`.

It needs a build:

```bash
cd fetch-player
npm install          # needs Node 23.6+
npm run build        # outputs dist/ext
```

Then **Load unpacked → `fetch-player/dist/ext/`** and click the toolbar icon to open the app
in a tab. A prebuilt zip is committed at `fetch-player/dist/` if you would rather skip the
toolchain: unzip it and load that folder instead. It [documents itself at
length](fetch-player/README.md).

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
