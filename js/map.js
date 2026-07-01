import {
  MAP_CONFIG,
  HROMADA_OUTLINE_STYLE,
  LINE_BASE_STYLE,
  LINE_HOVER_STYLE,
  SELECTION_LINE_STYLE,
} from "./config.js?v=4";

const map = L.map("map", {
  zoomControl: true,
  minZoom: MAP_CONFIG.minZoom,
  maxZoom: MAP_CONFIG.maxZoom,
  zoomDelta: 0.5,
  zoomSnap: 0.5,
  maxBoundsViscosity: 0.35,
  worldCopyJump: false,
});

const statusEl = document.getElementById("status");
const searchInput = document.getElementById("map-search-input");
const searchButton = document.getElementById("map-search-button");
const searchResultsEl = document.getElementById("map-search-results");

let streetLayer;
let approxCluster;
let selectionLayer;
let currentGeoJson = null;
let maxClaimCount = 1;
let selectedId = null;

// Selection / disambiguation indexes, keyed by the feature's stable ID.
const layersById = new Map(); // id -> Leaflet layer
const featureById = new Map(); // id -> GeoJSON feature
const geomKeyById = new Map(); // id -> geometry signature
const idsByGeomKey = new Map(); // geometry signature -> [id, ...]

L.tileLayer(MAP_CONFIG.tileUrl, {
  attribution: MAP_CONFIG.tileAttribution,
  subdomains: "abcd",
  maxZoom: MAP_CONFIG.maxZoom,
}).addTo(map);

// Dedicated pane for hromada outlines: above the basemap tiles (200) but below the
// street/overlay pane (400), and click-through so it stays purely decorative.
map.createPane("hromadaPane");
map.getPane("hromadaPane").style.zIndex = 350;
map.getPane("hromadaPane").style.pointerEvents = "none";

L.control.scale({ imperial: false }).addTo(map);

const DONETSK_BOUNDS = L.latLngBounds([46.88, 36.55], [49.05, 38.87]);
map.setMaxBounds(DONETSK_BOUNDS.pad(MAP_CONFIG.maxBoundsPad));
map.setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);

attachSearchHandlers();
loadHromadaOutlines();
loadGeoJson();

// ── Coordinate normalization / boundary filtering ─────────────────────────────

function clampCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || typeof coordinate[0] !== "number" || typeof coordinate[1] !== "number") {
    return coordinate;
  }
  const lng = Math.min(DONETSK_BOUNDS.getEast(), Math.max(DONETSK_BOUNDS.getWest(), coordinate[0]));
  const lat = Math.min(DONETSK_BOUNDS.getNorth(), Math.max(DONETSK_BOUNDS.getSouth(), coordinate[1]));
  return [lng, lat, ...coordinate.slice(2)];
}

function normalizeCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return coordinates;
  }
  if (typeof coordinates[0] === "number") {
    return clampCoordinate(coordinates);
  }
  return coordinates.map(normalizeCoordinates);
}

function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return geometry;
  }
  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    return { ...geometry, geometries: geometry.geometries.map(normalizeGeometry) };
  }
  return { ...geometry, coordinates: normalizeCoordinates(geometry.coordinates) };
}

function normalizeGeoJson(geoJson) {
  if (!geoJson || !Array.isArray(geoJson.features)) {
    return geoJson;
  }
  return {
    ...geoJson,
    features: geoJson.features.map((feature) => {
      if (!feature || !feature.geometry) return feature;
      return { ...feature, geometry: normalizeGeometry(feature.geometry) };
    }),
  };
}

// The re-geocoded data is already clean and anchored to Donetsk settlements, so
// we only drop features with no renderable geometry. (The old length/boundary
// filters wrongly hid short real streets and legit border towns like Сіверськ.)
function hasRenderableGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;
  const { type, coordinates } = geometry;
  if (type === "Point") {
    return Array.isArray(coordinates) && typeof coordinates[0] === "number";
  }
  if (type === "LineString") {
    return Array.isArray(coordinates) && coordinates.length >= 2;
  }
  if (type === "MultiLineString") {
    return Array.isArray(coordinates) && coordinates.some((line) => Array.isArray(line) && line.length >= 2);
  }
  return false;
}

