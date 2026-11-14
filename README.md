# Prayer Relay Display

Give a public Prayer.Global relay a live map for your auditorium. The side screen shows a QR code and participation totals. The rear LED view puts coverage at the top center for a wide display.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ONE-ALL-Church/prayer-relay-display)

[Try the side screen](https://prayer-relay-display.bscottdavis.workers.dev/?view=side&demo=1) · [Try the rear LED](https://prayer-relay-display.bscottdavis.workers.dev/?view=led&demo=1)

## Put it on your screens

1. Create a public custom relay in [Prayer.Global](https://prayer.global/). Copy its public map or display link.
2. Select **Deploy to Cloudflare**. Sign in to Cloudflare and connect GitHub when prompted. Accept the build and deploy commands.
3. Open your deployment's `workers.dev` URL. Paste the relay link and choose **Create screen links**.
4. Copy **Side screen** and **Rear LED** to your production computers. Keep the **Setup link** for changes.
5. Open each link on its intended display. Move the pointer to find **Full screen** and **Preview 100%**.
6. Scan the side-screen QR code with a phone before service. Confirm it opens the correct relay.

The form also accepts an organization name, headline, accent color, and public HTTPS prayer link. By default the QR code opens the relay map. If you enter a custom link, test its redirect on a phone.

Use the demo links to rehearse without a relay. Demo screens show **Demo data**. The **Preview 100%** button works on either layout and leaves live data alone. The live celebration plays when the first lap crosses 100% during an active connection. The number can continue past 100% if the relay starts another lap.

## Hosting and data

The project works on [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/). It uses a `workers.dev` address, static assets, and one small relay lookup route. Cloudflare applies its Free plan request limit to the lookup. Screen refreshes read from Prayer.Global directly. There is no database, API key, or paid service to set up.

Screen links carry the settings in the URL. Each link works on a fresh browser. Use public values only. To make a change, open the setup link, change the setting, and share the new screen links.

Prayer.Global handles participation and owns the totals. The display reads aggregate statistics and highlights the places in the public grid. Its map loads the [Location Grid boundaries](https://github.com/DiscipleTools/location-grid-project) from the upstream host. The repository does not include those boundaries. Coverage totals can include places whose boundaries are missing. [Prayer.Global data sources](https://prayer.global/content_app/data_sources/)

If the feed stops responding, the open screen keeps the last valid values and shows **Updates delayed**. It retries automatically. If you reload during an outage, it waits for the feed. If the map source is unavailable, totals can still update.

## Develop locally

Use Node.js 22 or later.

```sh
npm ci
npm test
npm run dev
```

Open [localhost:8787](http://localhost:8787). To deploy from the CLI, run `npm run deploy` with Wrangler signed in to the intended Cloudflare account.

## License and credits

The display code is [MIT licensed](LICENSE). Sample geography uses the [Natural Earth 1:110m country boundaries](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson) under [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/). Sample activity is fictional. Live geographic data retains its upstream terms. This project is independent of Prayer.Global.
