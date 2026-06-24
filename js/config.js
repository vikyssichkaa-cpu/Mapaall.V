export const MAP_CONFIG = {
  geoJsonPath: "data/Data_settlement_fixed.geojson",
  csvPath: "Зведна табличка проєкт - Зведена таблиця.csv",
  initialCenter: [48.0159, 37.8028],
  initialZoom: 13,
  minZoom: 3,
  maxZoom: 20,
  maxBoundsPad: 0.08,
  tileUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  tileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

export const FEATURE_STYLE = {
  color: "#2f6fab",
  weight: 1.4,
  opacity: 0.95,
  fillColor: "#4f8fcf",
  fillOpacity: 0.3,
};

export const FEATURE_HOVER_STYLE = {
  color: "#1b4f80",
  weight: 2.2,
  opacity: 1,
  fillColor: "#2f6fab",
  fillOpacity: 0.48,
};