function filterStreetGeoJson(geoJson) {
  if (!geoJson || !Array.isArray(geoJson.features)) return geoJson;
  return {
    ...geoJson,
    features: geoJson.features.filter((feature) => hasRenderableGeometry(feature?.geometry)),
  };
}

// ── Data loading & rendering ──────────────────────────────────────────────────

// Decorative hromada boundaries. Loaded independently of the claim data so it never
// blocks or breaks the map; failure is silent (outlines are optional context).
let hromadaLayer;
async function loadHromadaOutlines() {
  try {
    const res = await fetch(MAP_CONFIG.hromadaGeoJsonPath, { cache: "no-store" });
    if (!res.ok) throw new Error(`hromada outlines: ${res.status}`);
    const gj = await res.json();
    if (hromadaLayer) hromadaLayer.remove();
    hromadaLayer = L.geoJSON(gj, {
      pane: "hromadaPane",
      interactive: false,
      style: () => HROMADA_OUTLINE_STYLE,
    }).addTo(map);
  } catch (error) {
    console.warn("Hromada outlines not shown:", error);
  }
}

async function loadGeoJson() {
  setStatus("Завантаження обʼєктів мапи...");
  try {
    const streetResponse = await fetch(MAP_CONFIG.streetGeoJsonPath, { cache: "no-store" });
    if (!streetResponse.ok) throw new Error(`Failed to load street GeoJSON: ${streetResponse.status}`);

    const geoJson = await streetResponse.json();
    currentGeoJson = filterStreetGeoJson(normalizeGeoJson(geoJson));
    maxClaimCount = computeMaxClaimCount(currentGeoJson);
    renderGeoJsonLayer();
  } catch (error) {
    console.error(error);
    setStatus("Помилка завантаження даних. Перевірте шляхи до файлів.", true);
  }
}

function computeMaxClaimCount(geoJson) {
  let max = 1;
  (geoJson?.features || []).forEach((feature) => {
    max = Math.max(max, parseCount(feature?.properties?.["COUNTA of Тип заяви"]));
  });
  return max;
}

function renderGeoJsonLayer() {
  if (!currentGeoJson) return;

  if (streetLayer) streetLayer.remove();
  layersById.clear();
  featureById.clear();
  geomKeyById.clear();
  idsByGeomKey.clear();
  selectedId = null;

  const feats = Array.isArray(currentGeoJson.features) ? currentGeoJson.features : [];
  const lineFeatures = feats.filter((f) => f.geometry && f.geometry.type !== "Point");
  const pointFeatures = feats.filter((f) => f.geometry && f.geometry.type === "Point");

  // Matched streets: real geometry rendered as lines.
  streetLayer = L.geoJSON(
    { type: "FeatureCollection", features: lineFeatures },
    { style: featureStyle, onEachFeature }
  ).addTo(map);

  // Approximate streets: no real coordinates — all sit at the settlement centre, so
  // we cluster them (one badge per settlement) and spiderfy on click instead of
  // scattering fake points. Falls back to plain markers if the plugin is missing.
  if (approxCluster) approxCluster.remove();
  approxCluster = typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 45,
        iconCreateFunction: approxClusterIcon,
      })
    : L.layerGroup();
  pointFeatures.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lng], { icon: approxDotIcon() });
    registerPointMarker(feature, marker);
    approxCluster.addLayer(marker);
  });
  approxCluster.addTo(map);

  // Selection highlight lives on its own overlay, always above streetLayer, so it
  // never fights the base layer's z-order (no bringToFront needed anywhere).
  if (selectionLayer) selectionLayer.remove();
  selectionLayer = L.layerGroup().addTo(map);

  setStatus(`Завантажено ${feats.length} обʼєктів`);

  map.fitBounds(DONETSK_BOUNDS, { padding: [24, 24], maxZoom: 7 });
  map.setMinZoom(MAP_CONFIG.minZoom);
}

// ── Styling ───────────────────────────────────────────────────────────────────

function parseCount(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  return parseInt(digits, 10) || 1;
}

function isApprox(feature) {
  const props = feature?.properties || {};
  return props.approx === true || props.geometry_kind === "Point" || feature?.geometry?.type === "Point";
}

function featureStyle(feature) {
  const count = parseCount(feature?.properties?.["COUNTA of Тип заяви"]);
  return { ...LINE_BASE_STYLE, color: getLineColor(count) };
}

