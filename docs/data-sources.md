# Data-source findings

Tests on 3 October 2026 established a workable local prototype: a real nearby aircraft could be joined to a usable reported route and opened in the game through the localhost relay. They did not establish a confirmed destination, worldwide coverage or reliable live play from a static website.

These are dated observations. Provider availability and browser permissions can change; a successful terminal request or an old browser result does not establish access from a future deployment.

## The recorded selection

The Seoul response at 10:07:17 Seoul time (01:07:17 UTC) contained 40 aircraft. At that observation time, the application filters accepted 25 candidates. Four tested single-leg callsign matches also passed position-corridor and travel-direction checks:

| Callsign | Reported route | Distance from Seoul reference point | Straight-line distance to reported airport |
| --- | --- | ---: | ---: |
| ESR209 | Gimpo → Jeju | 13.1 km | 446.9 km |
| ESR206 | Jeju → Gimpo | 21.4 km | 10.3 km |
| APJ735 | Kansai → Gimpo | 24.6 km | 35.6 km |
| KAL2197 | Incheon → Niigata | 31.4 km | 1,076.4 km |

The original responses are `docs/evidence/selection-seoul-nearby.json` and the four `selection-{callsign}-route.json` files. They rebuild the practice collection with the recorded clock. The route column describes database associations, not verified flight plans. The airport-distance figures above are historical checks; current city clues use city reference points.

## Browser access

A browser normally needs a provider's permission to read data from another website. That rule is called CORS. In a real localhost Chromium page, adsb.lol nearby requests lacked that permission and OpenSky allowed only its own website. Alternative telemetry probes did not establish a working static-browser path. The recorded results are in `docs/evidence/browser-spike.json`.

The documented adsb.lol batch route endpoint returned an empty HTML body with HTTP 201. Its individual GET route endpoint returned useful JSON and is used by the prototype, although it was not part of the captured OpenAPI contract. Route-browser permission varied between probes. adsbdb's callsign lookup worked in that browser, but it cannot replace the aircraft observation.

The relay supplied the missing local path, using a truthful application identifier after the provider rejected Node's generic one. It remains localhost development tooling. Static deployment reliably supports recorded practice; public live deployment needs an actual hosted-origin check, provider permission or an owned service. Public CORS proxies, browser-security bypasses and frontend secrets are not dependencies.

## Bounded wider sample

A later sequential sample, from 10:49:09 to 10:49:43 Seoul time, made 18 adsb.lol requests and stopped on its first HTTP 429 rate-limit response. It found accepted reported routes around Seoul and London. New York supplied telemetry at 50 nautical miles but no measured route enrichment; the 150-nautical-mile request was rate-limited. Sydney was not reached.

Of twelve route requests, seven returned HTTP 500 and five returned JSON, including an unknown route. Three passed qualification. This small sample does not establish a worldwide success rate, uptime or an 18-request quota. Earlier traffic, shared IP use and provider load were unknown; no load test was performed. The retained request log and summary are `adsb-spike-requests.json` and `adsb-coverage-summary.json` in `docs/evidence/`.

The adsbdb fallback is an availability measure, not independent confirmation. Current search limits and cooldowns are described in [architecture](architecture.md).

## Why OpenSky is not the answer source

OpenSky's observed state response supplied positions and movement, with nullable fields and some stale positions. Its `origin_country` describes transponder registration, not departure country. Historical flight and arrival records describe completed flights; they cannot establish the destination of a currently flying aircraft. See [OpenSky's REST documentation](https://openskynetwork.github.io/opensky-api/rest.html) for field meanings and current access limits before reconsidering it.

## Remaining limits

No tested source confirms an actual live destination. Current speed cannot predict arrival time, and straight-line distance is not remaining flight-path distance. Browser recordings do not prove geolocation accuracy, real-phone keyboard behavior or screen-reader output.

Before promising reliable public live play, test from the intended hosted address and measure selection across regions and times. Keep requests bounded, honor rate limits, and follow the provider's terms and contact requirements. The optional `scripts/spike-adsb.mjs` sampler records a new dated sample; normal tests and builds remain offline.
