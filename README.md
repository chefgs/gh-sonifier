# Contribution Sonifier

Hear a GitHub contribution graph. Paste a profile, and the year plays as music: each day's
shade becomes a note, an empty day is a rest, and the playhead sweeps the calendar in time
with the audio.

Built as a Chrome extension with **no runtime dependencies** — no audio library, no
framework, no web fonts, nothing fetched at runtime except the one page it reads.

## Installation

### Build from source

```bash
npm install
npm run build          # outputs dist/ext
```

Then in Chrome: **Extensions → Manage extensions → Developer mode → Load unpacked →
`dist/ext`**. Click the toolbar icon to open the app in a tab.

`dist/ext` is a build artifact and is gitignored: it is generated from `src/`, so rebuild it
rather than relying on a checked-in copy. The packaged `dist/*.zip` **is** committed, so the
extension can be downloaded and loaded without installing a toolchain.

### Requirements

Requires Node 23.6+ (the project runs TypeScript directly, via Node's built-in type
stripping and test runner). `esbuild` and `typescript` are the only dependencies, and both
are build-time only.

### Testing

```bash
npm test               # 74 tests, no test runner dependency
npm run typecheck      # tsc --noEmit
```

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — Why an extension, project layout
- **[Mapping](docs/MAPPING.md)** — How contributions become sound
- **[Parser](docs/PARSER.md)** — How the contribution calendar is scraped
- **[Privacy](docs/PRIVACY.md)** — Privacy and permissions
- **[Security](docs/SECURITY.md)** — Security posture and hardening
- **[Offline Mode](docs/OFFLINE_MODE.md)** — Using data without fetching
- **[Distribution](docs/DISTRIBUTION.md)** — Packaging and distribution routes
- **[Future Work](docs/FUTURE_WORK.md)** — Planned features
