# NYC Atlas

A mobile-first interactive map for discovering New York City's history and popular places.

The first version uses MapLibre GL JS with CARTO Positron tiles, keeps navigation focused on
the five boroughs, and presents the same phone-sized canvas on desktop.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run build
npm test
npm run lint
```

Map data is provided by OpenStreetMap contributors and rendered with CARTO basemap tiles.
Review the tile provider's commercial terms before a public production launch.
