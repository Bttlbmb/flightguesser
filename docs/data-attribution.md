# Data attribution

The website bundles a small airport index, world geography and four recorded aircraft observations. Preserve the sources and licence notices when redistributing it or rebuilding those files.

## Aircraft observations and routes

[ADSB.lol](https://www.adsb.lol/docs/open-data/api/) publishes its API data under ODbL 1.0. The practice collection and preserved source responses derive from that data. Keep attribution and the licence obligations with any distributed derived data.

Live routes prefer adsb.lol, whose published implementation uses Virtual Radar Server standing data. [adsbdb](https://www.adsbdb.com/) supplies the fallback callsign lookup. Preserve the provider that supplied each route. The sources may be missing or outdated, and their underlying route evidence was not shown to be independent. A second database is not confirmation of a flight plan.

The four recordings were observed near Seoul on 3 October 2026 at 10:07:17 Seoul time (01:07:17 UTC). `scripts/prepare-practice.mjs` rebuilds them from `docs/evidence/selection-seoul-nearby.json` and the four matching `selection-*-route.json` responses. The [data-source findings](data-sources.md) explain what those observations establish.

Airline names use [adsbdb's documented airline lookup](https://github.com/mrjackwills/adsbdb#readme), matched to the explicit airline code supplied with the route. The practice collection uses three identity responses retrieved on 3 October 2026 and retained as `docs/evidence/airline-KAL.json`, `airline-ESR.json` and `airline-APJ.json`: Korean Air, Eastar Jet and Peach Aviation. This adds airline metadata without changing the original aircraft observation, route or recorded timestamps. It does not confirm the route or supply new aircraft observations. Practice remains entirely local; live names are optional and requested once per uncached reported code.

## Airports and cities

The airport index comes from [datasets/airport-codes](https://github.com/datasets/airport-codes), derived from [OurAirports public-domain data](https://ourairports.com/data/). The derived dataset lists [ODC-PDDL 1.0](https://github.com/datasets/airport-codes/blob/main/datapackage.json). It was retrieved on 3 October 2026.

The transformation retains active large, medium and small airports with valid identifiers, IATA codes, names, countries and coordinates. It rejects duplicate airport IDs and leaves the existing index intact if required columns are missing or no usable rows remain. Only the identifier, code, name, municipality, country, coordinates and a major-airport ranking flag are kept. Downloads are separate from the build so packaging works offline.

```sh
python3 scripts/prepare-airports.py /path/to/airport-codes.csv
```

City search uses these municipalities plus explicit city-to-airport links. Their membership evidence, primary-city choices and coordinate sources are documented in [city destinations](city-destinations.md). The list is deliberately small and is not a worldwide metropolitan directory.

## Globe

The world geography is [Natural Earth](https://www.naturalearthdata.com/) at 1:110 million scale, whose raster and vector data are [public domain](https://www.naturalearthdata.com/about/terms-of-use/). It was obtained through [`@d3-maps/atlas` 1.0.0](https://github.com/souljorje/d3-maps/tree/main/packages/atlas) on 3 October 2026. `public/data/world-land.js` merges country polygons into land, removes internal borders and properties, and rounds coordinates to four decimal places. The atlas distribution's MIT notice is retained in `public/vendor/atlas-LICENSE.txt`.

Projection, graticules and hemisphere clipping use bundled [d3-geo 3.1.1](https://github.com/d3/d3-geo/tree/v3.1.1), including its d3-array accumulator. ISC and GeographicLib notices are retained in `public/vendor/d3-geo-LICENSE.txt`. Keep both notice files in the build. Geography and projection code load locally.

The plane silhouette was authored for this project. Its position and direction depict the frozen observation. The revealed connection is schematic reported-route geography, not an actual recorded flight path.
