# Development notes

Edit the game in `public/`. The build copies those files to `dist/`; changes to generated output will be lost on the next build. Keep the clue book beside the guesses on desktop and between the input and guesses on phone, with native controls, local search and a small dependency footprint.

## Where changes belong

- `api.js` handles requests, cancellation, deadlines and provider pauses.
- `flights.js` validates aircraft observations and reported routes.
- `destinations.js` turns airports into selectable cities; `data/city-links.js` supplies the sourced exceptions.
- `game.js` owns guesses, clues and results. `app.js` renders them and handles interaction.
- `geo.js` supplies geographic calculations; `globe.js` renders the frozen observation.

Keep these boundaries so a provider change does not change scoring or presentation by accident. Comment the reason for a safeguard, assumption or non-obvious choice. Avoid comments that merely repeat what a statement does.

## Data rules

Treat provider responses as untrusted. Validate types, timestamps, coordinates and route shape; a missing value is not zero. A destination must come from an explicit route field. Do not infer it from heading, nearby airports, registration country or a historical arrival.

Keep the observation and route fixed for the round, with their source and recorded time. Practice stays dated and explicit. Never use the current clock to make an old observation look live, or substitute a recording for a failed live search without telling the player.

City identity and airport membership are separate. Preserve stable city IDs, direct links, homonym distinctions and the main-city reference point. Add a link only with evidence; shared airports do not create further links. See [city destinations](docs/city-destinations.md).

Request location only after a click, keep it out of storage, and send only rounded search coordinates. The static build must contain no secrets or server relay. Keep the relay bound to loopback with fixed provider endpoints and its existing request limits.

## Check a change

```sh
npm test
npm run build
```

Run the tests for changes to data selection, calculations, networking, scoring, search or the server. For layout and interaction changes, use the [browser checklist](docs/qa.md). Check the actual rendered game at the listed desktop and phone sizes, including a short viewport, long labels, keyboard navigation, loading, errors and finished rounds.

Use recordings or local fixtures for browser regression checks. A fixture verifies the interface; it does not establish provider availability. Record what was tested and any remaining limits in `docs/qa.md`. A resized desktop browser does not establish physical-phone or screen-reader behavior.

Keep player-facing explanations about playing, privacy and data uncertainty. Put implementation details in these project documents. Remove superseded notes when their useful facts have a clear home.

## Rebuild the bundled data

Data preparation is separate from the offline website build:

```sh
python3 scripts/prepare-airports.py /path/to/airport-codes.csv
node scripts/prepare-practice.mjs
```

The practice generator uses the preserved `selection-*` responses in `docs/evidence/`. Keep those originals, timestamps and [licence attribution](docs/data-attribution.md). Airport-data updates must preserve the IDs and coordinate sources used by curated city links, or update those links and their tests together.

`node scripts/spike-adsb.mjs` is an optional network sampler, limited to twelve sequential requests around Seoul and London. It stops on the first rate limit and saves each run in a separate dated folder. Use `--help` for options or `--out=/new/directory` for a destination; an existing folder is never overwritten. Normal tests and builds remain offline.

Before sustained use of adsb.lol, follow the provider's contact request and set `FLIGHTGUESSER_CONTACT` to a real public contact URL or email for relay and sampler requests.
