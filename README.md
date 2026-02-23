# Heritage Stock Atlas

Mapbox visualization of selected heritage building stock in Cape Town CBD. The selected buildings offer high value potential if upgraded and properly tenanted.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_MAPBOX_TOKEN` to a restricted Mapbox public token.
3. (Preferred) Set `VITE_STREETVIEW_PROXY_BASE` to your server-side Street View proxy URL, **or** set `VITE_STREETVIEW_API_KEY` to call Google Street View directly from the browser.
4. Run `npm install`.
5. Run `npm run dev`.

## Public Deploy Security (GitHub Pages)

- GitHub Pages is static hosting, so true secrets cannot be kept in client-side JavaScript.
- `VITE_*` values are bundled into public files at build time.
- Keep only public/restricted tokens in `VITE_*`.
- For sensitive APIs (like Google Street View), use a server-side proxy and store the real key there.

### Recommended model

- Frontend (GitHub Pages): Mapbox token + proxy endpoint URL only.
- Proxy (Cloudflare Worker, Netlify Function, or Vercel Function): holds `GOOGLE_STREETVIEW_API_KEY` secret.
- The app calls `/streetview?...` on the proxy; the browser never sees the Google key.

### Included in this repo

- GitHub Pages workflow: `.github/workflows/deploy-gh-pages.yml`
- Vite base-path config for project pages: `vite.config.js`
- Cloudflare Worker proxy template: `proxy/streetview-worker.js`

## GitHub Pages Secrets / Variables

Set in GitHub repository settings before deploy:

1. `MAPBOX_PUBLIC_TOKEN`: restricted Mapbox public token
2. `STREETVIEW_PROXY_BASE`: full URL to your deployed proxy endpoint (for example `https://<worker>.workers.dev/streetview`)

## Key hygiene

- If a key has ever been committed or shared, rotate it immediately.
- Restrict Mapbox token by URL/domain in the Mapbox dashboard.
- Restrict Google API key by source and API scope on the proxy side.

## Data Pipeline

- `npm run data:build` parses the Excel file in the parent folder and writes `public/data/heritage.geojson`.
- `npm run build` automatically refreshes GeoJSON before Vite build.
