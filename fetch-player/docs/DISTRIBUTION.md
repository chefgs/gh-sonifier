# Distribution

## Packaging

```bash
npm run package        # build, then zip for the store -> dist/contribution-sonifier-<version>.zip
```

The archive must have `manifest.json` at its **root**, not nested inside a folder. The
packaging script zips from inside `dist/ext` to guarantee that, strips macOS resource forks,
and fails loudly if either check does not hold — a nested manifest is the most common store
rejection.

## Distribution Routes

Three ways to get it to people:

| Route | What it costs | What the user sees |
| --- | --- | --- |
| **Chrome Web Store** | $5 one-time developer registration, plus review (days, longer when host permissions are involved) | A normal one-click install |
| **GitHub Release** | Nothing, works today | They download the zip, unzip it, and load it unpacked with developer mode on. Chrome nags about developer-mode extensions on startup |
| Self-hosted `.crx` | — | Effectively enterprise-policy only now; not a consumer route |

## Store Listing

For the store listing, this extension will specifically be asked to justify its
`host_permissions`. The honest answer is the whole design: *it reads one page,
`https://github.com/users/<user>/contributions`, to get the contribution calendar, because
that endpoint sends no CORS header and there is no token-free API for it.* The data-use
disclosure is straightforward — nothing is collected, transmitted or sold — but the form is
mandatory even when every answer is "no". You will also need at least one 1280x800 or
640x400 screenshot; the built-in share card makes a reasonable one.