function getLineColor(count) {
  const colors = [
    "rgba(255, 0, 0, 0.22)",
    "rgba(255, 0, 0, 0.34)",
    "rgba(255, 0, 0, 0.50)",
    "rgba(255, 0, 0, 0.64)",
    "rgba(255, 0, 0, 0.80)",
    "rgba(255, 0, 0, 0.98)",
  ];
  if (maxClaimCount <= 1) return colors[0];
  // sqrt scale: the claim distribution has a long tail, so a linear ramp would
  // leave almost every street pale. sqrt lifts small counts into visible bands.
  const ratio = Math.min(1, Math.max(0, Math.sqrt((count - 1) / (maxClaimCount - 1))));
  return colors[Math.round(ratio * (colors.length - 1))];
}

function approxDotIcon() {
  return L.divIcon({ className: "approx-dot", html: "", iconSize: [12, 12] });
}

function approxClusterIcon(cluster) {
  const n = cluster.getChildCount();
  const size = n < 10 ? 30 : n < 100 ? 38 : 46;
  return L.divIcon({
    html: `<div class="approx-cluster"><span>${n}</span></div>`,
    className: "approx-cluster-wrap",
    iconSize: [size, size],
  });
}

function registerPointMarker(feature, marker) {
  const id = getFeatureId(feature);
  if (id) {
    layersById.set(id, marker);
    featureById.set(id, feature);
  }
  marker.bindPopup(buildPopupHtml(feature), { maxWidth: 360 });
  marker.on("click", () => {
    clearSelection();
    selectedId = id;
  });
}

// ── Feature indexing & interaction ────────────────────────────────────────────

function getFeatureId(feature) {
  const props = feature?.properties || {};
  return props.ID || props.id || "";
}

function geomSignature(geometry) {
  if (!geometry) return "";
  return `${geometry.type}:${JSON.stringify(geometry.coordinates)}`;
}

function onEachFeature(feature, layer) {
  const id = getFeatureId(feature);
  if (id) {
    layersById.set(id, layer);
    featureById.set(id, feature);
    const key = geomSignature(feature.geometry);
    geomKeyById.set(id, key);
    if (!idsByGeomKey.has(key)) idsByGeomKey.set(key, []);
    idsByGeomKey.get(key).push(id);
  }

  layer.bindPopup(buildPopupHtml(feature), { maxWidth: 360 });

  layer.on({
    click(event) {
      L.DomEvent.stop(event);
      handleFeatureClick(id, event.latlng);
    },
    mouseover(event) {
      if (isApprox(feature)) return; // points are already distinct; no hover flicker
      event.target.setStyle(LINE_HOVER_STYLE);
    },
    mouseout(event) {
      if (isApprox(feature)) return;
      if (streetLayer) streetLayer.resetStyle(event.target);
    },
  });
}

function handleFeatureClick(id, latlng) {
  if (!id) return;
  const key = geomKeyById.get(id);
  const ids = idsByGeomKey.get(key) || [id];
  if (ids.length <= 1) {
    selectFeatureById(id, { pan: false });
  } else {
    showStackPicker(ids, latlng);
  }
}

// ── Selection & persistent highlight ──────────────────────────────────────────

function selectFeatureById(id, { pan = false } = {}) {
  const layer = layersById.get(id);
  const feature = featureById.get(id);
  if (!layer || !feature) {
    setStatus("Обʼєкт не знайдено на мапі.");
    return;
  }

  clearSelection();
  selectedId = id;
  const props = feature.properties || {};

  if (feature.geometry?.type === "Point") {
    // Approx street: no real coordinates. Zoom to the settlement and show its info at
    // the settlement centre — never spiderfy/over-zoom to a fake position.
    const latlng = layer.getLatLng();
    if (pan) map.setView(latlng, 14);
    L.popup({ maxWidth: 360 }).setLatLng(latlng).setContent(buildPopupHtml(feature)).openOn(map);
  } else {
    applySelectionHighlight(layer, feature);
    if (pan) {
      const bounds = layer.getBounds?.();
      if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.3), { maxZoom: 17 });
    }
    layer.openPopup();
  }
  setStatus(`Обрано: ${props["Вулиця"] || props["Населений пункт"] || "обʼєкт"}.`);
}

function clearSelection() {
  if (selectionLayer) selectionLayer.clearLayers();
  selectedId = null;
}

