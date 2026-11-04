export const MAP_CONFIG = {
  streetGeoJsonPath: "data/Data_fixed.geojson",
  boundaryGeoJsonPath: "data/donetsk_oblast_boundary.geojson",
  csvPath: "Зведна табличка проєкт - Зведена таблиця.csv",
  initialCenter: [48.0159, 37.8028],
  initialZoom: 7,
  minZoom: 5,
  maxZoom: 20,
  maxBoundsPad: 0.08,
  tileUrl: "https://tiles.cestra.com.ua/v1/styles/positron-uk/{z}/{x}/{y}{r}.webp?key=pk-tiles-phoEPNVLxAcySVEmuNXPFgCDUr08aYlk",
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
