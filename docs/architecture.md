# Architecture

Flightguesser joins a nearby aircraft observation to a reported route, freezes both and asks for the destination city. The browser owns the game rules. A relay, when available, forwards a small set of requests to the data providers.

The site uses local JavaScript, HTML, CSS and data. It makes no map-service, font or CDN requests. Node’s built-in modules serve and build it.

## From a search to a round

1. **Find observations.** Hosted play uses adsb.fi; local relay and direct-browser play use adsb.lol. Coordinates are rounded to two decimal places. The search expands through 50, 100 and 250 nautical miles, about 93, 185 and 463 km.
2. **Validate the aircraft.** Require an airborne position, plausible speed and altitude, direction and a callsign in the airline format. Reject duplicate callsigns. The format is a filter; it does not prove that the aircraft carries passengers.
3. **Match a route.** Hosted play uses adsbdb. Local play first tries adsb.lol, then adsbdb if the first source fails or has no airport list. Require the exact callsign and two distinct airports. Reject routes with stops, explicit contradictions and obvious conflicts with the aircraft’s position or movement.
4. **Choose a puzzle.** Exclude destinations close to the starting place or arrival. Compare a small pool and prefer useful direction clues and variety. Resolve missing city labels from the bundled airport index without changing the reported coordinates.
5. **Open the round.** Load city choices and the optional globe, create the game, then commit destination history. Cancellation or a failed opening leaves the previous history intact.

Both route sources contain database associations, not confirmed flight plans. A fallback improves availability without confirming the answer. An optional 1.5-second airline lookup requires one exact code match; missing metadata removes that clue.

## Selection limits

| Limit | Policy |
| --- | --- |
| Whole aircraft/route search | 25 seconds |
| Nearby requests | At most 3 |
| Route requests, including fallback | At most 12; early areas receive up to 4 each |
| Candidate comparison | Up to 4 destination groups; 8 seconds after the first usable candidate |
| Initial data age | Response at most 60 seconds old; position and message ages at most 30 seconds |
| Selected position age | At most 60 seconds, checked again at selection |
| Starting-place exclusion | Destination airport and all accepted cities at least 150 km away |
| Distance remaining | Airport and main city at least 250 km from the aircraft |
| Approaching flights | Exclude aircraft below 12,000 ft, descending faster than 300 ft/min, within 500 km of arrival |

These cutoffs shape the puzzle; they do not predict arrival time. Higher, non-descending aircraft receive lookup priority across carrier and direction groups. Similar answers get one chance per destination group, so a busy hub does not gain one chance per aircraft.

The last ten opened rounds provide preferences against repeated cities, countries, airlines and distance bands. The immediately previous destination is excluded altogether, including accepted aliases and different airports serving the same city. History stays in memory and contains no player coordinates.

A fresh retained candidate can survive a later transport error or search deadline. Caller cancellation and a provider rate limit always stop the search. Empty, arrival-only or repeated-answer searches offer **Look elsewhere**, one normal search from another listed city. Provider failures and pauses offer other recovery actions.

## Cities and game state

The city index combines airport municipalities with [direct curated links](city-destinations.md). A guess wins through membership in the exact destination airport, not proximity or a shared name. Seoul and Incheon both accept ICN; only Seoul accepts GMP. Other municipalities retain an airport-specific identity and airport context in search.

The local airport file uses versioned rows to avoid thousands of repeated field names. `decodeAirportData` validates and expands it once. Search caches normalized terms and tie-break ordering, counts all matches and keeps only the requested top results.

Each round has six attempts. The first missed city inserts one fixed distance-and-direction clue after facts already revealed. Later misses reveal the next available clue. Manual reveals also use an attempt and retain their clue-history position. Empty, invalid and duplicate submissions leave state unchanged. A win or six attempts ends submissions.

Direction starts the clue book. The remaining facts are country, distance to the main destination city, named airline when available and accepted-city initials. The result retains guesses and reveals remaining clues. Phone collapse state affects only presentation; new clues reopen the book. Keyboard guesses return focus to the input, touch guesses to the new clue or latest row.

Practice uses a queue. Only a successfully opened recording moves to its back. A recording skipped because it shares the previous destination keeps its place, so both Seoul recordings remain reachable.

## Geography and presentation

Distances use a spherical Earth radius of 6,371.0088 km. They connect approximate city reference points, sometimes airport positions. A linked-city win can be far from the main point; it displays **Correct** rather than misleading miss feedback.

True heading shows the direction of the aircraft’s nose. If absent, ground track shows its movement over the ground. The globe receives the frozen aircraft position and direction. It receives the route only after the round ends and draws a schematic airport connection. The far hemisphere is clipped.

A generation counter and an abort signal protect view changes: late location and network results cannot replace a newer screen. Local-file failures allow retry. If the globe fails or takes more than 1.5 seconds to load, a compass preserves the direction clue.

Optional browser tools load only when supported and call the same guarded actions as the UI. They expose revealed clues and guesses, with the answer available only after the round ends. They never expose device coordinates.

## Serving and deployment

The static build copies an explicit public-asset list and licence notices to `dist/`. The local `publish:pages` command tests and builds committed source, pushes its backup to `main`, and pushes only the built assets to `gh-pages`. GitHub Pages serves the root of `gh-pages` using branch publishing, without a custom Actions workflow. The generated site has no OpenAI hosting dependency. The optional relay build embeds the assets in a Worker for a separately configured server host.

Runtime settings are read from the relative `./config.json` path. Static hosting serves `{ "relay": false }`; the local server and optional Worker provide their own relay settings at this path. Relative assets and data paths preserve the GitHub Pages `/flightguesser/` prefix. The legacy `/api/config` endpoint remains available in both relay implementations.

Both relays allow fixed provider paths, reject other browser origins, reject redirects, cap JSON bodies and cached responses at 5 MB, retain at most 80 cache entries for 20 seconds, and allow at most 3 concurrent and 40 uncached requests per minute. Numeric provider retry delays are respected; otherwise the application pauses for 60 seconds.

The local server binds to loopback and checks its Host header and real file paths. Hidden files and links outside the public directory are not served. Hosted nearby requests are paced one second apart. Queued requests honor cancellation and recheck provider pauses before sending. Hosted limits apply per Worker instance, not across the provider or every instance.

The GitHub Pages site is public once enabled. Same-origin relay requests retain authentication; external browser requests omit credentials. Location stays in memory, and the game uses no analytics. Providers can keep their own request logs. GitHub Pages cannot execute either relay; live searches require direct provider browser access or separate server hosting. Recorded practice needs neither.
