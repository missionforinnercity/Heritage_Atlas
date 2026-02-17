# Heritage Stock Atlas

Mapbox visualization of selected heritage building stock in Cape Town CBD. The selected buildings offer high value potential if upgraded and properly tenanted. 

## Setup

1. Copy `.env.example` to `.env.local` and add your Mapbox token.
2. Run `npm install`.
3. Run `npm run dev`.

## Data Pipeline

- `npm run data:build` parses the Excel file in the parent folder and writes `public/data/heritage.geojson`.
- `npm run build` automatically refreshes GeoJSON before Vite build.
