# Khmelnytskyi Leaflet Map

Static map project based on vanilla HTML/CSS/JS + Leaflet with CartoDB Positron Light tiles.

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

If you replace the data file, keep the same path:

`data/Data.geojson`
