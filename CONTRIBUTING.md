# Development

Edit the game in `public/`; the build replaces `dist/`. The project uses browser JavaScript and Node’s built-in modules, with no package installation for normal development.

## Code boundaries

| File | Responsibility |
| --- | --- |
| `api.js` | Provider requests, deadlines, cancellation and pauses |
| `flights.js`, `selection.js` | Validate flights and choose a suitable puzzle |
| `airports.js`, `destinations.js` | Decode airport data, resolve city labels and search |
| `data.js` | Load local files and rotate recorded practice |
| `game.js` | Guesses, clues and results |
| `app.js` | Screens, controls, focus and announcements |
| `browser-tools.js` | Optional browser actions using the same game rules |
| `geo.js`, `globe.js` | Geographic calculations and the frozen observation map |

Keep provider changes separate from scoring and presentation. Comment why a safeguard or assumption exists, especially around identity, cancellation and source timestamps. Avoid comments that simply repeat the code.

## Check changes

```sh
npm test
npm run build
npm run build:hosted
npm run data:check
```

Tests cover networking, selection, city identity, geography, scoring, the globe and both relays. For interaction or layout changes, run the optional browser check and follow [the verification checklist](docs/qa.md). Use local recordings or clearly labelled fixtures for repeatable checks. They establish game behavior, not live-provider availability.

For GitHub Pages changes, run `npm run build` followed by `npm run test:pages` with Playwright available (or set `FLIGHTGUESSER_PLAYWRIGHT_PACKAGE` to its installed package directory). This serves the built files under `/flightguesser/` without a relay and checks desktop and phone practice, another round, configuration paths and live-failure recovery. These browser checks stay offline.

The build lists its public assets explicitly. Add a new browser module to `scripts/build.mjs`; keep research output, secrets and server tools outside that list. Licence notices belong in every build.

## Preserve the data’s meaning

Treat provider responses as untrusted. Validate types, coordinates, timestamps and route shape. A missing value is not zero. Require an explicit destination; heading, nearby airports, registration country and historical arrivals cannot supply it.

Keep each round’s observation, route and source timestamps fixed. Never make a recording appear live or silently substitute practice for a failed search. Commit selection history and practice rotation only after a round opens successfully.

City names are not identities. Preserve stable IDs, direct airport links and distinct same-name places. A shared airport does not create further links. Add a city association only with evidence, as described in [destination cities](docs/city-destinations.md).

Request location after a player action, hold it in memory and send rounded search coordinates. Keep the local relay bound to loopback, with fixed provider paths, response limits and cancellation.

## Rebuild local data

```sh
python3 scripts/prepare-airports.py /path/to/airport-codes.csv
node scripts/prepare-practice.mjs
```

Airport preparation requires Python 3 and a separately downloaded CSV. It writes a versioned compact file; the browser expands it into named fields once. Check curated IDs and reference coordinates after updating the dataset.

Practice uses the eight original responses in `docs/evidence/`. Keep those files, their timestamps and [attribution](docs/data-attribution.md). `npm run data:check` verifies that the bundled recordings still match them without rewriting anything.

For a small live sample, run `node scripts/sample-flights.mjs --help`. The sampler makes at most twelve sequential requests around Seoul and London, stops at the first provider pause and saves a new dated folder. It never overwrites earlier evidence. Normal tests and builds stay offline.

For sustained adsb.lol use, follow the provider’s contact request and set `FLIGHTGUESSER_CONTACT` to a real public contact URL or email.
