# Destination cities

An airport can serve a city beyond its own municipality. Narita Airport, for example, is associated with both Tokyo and Narita. Flightguesser accepts both for an NRT answer while keeping them as separate city choices. Tokyo also matches Haneda; Narita does not.

The local city index combines airport municipalities with a small list of explicit links in `public/data/city-links.js`. That list covers sixteen city choices and is a starting set, not a worldwide metropolitan directory. The links do not change the reported airport, its coordinates or route attribution.

## Direct membership and the main city

Each city has a stable ID and direct airport memberships. One linked city can be designated primary for an airport: it supplies the main answer label and reference point for distance feedback. That is a product choice, not an official ranking.

| Reported airport | Accepted curated cities | Main city |
| --- | --- | --- |
| ICN | Seoul, Incheon | Seoul |
| GMP | Seoul | Seoul |
| NRT | Tokyo, Narita | Tokyo |
| HND | Tokyo | Tokyo |
| EWR | New York, Newark | New York |
| KRK | Kraków, Balice | Kraków |
| ATH | Athens, Spata-Artemida | Athens |

Sharing an airport never imports another city's airports. Incheon cannot acquire GMP through Seoul, and Newark cannot acquire JFK or LGA through New York. Names are display/search values rather than identity: Portland, Oregon and Portland, Maine remain distinct IDs, points and choices.

Uncurated municipalities retain airport-bound identities and airport context in search. If a route provider supplies only an airport name where a municipality belongs, the resolver uses a meaningful bundled municipality when available. It does not invent a city for an unresolved destination.

## Membership evidence

The original twelve associations were reviewed on 3 October 2026; Kraków and Athens were added on 4 October 2026 after the playtest. The listed sources support a served-city or municipality association; they do not certify any flight's destination. Airport IDs are matched to the bundled index.

