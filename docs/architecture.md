# Architecture

Flightguesser is one browser game page. The OpenAI Site serves its assets and a bounded live-data relay through a Worker. It joins an aircraft observation to a reported route, freezes both, and gives the player six destination-city guesses. The optional localhost relay makes live development possible where a browser cannot reach the aircraft provider directly.

## Components

The game uses browser JavaScript, HTML and CSS. Node's built-in modules serve and package it. Geography and projection code are bundled locally; there are no runtime map-service, font or CDN requests.

| Module | Responsibility |
| --- | --- |
| `public/api.js` | Bounded searches, cancellation, timeouts and rate-limit handling |
| `public/flights.js` | Normalize and qualify external observations and routes |
| `public/selection.js` | Qualify puzzle geometry, compare candidates and retain session variety |
| `public/airports.js`, `public/destinations.js` | Local airport data, city identities and search |
| `public/game.js` | Frozen-round rules, clues, guesses and assistance |
| `public/app.js` | Views, controls, announcements and optional browser tools |
| `public/geo.js`, `public/globe.js` | Distance/bearing calculations and the observation globe |
| `scripts/serve.mjs`, `scripts/build.mjs` | Local static server, optional relay and offline build |

## Selecting a live round

adsb.lol supplies nearby aircraft observations. Selection requires a valid airborne position, a fresh response and position, usable speed and track, and an airline-form callsign. The callsign pattern is a selection heuristic; it does not prove that an aircraft carries passengers. Duplicate callsigns are rejected because they cannot be joined safely to one route.

The initial response may be no more than 60 seconds old, and the reported position/message age no more than 30 seconds. The position is checked again before and after route lookup and must still be within 60 seconds when selected.

Route lookup first uses adsb.lol's individual callsign endpoint. adsbdb is a fallback when that request fails or has no airport list. An explicit multi-stop or contradictory route is rejected instead of being replaced by another database. Both providers supply callsign associations, not confirmed flight plans. Coordinate-corridor and movement checks remove obvious contradictions without certifying the answer.

