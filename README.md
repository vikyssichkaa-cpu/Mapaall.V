# Вільне Радіо

Static map project based on vanilla HTML/CSS/JS + Leaflet with CartoDB Positron Light tiles.

The map uses two GeoJSON layers:

- street geometries from `data/Data_fixed.geojson`
- Donetsk oblast boundary from `data/donetsk_oblast_boundary.geojson`

## Structure

- `index.html`
- `css/styles.css`
- `js/config.js`
- `js/map.js`
- `data/Data.geojson`

## Run locally

Start any static server from this folder, for example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080`

## Deploy

Upload the whole folder to your web server and open the URL of `index.html`.

If you replace the street data or oblast boundary, keep the configured paths in `js/config.js` in sync.
