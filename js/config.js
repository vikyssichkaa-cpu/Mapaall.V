export const MAP_CONFIG = {
  streetGeoJsonPath: "data/Data_regeocoded.geojson",
  initialCenter: [48.0159, 37.8028],
  initialZoom: 7,
  minZoom: 5,
  maxZoom: 20,
  maxBoundsPad: 0.08,
  tileUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  tileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

// Base line weight / caps for street geometries. Colour is computed per feature
// from its own claim count (see getLineColor in map.js).
export const LINE_BASE_STYLE = {
  weight: 2.8,
  opacity: 0.98,
  lineCap: "butt",
  lineJoin: "miter",
};

// Transient emphasis while hovering a line (no persistent state, no bringToFront).
export const LINE_HOVER_STYLE = {
  color: "rgba(220, 0, 0, 1)",
  weight: 3.6,
  opacity: 1,
};

// Persistent highlight drawn on a separate overlay for the selected object.
export const SELECTION_LINE_STYLE = {
  color: "#0b6bcb",
  weight: 6,
  opacity: 0.9,
  lineCap: "round",
  lineJoin: "round",
};

// Approximate objects (streets absent from OSM) — pinned near the settlement
// centre and rendered as a distinct marker, never as a confident line.
export const APPROX_MARKER_STYLE = {
  radius: 4,
  color: "#b45309",
  weight: 1,
  opacity: 0.75,
  fillColor: "#f59e0b",
  fillOpacity: 0.45,
};

export const SELECTION_MARKER_STYLE = {
  radius: 9,
  color: "#0b6bcb",
  weight: 3,
  opacity: 0.95,
  fillColor: "#0b6bcb",
  fillOpacity: 0.2,
};
