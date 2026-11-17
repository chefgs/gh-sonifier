# Architecture

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
