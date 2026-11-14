# Privacy

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
