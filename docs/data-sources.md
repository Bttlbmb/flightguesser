# Data sources and limits

A nearby position is observable; its destination is harder to establish. Flightguesser uses a callsign-to-airport database match as its answer. That can be useful for a game, but it is not a confirmed flight plan.

## Current paths

| Mode | Aircraft positions | Reported routes |
| --- | --- | --- |
| Optional Worker relay (backup) | adsb.fi through the relay | adsbdb |
| Local live relay or direct browser | adsb.lol | adsb.lol, with adsbdb fallback |
| Recorded practice | Bundled adsb.lol observations | Bundled adsb.lol matches |

The fallback helps when one service is unavailable. It does not establish an independent confirmation. Airline names use explicit route metadata or an exact adsbdb airline-code lookup.

Direct requests from a static website need a provider’s permission to read responses from that website’s address. This browser rule is called CORS. A successful terminal request does not establish browser access. The local and hosted relays avoid that direct-browser requirement by forwarding requests through their own server.

GitHub Pages publishes the static build without a relay. On 5 October 2026, position requests to adsb.lol and adsb.fi with `Origin: https://bttlbmb.github.io` returned HTTP 200 without `Access-Control-Allow-Origin`; adsbdb route responses included `Access-Control-Allow-Origin: *`. This prevents direct browser position access despite successful server requests. Recorded practice remains available without live services.

## What the recordings establish

The preserved Seoul observation was made on 3 October 2026 at 01:07:17 UTC, or 10:07:17 Seoul time. It contained 40 aircraft; 25 passed the initial aircraft filters at the recorded time. Four route matches passed the route checks and became practice:

| Callsign | Reported airports |
| --- | --- |
| KAL2197 | Incheon → Niigata |
| ESR209 | Gimpo → Jeju |
| APJ735 | Kansai → Gimpo |
| ESR206 | Jeju → Gimpo |

The original observation, four route responses and three airline responses remain in `docs/evidence/`. They reproduce the bundled rounds using their original clock. Current live selection rejects some short or local arrivals found in these older practice records.

Earlier browser probes found that aircraft services did not consistently allow the localhost origin. Wider samples also encountered missing routes, HTTP failures and provider pauses. These findings establish failure cases, not an uptime figure, worldwide success rate or published request quota. Superseded captures and screenshots have been removed; Git retains their history.

## What remains uncertain

Availability depends on receiver coverage, traffic, usable routes and the selection filters. A response with no aircraft does not prove that the sky is empty. A busy area can still lack a playable flight.

One recorded sky moment cannot establish worldwide variety or human difficulty. The four practice recordings have only three destination cities; replay eventually becomes a memory exercise. Some uncurated airports also use less familiar municipality names. Broader dated recordings and sourced city links would help, but require separate evidence.

OpenSky’s registration country is not a departure country, and its historical arrivals describe completed flights. Neither supplies the destination of a currently flying aircraft. Reconsidering that source requires checking [its current field definitions](https://openskynetwork.github.io/opensky-api/rest.html).

Check live access from the intended hosted address before making availability claims. Keep samples bounded and dated, honor provider pauses and preserve the distinction between a reported route and a verified destination. [Architecture](architecture.md) lists the current search limits; [verification](qa.md) describes the checks and their scope.