| City | Direct airports; primary assignment | Source and meaning |
| --- | --- | --- |
| Seoul | ICN, GMP; primary for both | [Visit Seoul's airport guide](https://english.visitseoul.net/airport-to-seoul) describes both airports' connections with central Seoul. |
| Incheon | ICN; secondary | [Visit Seoul's information-center addresses](https://english.visitseoul.net/essential-Info-article/Tourist-Information-Centers_/396) place airport facilities in Incheon, while Gimpo's address is in Seoul. |
| Tokyo | HND, NRT; primary for both | [JNTO's Haneda guide](https://www.japan.travel/en/plan/airport-access/haneda-airport/) identifies Tokyo's two major airports. |
| Narita | NRT; secondary | [Narita Airport Corporation's address](https://www.narita-airport.jp/en/company/naa/profile/summary/) places its head office in Narita City. This does not establish every airport parcel's municipality. |
| London | LHR, LGW, LCY, LTN, STN, SEN; primary for all | [Visit London's guide](https://www.visitlondon.com/traveller-information/travel-to-london/airport) lists these six airports, including ones outside London proper. |
| New York | JFK, LGA, EWR; primary for all | [JFK's connection guide](https://www.jfkairport.com/flights/connections-guide/travel-between-airports) groups these travel options. `NYC` is a search alias. |
| Newark | EWR; secondary | KEWR's municipality in the bundled airport index is Newark. |
| Paris | CDG, ORY; primary for both | [Paris tourism's arrival guide](https://parisjetaime.com/eng/convention/article/Arriving-train-plane-a1870) names these international airports. The small mapping does not settle wider Paris-serving usage. |
| Niigata | KIJ; primary | [The airport's official overview](https://www.niigata-airport.gr.jp/about/) locates it in Niigata City. |
| Jeju City | CJU; primary | [Korea Airports Corporation](https://www.airport.co.kr/jejueng/cms/frCon/index.do?MENU_ID=270) locates it in Jeju-si. |
| Portland, Oregon | PDX; primary | [PDX's contact page](https://www.flypdx.com/Contact?culture=en) gives a Portland, Oregon address. |
| Portland, Maine | PWM; primary | [The jetport's contact page](https://portlandjetport.org/contact-us) gives a Portland, Maine address. |
| Kraków | KRK; primary | [Kraków Airport's catchment guide](https://krakowairport.pl/en/company/airport/about-airport/about/catchment-area) describes connections to Kraków's center. |
| Balice | KRK; secondary | EPKK's municipality in the bundled airport index. The original `airport:PL:EPKK` ID and airport context are retained. |
| Athens | ATH; primary | [Athens Airport's transport guide](https://www.aia.gr/en/traveller/transportation-airport/public-transportation-airport) describes its connection to Athens city center. |
| Spata-Artemida | ATH; secondary | LGAV's municipality in the bundled airport index. The original `airport:GR:LGAV` ID and airport context are retained. |

Served city, physical municipality and a formal IATA city code mean different things. The [2022 IATA notice](https://www.iata.org/contentassets/c33c192da39a42fcac34cb5ac81fd2ea/ads_ab_2022_02-joint-iata-atpco-notification-ccd-list.pdf) removed EWR from NYC for pricing, fares and mileage; the travel association here does not override that rule. London's mapping likewise does not claim formal `LON` code membership.

## Reference points

Feedback needs one point for each city. Five points are approximations retained from the original starting-city selector. The remaining eleven deliberately use a bundled airport position. These are reference points, not official city centers or boundary centroids.

| City | Latitude, longitude | Source |
| --- | --- | --- |
| Seoul | 37.5665, 126.978 | Original starting-city selector |
| Tokyo | 35.6762, 139.6503 | Original starting-city selector |
| London | 51.5074, −0.1278 | Original starting-city selector |
| New York | 40.7128, −74.006 | Original starting-city selector |
| Paris | 48.8566, 2.3522 | Original starting-city selector |
| Incheon | 37.469101, 126.450996 | RKSI airport fallback |
| Narita | 35.76858, 140.388714 | RJAA airport fallback |
| Newark | 40.6894, −74.170545 | KEWR airport fallback |
| Niigata | 37.954166, 139.112189 | RJSN airport fallback |
| Jeju City | 33.512058, 126.492548 | RKPC airport fallback |
| Portland, Oregon | 45.588699, −122.598 | KPDX airport fallback |
| Portland, Maine | 43.646198, −70.309303 | KPWM airport fallback |
| Kraków, Balice | 50.077702, 19.7848 | EPKK airport fallback, for each city |
| Athens, Spata-Artemida | 37.936401, 23.9445 | LGAV airport fallback, for each city |

The membership pages above do not supply these numeric coordinates. Airport fallbacks come from `public/data/airports.json`; retain its [attribution](data-attribution.md). A route provider may report a slightly different airport position. The city reference point does not overwrite that original route fact.

Initial clues use accepted city names: KRK gives K / B and ATH gives A / S. The familiar served city is primary and ranks first in name/code searches; homonyms keep separate identities and memberships.

Miss feedback runs from the guessed city point toward the primary destination city point. The aircraft-distance clue also targets the primary city. A linked correct city can be some distance from that point, so its feedback says **Correct** rather than showing a misleading distance or direction. The result's globe continues to use the exact reported airports.

## Updating the list

Entries contain `id`, `name`, `country`, `lat`, `lon`, `airportIds` and `primaryFor`, with optional `region` and `aliases`. `coordinateSource`, `membershipSources` and `membershipKind` record provenance. They do not expand membership. The retained Balice and Spata-Artemida choices also keep `fallback: true` for their original airport context and ranking.

Every primary assignment must be a direct link; an airport may have at most one explicit primary city. Linked IDs must exist in the bundled index and match the city country. Airport-coordinate fallbacks must match their named source row.

Add direct evidence and choose the primary presentation explicitly. Do not derive extra links from a radius, a shared name or another city. Replacing a provisional coordinate requires its own source and documented value, separately from membership. Preserve the ICN/GMP, HND/NRT, KRK/ATH and Portland cases in tests when changing the list.