function applySelectionHighlight(layer, feature) {
  if (!selectionLayer) return;
  // Ring only for line geometry (interactive:false so it never swallows clicks).
  // Approx points live in clusters; their popup + revealed marker is the feedback,
  // and a ring at the clustered centre would be misplaced when spiderfied.
  const latlngs = feature.geometry?.type !== "Point" ? layer.getLatLngs?.() : null;
  if (latlngs) {
    L.polyline(latlngs, { ...SELECTION_LINE_STYLE, interactive: false }).addTo(selectionLayer);
  }
}

// ── Stack picker (several objects share one geometry) ─────────────────────────

function showStackPicker(ids, latlng) {
  const container = document.createElement("div");
  container.className = "stack-picker";

  const title = document.createElement("div");
  title.className = "stack-picker__title";
  title.textContent = `${ids.length} обʼєктів тут`;
  container.appendChild(title);

  const list = document.createElement("ul");
  list.className = "stack-picker__list";

  ids.forEach((id) => {
    const feature = featureById.get(id);
    const props = feature?.properties || {};
    const item = document.createElement("li");
    item.className = "stack-picker__item";
    item.tabIndex = 0;

    const street = document.createElement("span");
    street.className = "stack-picker__street";
    street.textContent = props["Вулиця"] || "Обʼєкт";
    const place = document.createElement("span");
    place.className = "stack-picker__place";
    place.textContent = [props["Населений пункт"], props["Громада"]].filter(Boolean).join(" · ");

    item.appendChild(street);
    item.appendChild(place);

    const choose = () => {
      map.closePopup();
      selectFeatureById(id, { pan: false });
    };
    item.addEventListener("click", choose);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter") choose();
    });
    list.appendChild(item);
  });

  container.appendChild(list);

  L.popup({ maxWidth: 320, className: "stack-picker-popup", autoPan: true })
    .setLatLng(latlng)
    .setContent(container)
    .openOn(map);
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function buildPopupHtml(feature) {
  const props = feature.properties || {};
  const title = props["Вулиця"] || props.osm_name || "Обʼєкт";
  const community = props["Громада"] || "Донецька обл.";
  const settlement = props["Населений пункт"] || "";
  const subtitle = [community, settlement].filter(Boolean).join(" · ");
  const area = props["Область"] || "Донецька обл.";
  const rayon = props["Район"] || "";
  const claimCount = props["COUNTA of Тип заяви"] || "—";
  const compensation = props["SUM of Сума компенсації, грн"] || "—";

  const approxNote = isApprox(feature)
    ? `<div class="popup-approx">Приблизне розташування</div>`
    : "";

  const rayonRow = rayon
    ? `<div class="popup-row">
        <span class="popup-key">Район</span>
        <span class="popup-value">${escapeHtml(rayon)}</span>
      </div>`
    : "";

  return `
    <div class="popup">
      <div class="popup-header">
        <div class="popup-icon">≡</div>
        <div>
          <div class="popup-title">${escapeHtml(title)}</div>
          <div class="popup-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      ${approxNote}
      <div class="popup-row">
        <span class="popup-key">Область</span>
        <span class="popup-value">${escapeHtml(area)}</span>
      </div>
      ${rayonRow}
      <div class="popup-row">
        <span class="popup-key">Громада</span>
        <span class="popup-value">${escapeHtml(community)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-key">Населений пункт</span>
        <span class="popup-value">${escapeHtml(settlement || "—")}</span>
      </div>
      <div class="popup-row">
        <span class="popup-key">Вулиця</span>
        <span class="popup-value">${escapeHtml(title)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-key">Кількість заяв</span>
        <span class="popup-value">${escapeHtml(String(claimCount))}</span>
      </div>
      <div class="popup-row">
        <span class="popup-key">Наявна сума компенсації в гривні</span>
        <span class="popup-value">${escapeHtml(String(compensation))}</span>
      </div>
    </div>
  `;
}

// ── Search ────────────────────────────────────────────────────────────────────

function attachSearchHandlers() {
  if (!searchInput || !searchButton) return;

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runMapSearch();
    }
  });
  searchButton.addEventListener("click", () => runMapSearch());

  document.addEventListener("click", (event) => {
    const searchContainer = searchInput.closest(".map-search");
    if (searchContainer && !searchContainer.contains(event.target)) {
      closeSearchResults();
    }
  });
}

