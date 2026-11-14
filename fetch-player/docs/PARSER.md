# Parser and Scraping

## Parser Details

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
