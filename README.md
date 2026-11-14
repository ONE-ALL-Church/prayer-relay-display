# Prayer Relay Display

Give a public Prayer.Global relay a live map for your auditorium. The side screen shows a QR code and participation totals. The rear LED view puts coverage at the top center for a wide display.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ONE-ALL-Church/prayer-relay-display)

[Try the side screen](https://prayer-relay-display.oneandall.workers.dev/?view=side&demo=1) · [Try the rear LED](https://prayer-relay-display.oneandall.workers.dev/?view=led&demo=1) · [Try the participant overview](https://prayer-relay-display.oneandall.workers.dev/r/demo)

## Put it on your screens

1. Create a public custom relay in [Prayer.Global](https://prayer.global/). Copy its public map or display link.
2. Select **Deploy to Cloudflare**. Sign in to Cloudflare and connect GitHub when prompted. Accept the build and deploy commands.
3. Open your deployment's `workers.dev` URL. Paste the relay link and choose **Save relay and create links**.
4. Copy **Side screen** and **Rear LED** to your production computers. Keep the **Setup link** for changes.
5. Open each link on its intended display. Move the pointer to find **Full screen** and **Preview 100%**.
6. Scan the side-screen QR code with a phone before service. Confirm it opens the correct relay.

Name each relay to find it in **Saved relays**. Each relay has its own organization name, headline, accent color, optional introduction, and public HTTPS prayer link. Save more than one relay, then open each relay from the list to edit or copy its links. Saved relays are stored in this browser. A setup link can open the same settings on another device.

### Choose where the QR code goes

- **Open the prayer link** takes participants straight to Prayer.Global or to the custom link you enter.
- **Open a branded overview** shows your organization name, introduction, and current coverage. Choose **Start praying** to open the configured prayer link.
- **Open a branded overview at a short URL** puts a short address on the screen and in its QR code, such as `prayer-relay-display.example.workers.dev/r/outreach`.

To publish a short URL, enter a unique slug in setup and save the relay. Copy its settings into [public/relays.json](public/relays.json) in your deployment repository and redeploy. Keep the entries for the other relays. Open the relay from **Published relays** to copy its screen links. A published relay uses the same URL across devices. Changing its published settings and redeploying updates existing links, including printed QR codes.

Open setup on the hostname you want to use on the screen. The short links use that hostname. This works on your deployment's `workers.dev` subdomain and any [Cloudflare Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) connected to the Worker. Cloudflare manages the hostname. The app manages the `/r/` paths.

For a preview, open `/r/demo` for the overview or `/r/demo?view=side` to see the short address and QR code on a screen.

Use the demo links to rehearse without a relay. Demo screens show **Demo data**. The **Preview 100%** button works on either layout and leaves live data alone. The live celebration plays when the first lap crosses 100% during an active connection. The number can continue past 100% if the relay starts another lap.

## Hosting and data

The project works on [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/). It uses a `workers.dev` address, static assets, and one small relay lookup route. Cloudflare applies its Free plan request limit to the lookup. Screen refreshes read from Prayer.Global directly. There is no database, API key, or paid service to set up.

Standard screen links carry their settings in the URL. Short links load the published settings by slug. Both work on a fresh browser. Use public values only.

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
