# Data attribution

The website bundles airport data, world geography and four recorded aircraft observations. Keep the sources and licence notices when redistributing or rebuilding them.

## Aircraft, routes and airlines

[adsb.lol](https://www.adsb.lol/docs/open-data/api/) publishes API data under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The recorded practice data and its preserved source responses derive from that data. Retain attribution and the applicable licence obligations.

The optional Worker relay uses [adsb.fi](https://adsb.fi/) under its [personal, non-commercial API terms](https://github.com/adsbfi/opendata#terms). That relay is not deployed by the GitHub Pages workflow. It preserves observation timestamps and paces nearby requests one second apart per Worker instance. Live responses are cached briefly in memory and are not bundled with the website.

Hosted reported routes use [adsbdb](https://www.adsbdb.com/). Local live play prefers adsb.lol, whose route service uses Virtual Radar Server standing data, with adsbdb as fallback. Keep the source on each route; neither database confirms a flight plan.

The four practice observations were recorded near Seoul on 3 October 2026 at 01:07:17 UTC. Their sources are:

- `docs/evidence/selection-seoul-nearby.json`
- Four matching `selection-{callsign}-route.json` files
- `airline-KAL.json`, `airline-ESR.json` and `airline-APJ.json`, retrieved the same day

The airline responses name Korean Air, Eastar Jet and Peach Aviation. Names require one exact match to the route’s reported code. Adding that metadata does not change the aircraft observations, routes or timestamps. Practice makes no provider requests. See [data-source limits](data-sources.md).

## Airports and cities

The airport index was retrieved on 3 October 2026 from [datasets/airport-codes](https://github.com/datasets/airport-codes), derived from [OurAirports public-domain data](https://ourairports.com/data/). The derived dataset lists [ODC-PDDL 1.0](https://github.com/datasets/airport-codes/blob/main/datapackage.json).

Preparation keeps large, medium and small airports with valid IDs, IATA codes, names, countries and coordinates. The bundled file preserves those values and a major-airport ranking flag in compact versioned rows. Duplicate IDs, missing columns and an empty result stop preparation before replacing the index. Downloads are separate from the offline build.

[Destination cities](city-destinations.md) records the direct city links, their membership evidence and coordinate sources. The list is a small curated set, not a worldwide metropolitan directory.

## Globe

World land uses [Natural Earth](https://www.naturalearthdata.com/) at 1:110 million scale. Its geography is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). The source was obtained through [`@d3-maps/atlas` 1.0.0](https://github.com/souljorje/d3-maps/tree/main/packages/atlas) on 3 October 2026. The local file merges country polygons into land, removes borders and properties, and rounds coordinates to four decimals.

Projection and clipping use bundled [d3-geo 3.1.1](https://github.com/d3/d3-geo/tree/v3.1.1), including the d3-array accumulator. Preserve `public/vendor/atlas-LICENSE.txt` and `public/vendor/d3-geo-LICENSE.txt`, which contain the MIT, ISC and GeographicLib notices. Both are included in every build.

The plane silhouette was authored for this project. Its direction and position show the frozen observation. The revealed airport connection is schematic, not a recorded flight path.
