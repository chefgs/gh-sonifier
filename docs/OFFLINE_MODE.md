# Offline Mode

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