Airline identity comes from the route's explicit airline metadata. adsbdb route responses can supply the name directly; adsb.lol reports an airline code. After selecting a live route, the app optionally resolves that reported code through [adsbdb's airline endpoint](https://github.com/mrjackwills/adsbdb#readme), with a 1.5-second timeout and a bounded page-session cache of successful names. It requires one exact ICAO-code match and never guesses identity from the callsign alone. Missing, failed, ambiguous or malformed metadata only removes the airline clue. Cancellation still prevents the round from opening. The twelve-route-request search budget is unchanged; this optional metadata lookup is separate.

Search expands through 50, 100 and 250 nautical miles, approximately 93, 185 and 463 km. A whole search has a 25-second deadline, at most three nearby requests and twelve route requests across both sources. Early radii receive a limited share so wider searches have a chance. A provider 429 response stops the search and pauses later searches. The default 60-second pause, used without a numeric `Retry-After`, is an application policy rather than a published quota.

Selection skips destinations overlapping the last successfully opened round in the current page session. Accepted-city IDs and repeat-only country/name/region keys cover different airports serving the same city without changing city scoring memberships. The same keys skip repeated destinations in the recorded rotation. Failed or cancelled openings do not consume the rotation. When no different usable destination is found, the recovery screen explains that limit.

Live puzzles exclude destinations within 150 km of the starting place, considering both the exact airport and every accepted destination city. This excludes Seoul/Incheon arrivals even when the aircraft is still hundreds of kilometres away. Both the airport and main city must be at least 250 km from the aircraft. Low descending aircraft (below 12,000 ft, faster than 300 ft/min downward) within 500 km of their airport are excluded. These are gameplay cutoffs, not arrival-time estimates. No short/local fallback is selected.

Before route lookup, normal aircraft are checked before low descending aircraft. Each tier is shuffled across carrier and direction groups, with higher aircraft preferred within each group. This prevents a queue of nearest hub arrivals from consuming every lookup. Selection compares up to four distinct usable destination groups, ending sooner at the request or time budget. A first usable candidate starts an eight-second comparison window; request timeouts respect that window. A fresh retained candidate can survive a later transport error or the overall deadline, but caller cancellation and HTTP 429 always stop the search. Candidates are rechecked for position freshness at the final draw.

The last ten successfully opened rounds provide soft penalties for repeated destination identities, country, callsign-prefix carrier and remaining-distance band (regional <1,000 km; medium <4,000 km; long otherwise). The actual displayed true heading, or track fallback, is compared with the bearing to the main city. Curated city naming receives a small preference. Similarly scored answers are sampled once per destination group rather than once per aircraft, so hub traffic volume cannot multiply its chance. History is committed only after a playable round opens, includes recorded rounds, stays in memory and contains no user coordinates. The raw reported airports are preserved; indexed municipality recovery is used only for city interpretation.

An empty or arrival-only search, or one with no different destination, offers **Look elsewhere**. Each click starts one ordinary bounded search, rotating through the listed cities and skipping any within 150 km of the previous search point (including device locations). The starting area is named during loading and in live rounds. Difficulty, played-aircraft exclusions and destination history remain in the same page session. Cancellation uses the existing generation token. Provider/network errors and rate-limit pauses do not offer this action. Practice remains a separate, explicit choice.

## Cities and scoring

The local index derives city choices from airport municipalities and the small [curated city list](city-destinations.md). Uncurated places retain an airport-bound identity and airport context rather than merging same-name municipalities. A provider's airport-name fallback can be replaced with a meaningful bundled municipality; an unresolved destination cannot start a city round.

A round's destination contains a primary city and directly accepted alternatives. A guess wins through its city's direct membership in the exact destination airport. The shared airport does not merge cities: Seoul and Incheon both match ICN, but Incheon does not acquire Seoul's GMP link. Duplicate guesses compare stable city IDs.

A miss consumes one guess. The first missed city inserts and reveals one combined distance/direction clue immediately after the facts already revealed. Its reference city remains fixed. Later misses reveal the next available flight clue while the round continues. A city-guess record carries an optional `clueIndex` only when that guess reveals a clue. Empty, invalid and duplicate choices leave the round unchanged. Revealing an extra clue consumes one guess and records a clue entry with its `clueIndex` on the board. Paid reveals before the first city preserve their indexes when the combined clue is inserted. Clue count follows available facts independently of the six-guess allowance. A correct first city ends the round without generating a reference-city clue. A win or six used guesses ends submissions.

The globe stays above the city form, separately from all text clues. One clue book starts with direction labeled **First clue** and appends each newly revealed fact once. The six guess rows show only cities, miss/correct feedback and paid reveals. Desktop places the book beside the input and board. At 700 px and below, or on a coarse pointer with a viewport no wider than 1,000 px and no taller than 500 px, it sits between them with an accessible Hide/Show button and a persistent clue count. The latter rule keeps phone rotation from hiding the toggle; JavaScript and CSS use the same query. Its open state lives only in view memory, resets for each round and changes without recreating the input. A new clue or result reopens it; an invalid, duplicate or exhausted-clue guess preserves the player's choice. Desktop always shows the full book, even after a phone collapse. Keyboard and fine-pointer guesses return focus to the city input. Coarse-pointer guesses and manual reveals focus the new book entry, or the latest guess row if no new clue was available. Results retain the board and show any remaining facts in the same book.

After direction and the first-guess clue, flight clues give destination country, straight-line distance remaining to the primary destination city, the airline when named, then the initials of every accepted destination city. Aircraft altitude, speed, vertical state and origin are excluded even when reported. The clue list remains independent of the six-attempt allowance. Distance/direction appears only as that single first-guess clue: later history rows, announcements and browser-tool state do not expose extra city-distance or direction readings. A win leads with the city actually guessed; other endings lead with the primary city. Results retain the exact reported airport and route endpoints; source and uncertainty are explained in the data dialog.

The interface uses one ruleset with precise kilometre clues and six attempts. The former difficulty menu, mode badges and set_difficulty browser action have been removed.

## Geographic feedback

Distance uses a spherical Earth radius of 6,371.0088 km. The combined first-guess clue runs from that city reference point toward the primary destination city point. The aircraft-distance clue runs from the observed aircraft to that primary point. City points are approximate and sometimes use airport positions; these are straight-line calculations, not a flight path or an urban-center measurement.

A linked-city win may have a nonzero internal distance to the primary city. Its UI says **Correct**, its bearing is null, and browser-tool history omits distance and direction.

Heading describes where the aircraft's nose points; ground track describes its movement over the ground. True heading is used when available, otherwise track. Player copy calls this the current heading or direction of travel at the observation and explains that the plane can turn before arrival. The starting place is the observation area, not the flight origin. Altitude is derived from air pressure (barometric altitude), in feet. Ground speed converts knots to km/h with a factor of 1.852. Vertical rates above 200 ft/min mean climbing, below −200 descending, and within that band nearly level. Missing values stay unavailable. There is no arrival-time estimate.

The globe receives the frozen aircraft coordinates and direction, never device coordinates. Before the round ends, it receives no hidden route. Afterward it adds a schematic airport-to-airport connection, retaining the original airport positions and aircraft projection. The far hemisphere is clipped; text carries the complete route even when a marker is out of view.

## Privacy and deployment

Location is requested only after a player action and held in memory. Provider search coordinates are rounded to two decimals. adsbdb receives only a callsign. The game stores no location and uses no analytics; provider logging is outside its control.

The local relay binds to loopback, checks Host, Origin and browser request metadata, and accepts only fixed nearby/route paths. It caps concurrent and recent uncached requests, response bytes, cache entries and request time. Provider pauses are shared across tabs. These development safeguards do not make it a public production service.

The default static build copies only `public/` to `dist/`. The `--hosted` build also emits a self-contained `dist/server/index.js`, containing the asset collection and server/worker.js relay. Its same-origin API covers telemetry, preferred routes, fallback callsign routes and optional airline names. Site authentication cookies are retained only for same-origin requests. Private access is enforced by the Sites platform. Relay cache and pause limits apply per Worker isolate; they are not a provider-wide quota.

The static build copies only `public/` to `dist/`. Live browser requests require the provider to allow the site's origin, a browser rule called CORS. Earlier checks failed that requirement; [data-source findings](data-sources.md) record the evidence. An actual hosted-origin check is required before claiming reliable public live play.

## Optional browser tools

When supported, feature-detected WebMCP actions use the same practice, starting-city, city-search, guess and clue operations as the UI. `search_cities` returns stable IDs for `submit_city_guess`; `start_city_round` chooses the observation area. Strict inputs and ordinary game guards apply. Browser state includes only the visible round, clues and guesses.

State and search omit the hidden destination and accepted-answer list until the round ends, and never expose device coordinates. Unsupported browsers use the normal interface. This experimental capability is optional.
