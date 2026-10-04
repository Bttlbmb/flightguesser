# Flightguesser

Flightguesser is a small geography game built around a real aircraft observation. You have six tries to guess its **reported destination city**. Your first missed city guess reveals one distance-and-direction clue. Revealing an extra clue uses one of those tries.

The route comes from a database that links an aircraft's radio identifier, or callsign, to airports. That link can be outdated. The game freezes one observation and reported route for each round, then reveals the exact airport and source at the end. The small globe shows where the aircraft was observed and which way it was traveling.

## Run locally

Install Node.js 22 or newer. There are no packages to install.

```sh
npm start -- --port=5183
```

Open [localhost:5183](http://localhost:5183) and choose your location or a starting city. If live data is unavailable, the recovery screen offers four recorded flights. These are real observations from 3 October 2026, clearly labeled as practice. The collection rotates, skipping recordings that share the previous destination city.

For nearby live searches, start the optional local relay instead:

```sh
npm run dev:live -- --port=5183
```

The relay passes requests to adsb.lol from your computer. It runs only on localhost; it is a development tool. Live play still depends on fresh aircraft data and a usable route match. If the port is occupied, use another, such as `--port=5184`.

## How it works

- Choose a destination city from the search results. City names, airport names and airport codes all work as search terms. Empty, invalid and duplicate guesses do not use a try.
- A city can serve several airports, and an airport can have several accepted cities. Tokyo covers Haneda and Narita; Seoul and Incheon both count for Incheon Airport. The [city policy](docs/city-destinations.md) explains the small curated list and its limits.
- Your first missed city guess reveals a single **Distance & direction** clue from that city toward the main destination city. It stays fixed in the clue book. Later guesses reveal the next clue category without new city-distance or direction readings. City reference points are approximate and sometimes use airport positions.
- The globe remains above the city input; all clue text, including direction labeled **First clue**, is in one clue book. Desktop shows the book beside the input and six guess rows. Phone shows it between the input and guesses, with a Hide/Show toggle and a visible clue count. It starts open, reopens for a new clue or result, and can be collapsed without spending a guess. Later clues give destination country, distance remaining, airline when available, then city initial; aircraft telemetry and origin are not clues. Revealing a clue yourself uses one guess and fills one board row; missing facts are skipped.
- Choose **Normal** for kilometre values or **Hard** for destination distance ranges before starting. Hard mode uses 50 km bands below 1,000 km and 100 km bands from 1,000 km, with “<50 km” for nearby distances. Both the first-city clue and remaining-distance clue use the same bands. The choice stays fixed while playing; six guesses and sequential paid reveals apply in either mode.
- Kraków and Athens are primary answers for KRK and ATH. Balice and Spata-Artemida remain accepted alternatives, including their city initials.
- **Current heading** describes the aircraft at the observation; it can turn before arrival. The starting place is the area searched for a plane, not its departure city.
- Consecutive rounds in the current play session avoid the same destination city, including different airports serving that city. Live and recorded rounds share that rule. If no different destination is available, the game offers recovery choices.
- Live selection compares a small pool of flights, favors useful direction clues and varies recent cities, countries, airlines and distance bands over the last ten opened rounds. It rejects destinations within 150 km of the starting place, flights within 250 km of the destination airport or main city, and low descending aircraft within 500 km of arrival. If only arrivals are available, it offers recovery choices.
- If a live search finds no playable or different destination, **Look elsewhere** searches from another listed city with one click. The loading screen and round show the new starting area. Difficulty and destination history carry over; recorded play, retry and manual city selection remain available.
- The aircraft observation and answer stay fixed. The result keeps your guess and clue history and openly shows any remaining clues. The finished globe adds a schematic connection between the reported airports; it does not show a recorded flight path.

Direction, altitude and ground speed describe the aircraft observation. A route match is not a confirmed flight plan. Distances are straight-line estimates; the game does not predict an arrival time.

## Location and privacy

The browser asks for location only after you select **Use my location**. You can choose a starting city instead. The game keeps coordinates in memory, rounds search coordinates to two decimal places before sending them to the provider, and uses no analytics or location storage. The route fallback, adsbdb, receives only an aircraft callsign. Providers may keep their own request logs.

Browser location requires HTTPS or localhost.

## Build a static website

```sh
npm run build
npm run preview -- --port=5184
```

Deploy the generated `dist/` folder to an ordinary static web host. It contains the game, local data and licence notices; the relay and research evidence stay outside the build.

Recorded practice is the dependable static experience. Earlier localhost browser checks could not read live aircraft data directly because the providers did not allow that browser origin. A public live deployment needs a successful check from its actual address, provider permission or an owned data service. See the dated [data-source findings](docs/data-sources.md).

## Development

```sh
npm test
npm run build
```

Tests run offline and cover data validation, request limits, calculations, city matching, game rules, the globe and the local server. Browser checks and remaining limits are documented in [QA](docs/qa.md).

| Path | Purpose |
| --- | --- |
| `public/` | Game source and bundled data |
| `scripts/` | Local server, build, data preparation and bounded research sampler |
| `tests/` | Offline tests |
| `docs/evidence/` | Recorded source responses and network findings; excluded from the build |
| `dist/` | Generated website; rebuild rather than edit |

Read [development notes](CONTRIBUTING.md), [architecture](docs/architecture.md) and [data attribution](docs/data-attribution.md) before changing the data or deployment setup.
