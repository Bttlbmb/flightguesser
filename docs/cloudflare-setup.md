# Connect the GitHub game to Cloudflare

The website remains on GitHub Pages. A separate Cloudflare Worker fetches live positions from adsb.lol and reported routes and airline names from adsbdb. No custom GitHub Actions workflow is needed.

## Create the helper

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) and open **Workers & Pages**.
2. Choose **Create application**, then the basic **Hello World** Worker option. Name it **flightguesser-relay** and deploy it.
3. Open the new Worker’s **Edit code** editor. Replace the example code with the complete contents of [`cloudflare/worker.js`](../cloudflare/worker.js), then deploy the edited code.
4. Copy its public HTTPS address, such as `https://flightguesser-relay.your-subdomain.workers.dev`.

Opening that address should show a short response identifying the Flightguesser relay. Opening `/api/config` should report `relay: true`, `telemetryProvider: adsb.lol` and `routeProvider: adsbdb`. These checks establish that the Worker is installed, not that its providers are reachable.

The earlier Worker used adsb.fi. On 5 October 2026, the deployed Worker received HTTP 403 from that provider while requests from the maintainer’s computer succeeded. The standalone Cloudflare version therefore uses adsb.lol; verify an actual nearby request after redeploying before enabling the website connection. This change does not establish why adsb.fi rejected the request or guarantee that a different provider is reachable from Cloudflare.

The dashboard file is self-contained JavaScript. It needs no database, bindings, secrets or packages. If editing the source relay, run `npm run build:relay` to regenerate it. `server/worker.js` and `server/cloudflare.js` are the authoritative sources.

For command-line deployment, the equivalent configuration is in `cloudflare/wrangler.jsonc`. After Cloudflare login, Wrangler can deploy that configuration directly. Dashboard deployment does not require installing Wrangler.

## Connect and verify

Send the public Worker address to the person maintaining the website. The maintainer runs:

```sh
npm run connect:relay -- https://flightguesser-relay.your-subdomain.workers.dev
```

The command verifies the Worker’s configuration, its browser permission for `https://bttlbmb.github.io`, and a live aircraft request near Seoul before saving the address in `public/config.json`. If aircraft data fails, check the Worker’s **Logs → Live** for a line beginning with `Flight provider response` or `Flight relay failure`. Commit the verified configuration on `main`, then run `npm run publish:pages` to publish the game’s connection to `gh-pages`. The Pages setting remains **Deploy from a branch → gh-pages → /(root)**.

Verify a Seoul search from the published GitHub website. If providers are reachable but no usable route survives validation, the game should explain that result; it must never turn a recording into a live flight. Recorded practice works while the Worker is unavailable.

## What the helper allows

Only the fixed nearby, callsign and airline endpoints are forwarded. Browsers from `https://bttlbmb.github.io` receive permission headers; requests from other browser origins are rejected. These permissions are not private authentication: people can still make direct server requests to a public Worker. Caching, response size limits, request limits, provider pauses and cancellation are retained. The in-memory limits apply per Worker instance, not globally across Cloudflare.

The [adsb.lol API](https://www.adsb.lol/docs/open-data/api/) is available to everyone under ODbL 1.0; the game retains provider attribution. The Worker keeps nearby requests one second apart per instance. No live aircraft responses are saved into the static website.

Cloudflare references: [Dashboard setup](https://developers.cloudflare.com/workers/get-started/dashboard/) and [CORS proxy example](https://developers.cloudflare.com/workers/examples/cors-header-proxy/).
