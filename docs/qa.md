# Verification

## GitHub Pages migration — 5 October 2026

All 133 offline tests pass, and `npm run data:check` reproduces the bundled recordings. Both the static and optional Worker builds succeed. The Pages browser check serves the actual static build at `/flightguesser/` in Chrome at 390×844 and 1440×1000. It verifies local asset paths, a recorded first-guess win, the next recording, relative runtime configuration, live-network failure recovery, and no page errors, missing files or horizontal overflow. Practice sends no external requests. Screenshots remain in ignored `test-results/pages/`.

Live position probes with the GitHub Pages origin returned no browser-access permission header from adsb.lol or adsb.fi. This migration verifies static practice and honest failure recovery, not functioning direct live searches. GitHub deployment itself still requires the repository owner to enable **Deploy from a branch**, selecting **gh-pages** and **/(root)**, after making the repository public. The custom Actions workflow has been removed; the website is tested and built locally.

Offline tests check rules and data handling. Browser checks verify what a player can see and operate. Neither a fixture nor a resized desktop browser establishes current provider coverage, physical-phone keyboard behavior or screen-reader speech.

## Repeatable checks

```sh
npm test
npm run data:check
npm run build
npm run build:hosted
```

The tests cover stale and malformed aircraft data, exact callsign matching, ambiguous routes, request budgets, cancellation, pauses, city memberships and search, clue history, six-attempt endings, globe projection and both relays. Practice verification rebuilds the expected data in memory from the preserved responses and compares it with the bundled file.

The optional browser runner uses Playwright and a local Chromium installation:

```sh
npm run test:browser
```

It serves the actual game on an unused localhost port and blocks external requests. Generated screenshots and results go to ignored `test-results/`. If Playwright is supplied outside this project, set `FLIGHTGUESSER_PLAYWRIGHT_PACKAGE` to its package directory; `BROWSER_BIN` can select a Chromium executable. Browser tooling is optional and is not a game dependency.

## Browser checklist

| Area | Check |
| --- | --- |
| Start and recovery | Entry, city selection, loading, cancellation, failed data and retry; late responses cannot reopen cancelled rounds |
| Search | City, airport, code, accents and homonyms; explicit selection, keyboard arrows/Enter/Escape, truthful total counts |
| Rules | First miss creates one fixed clue; later misses unlock the next available fact without new city geometry; invalid and duplicate guesses do not |
| Results | First-try win, sixth-try win and loss; retained history, accepted city names, exact airport and source |
| Practice | No adjacent destination repeats; all four recordings remain reachable; cancelled loads do not advance rotation |
| Layout | Phone portrait, short screens, landscape, both sides of 700 px, tablet and desktop; long labels and doubled text |
| Focus | Input after keyboard guesses; new clue after touch guesses; no focus inside collapsed content; dialogs close correctly |
| Accessibility | Visible focus, reduced motion, forced colors, readable announcements and accessible search/control labels |
| Data privacy | Hidden answer and route absent during play; optional browser tools expose no device coordinates |
| Missing assets | Failed globe leaves a compass; damaged local data shows a useful recovery action |

Check the focused input and popup, not only page width. Phone screenshots must preserve pointer and viewport emulation. A full-page capture can change touch emulation in some Chromium versions.

## Audit: 5 October 2026

The audit removed obsolete difficulty code, hidden artwork, unused history fields and dated screenshot/capture archives. Current rules and source limitations are consolidated in these documents; original practice evidence and required licence notices remain.

Airport storage now omits repeated field names without dropping airports or changing values. Search caches stable ordering instead of sorting every matching city on each keystroke. Local and hosted relays share bounded response parsing. The static build uses an explicit asset list.

Regressions cover practice rotation that previously skipped one Seoul recording, queued hosted-request cancellation and provider pauses, local redirect rejection and malformed compact airport data. All 133 offline tests passed. Practice reproduced exactly from its sources, and all 8,798 decoded airport records matched their previous values. A comparison of 27,885 city, prefix and airport-code queries returned identical rankings and totals before and after the search change.

The seven-document collection is roughly half its previous size. Versioned project files shrank from 17.2 MB to about 1.2 MB, excluding Git history and generated output. Airport data fell from 1,233,572 to 691,637 bytes (44%); gzip size fell from 318,369 to 283,808 bytes (11%). A local Node benchmark repeated seven broad and specific queries 100 times per run; the median of five warm runs fell from 390 to 240 ms (38%). These timings describe this machine and query set.

The static and hosted builds each served all 21 intended public assets byte-for-byte, including both licence notices. The local hosted preview returned the expected provider configuration and static response headers. JavaScript syntax, relative imports, local document links and whitespace checks passed.

The browser runner passed 22 workflows and 105 rendered states in Chrome 154. It covered eight viewports from 320 × 568 to 1440 × 1000, including phone landscape, breakpoints, short screens, doubled text and long labels. There were no uncaught page errors or horizontal overflow, and representative screenshots were inspected. Detailed results and screenshots are in ignored `test-results/browser/`.

## Remaining limits

Earlier local checks established real provider access through a relay. This audit’s repeatable tests use recordings and controlled provider responses; they do not measure current production access, worldwide coverage or uptime.

Physical phones, Safari and actual screen-reader speech still need separate checks. The small practice collection and older agent playtests do not establish human difficulty or enjoyment. Retired reports remain recoverable in Git history.