function normalizeSearchString(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Canonicalize a settlement label so "смт Велика Новосілка", "смт. Велика Новосілка"
// and "сщ. Велика Новосілка" collapse to one display form for grouping.
function normalizeSettlementName(value) {
  return String(value || "")
    .replace(/^(с\.|м\.|смт\.?|сщ\.?|с-ще|селище|село|місто)\s+/i, "")
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*,.*$/, "")
    .trim();
}

function runMapSearch() {
  if (!streetLayer) {
    setStatus("Завантаження мапи ще не завершено, зачекайте.");
    return;
  }
  const query = searchInput?.value.trim();
  if (!query) {
    setStatus("Введіть вулицю або населений пункт для пошуку.");
    closeSearchResults();
    return;
  }

  const normalizedQuery = normalizeSearchString(query);
  const settlementMatches = [];
  const streetMatches = [];

  featureById.forEach((feature, id) => {
    const props = feature.properties || {};
    const street = (props["Вулиця"] || "").toString().trim();
    const settlement = (props["Населений пункт"] || props["Громада"] || "").toString().trim();
    const community = (props["Громада"] || "").toString().trim();
    const streetKey = normalizeSearchString(street);
    const settlementKey = normalizeSearchString(settlement);

    if (settlementKey && settlementKey.includes(normalizedQuery)) {
      const score = settlementKey === normalizedQuery ? 3 : settlementKey.startsWith(normalizedQuery) ? 2 : 1;
      settlementMatches.push({ id, street, settlement, community, score });
    }
    if (streetKey && streetKey.includes(normalizedQuery)) {
      const score = streetKey === normalizedQuery ? 3 : streetKey.startsWith(normalizedQuery) ? 2 : 1;
      streetMatches.push({ id, street, settlement, community, score });
    }
  });

  const matches = settlementMatches.length > 0 ? settlementMatches : streetMatches;
  if (!matches.length) {
    setStatus(`Нічого не знайдено для "${query}".`);
    closeSearchResults();
    return;
  }

  matches.sort((a, b) => b.score - a.score);
  if (matches.length === 1) {
    selectSearchResult(matches[0]);
    return;
  }

  renderSearchResults(matches.slice(0, 60));
  setStatus(`Знайдено ${matches.length} обʼєктів.`);
}

function renderSearchResults(results) {
  if (!searchResultsEl) return;
  closeSearchResults();

  // Disambiguate identical street+settlement rows with a short ID suffix.
  const labelCounts = new Map();
  results.forEach((item) => {
    const label = `${item.street}|${normalizeSettlementName(item.settlement)}|${item.community}`;
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  });

  const list = document.createElement("ul");
  list.className = "map-search-results__list";

  results.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = "map-search-results__item";
    listItem.tabIndex = 0;

    const streetLine = document.createElement("span");
    streetLine.className = "map-search-results__street";
    const label = `${item.street}|${normalizeSettlementName(item.settlement)}|${item.community}`;
    const suffix = labelCounts.get(label) > 1 ? ` #${String(item.id).slice(0, 4)}` : "";
    streetLine.textContent = (item.street || "Обʼєкт") + suffix;

    const placeLine = document.createElement("small");
    placeLine.className = "map-search-results__place";
    placeLine.textContent = [item.settlement, item.community].filter(Boolean).join(" · ");

    listItem.appendChild(streetLine);
    listItem.appendChild(placeLine);

    const choose = () => {
      selectSearchResult(item);
      closeSearchResults();
    };
    listItem.addEventListener("click", choose);
    listItem.addEventListener("keydown", (event) => {
      if (event.key === "Enter") choose();
    });
    list.appendChild(listItem);
  });

  searchResultsEl.appendChild(list);
  searchResultsEl.hidden = false;
}

function closeSearchResults() {
  if (!searchResultsEl) return;
  searchResultsEl.innerHTML = "";
  searchResultsEl.hidden = true;
}

function selectSearchResult(match) {
  closeSearchResults();
  selectFeatureById(match.id, { pan: true });
}

// ── Status & helpers ──────────────────────────────────────────────────────────

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
  statusEl.classList.add("status--visible");
  if (!isError) {
    window.setTimeout(() => statusEl.classList.remove("status--visible"), 3200);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
