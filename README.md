# Flightguesser

A plane flies by. Where is it going? Flightguesser gives you six tries to guess its reported destination city. It starts with the aircraft’s direction, then adds clues as you play.

The answer comes from a database that links a flight’s radio identifier, or callsign, to airports. That link can be outdated or wrong. Each round keeps one aircraft observation and one reported route fixed; the result shows the exact airport and its source.

## Play locally

Install [Node.js](https://nodejs.org/) 22 or newer. There are no packages to install.

```sh
npm start -- --port=5183
```

Open [localhost:5183](http://localhost:5183), then use your location or choose a starting city. The starting place is where the game looks for a plane, not where it took off. If live data is unavailable, you can choose recorded practice: four real observations from 3 October 2026, clearly dated and labelled.

For live development, use the local relay, a small server that forwards requests to the aircraft provider:

```sh
npm run dev:live -- --port=5183
```

The relay runs only on your computer. A live round still needs a fresh observation and a usable route. If the port is occupied, choose another, such as `--port=5184`.

## The six tries

Search by city, airport name or airport code, choose a result, then press **Guess**. Empty, invalid and repeated choices do not use a try.

Your first missed city reveals its distance and direction to the main destination city. That clue stays fixed. Later misses reveal the destination country, distance remaining, airline when available, then a city initial. Missing facts are skipped. **Reveal next clue** also uses one try. All clues stay in the clue book; Hide/Show on a phone changes its visibility for free.

Several cities can count for one airport. Tokyo accepts Haneda and Narita; Seoul and Incheon both accept Incheon Airport. These are direct links: Incheon does not also accept Gimpo. The [city policy](docs/city-destinations.md) explains the accepted names and approximate reference points.

Consecutive rounds avoid the same destination city, including different airports serving it. Live selection favours flights still some distance from arrival and varies recent countries, airlines and route lengths. When an area has no playable flight, **Look elsewhere** searches another listed city. Recorded practice remains a separate choice.

The globe shows the frozen observation. The plane can turn before arrival. Distances are straight-line estimates in kilometres; there is no arrival-time prediction. After the round, the dotted line connects the reported airports rather than tracing an actual flight path.

## Location and privacy

The browser requests location only after **Use my location**. You can choose a city instead. Search coordinates are rounded to two decimal places before they reach the aircraft provider. The game keeps location in memory, stores no location history and uses no analytics. Providers may keep request logs. Browser location requires HTTPS or localhost.

## Build and check

```sh
npm test
npm run build
npm run preview -- --port=5184
```

The build puts the website and licence notices in `dist/`. It needs no network access. Rebuild this folder instead of editing it. An ordinary static host supports recorded practice; direct live requests also need the provider to allow the website’s address.

## Publish on GitHub Pages

The repository is [Bttlbmb/flightguesser](https://github.com/Bttlbmb/flightguesser). The workflow in `.github/workflows/pages.yml` tests the game, verifies the recordings, builds `dist/`, and deploys that folder whenever `main` changes. All source code, data preparation tools, documentation and earlier Git history stay in the repository as a backup. Only the generated public assets are served as the website.

After making the repository public:

1. Open **Settings → Pages** and select **GitHub Actions** under **Build and deployment → Source**. No publishing branch or folder is needed.
2. Open **Actions → Deploy GitHub Pages → Run workflow**, choose **main**, and run it. The first push may have failed before Pages was enabled; a fresh run uses the saved source.
3. The website will be at [bttlbmb.github.io/flightguesser/](https://bttlbmb.github.io/flightguesser/).

Keep `main` as the default branch. If you rename it, update `on.push.branches` in the workflow and any `github-pages` environment branch rules. Future pushes to `main` publish automatically. No deployment secrets or OpenAI hosting account are required.

Assets, imports, local data and runtime configuration use relative URLs so the site works under `/flightguesser/` and at a domain root. The static configuration in `public/config.json` disables the server relay.

### Live-data limitation

GitHub Pages cannot run a live-data relay. On 5 October 2026, probes with the GitHub Pages origin found no browser-access permission header on either adsb.lol or adsb.fi position responses. Recorded practice works entirely from the bundled files and is available directly from the start screen. Live searches keep their existing error and recovery flow, but currently need a separately hosted relay or a provider that permits direct browser access. The static site does not contact the old OpenAI host.

### Optional relay backup

The Worker relay code remains in the repository as a backup. It uses adsb.fi positions and adsbdb routes. Build and preview it locally with:

```sh
npm run build:hosted
npm run preview:hosted -- --port=5187
```

The preview runs the generated relay locally and can contact real providers. This build is separate from GitHub Pages and no longer includes an OpenAI hosting manifest. Follow the provider’s personal, non-commercial terms when deploying a relay elsewhere.

| Folder | Purpose |
| --- | --- |
| `public/` | Browser game, local data and licence notices |
| `server/` | Optional live-data relay, retained as a backup |
| `scripts/` | Build, local servers and data preparation |
| `tests/` | Offline regression tests |
| `docs/` | Design rules, sources and verification |
| `docs/evidence/` | Original responses used to rebuild practice |
| `dist/` | Generated website, excluded from Git |

For changes, read [development notes](CONTRIBUTING.md). [Architecture](docs/architecture.md), [data attribution](docs/data-attribution.md) and [verification](docs/qa.md) cover the implementation, sources and remaining limits.
