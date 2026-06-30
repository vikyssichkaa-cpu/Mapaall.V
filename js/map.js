import { MAP_CONFIG } from "./config.js";

const map = L.map("map", {
  zoomControl: true,
  minZoom: MAP_CONFIG.minZoom,
  maxZoom: MAP_CONFIG.maxZoom,
  maxBoundsViscosity: 1,
  worldCopyJump: false,
});

const statusEl = document.getElementById("status");
const searchInput = document.getElementById("map-search-input");
const searchButton = document.getElementById("map-search-button");
const searchResultsEl = document.getElementById("map-search-results");
let streetLayer;
let boundaryLayer;
let currentGeoJson = null;
let currentBoundaryGeoJson = null;
const MIN_STREET_GEOMETRY_LENGTH = 0.001;
const STREET_VISIBILITY_MIN_ZOOM = 10;
const idCounts = new Map();
const csvDataById = new Map();
const streetCounts = new Map();
let maxStreetCount = 1;

L.tileLayer(MAP_CONFIG.tileUrl, {
  attribution: MAP_CONFIG.tileAttribution,
  subdomains: "abcd",
  maxZoom: MAP_CONFIG.maxZoom,
}).addTo(map);

L.control.scale({ imperial: false }).addTo(map);

const DONETSK_BOUNDS = L.latLngBounds(
  [46.88, 36.55],
  [49.05, 38.87]
);
map.setMaxBounds(DONETSK_BOUNDS);

map.setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);
map.on("zoomend", updateStreetLayerVisibility);

attachSearchHandlers();
loadGeoJson();

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
    return {
      ...geometry,
      geometries: geometry.geometries.map(normalizeGeometry),
    };
  }

  return {
    ...geometry,
    coordinates: normalizeCoordinates(geometry.coordinates),
  };
}

function normalizeGeoJson(geoJson) {
  if (!geoJson || !Array.isArray(geoJson.features)) {
    return geoJson;
  }

  return {
    ...geoJson,
    features: geoJson.features.map((feature) => {
      if (!feature || !feature.geometry) return feature;
      return {
        ...feature,
        geometry: normalizeGeometry(feature.geometry),
      };
    }),
  };
}

function getLineLength(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (!Array.isArray(previous) || !Array.isArray(current)) {
      continue;
    }

    const deltaX = Number(current[0]) - Number(previous[0]);
    const deltaY = Number(current[1]) - Number(previous[1]);
    total += Math.hypot(deltaX, deltaY);
  }

  return total;
}

function getGeometryLength(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return 0;
  }

  if (geometry.type === "LineString") {
    return getLineLength(geometry.coordinates);
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((sum, line) => sum + getLineLength(line), 0);
  }

  return Infinity;
}

function getLineReferencePoints(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return [];
  }

  const first = coordinates[0];
  const middle = coordinates[Math.floor(coordinates.length / 2)];
  const last = coordinates[coordinates.length - 1];

  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  coordinates.forEach((coordinate) => {
    if (!Array.isArray(coordinate)) {
      return;
    }

    minLng = Math.min(minLng, Number(coordinate[0]));
    minLat = Math.min(minLat, Number(coordinate[1]));
    maxLng = Math.max(maxLng, Number(coordinate[0]));
    maxLat = Math.max(maxLat, Number(coordinate[1]));
  });

  const center = Number.isFinite(minLng) && Number.isFinite(minLat) && Number.isFinite(maxLng) && Number.isFinite(maxLat)
    ? [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
    : null;

  return [first, middle, last, center].filter(
    (coordinate) => Array.isArray(coordinate) && coordinate.length >= 2
  );
}

function getGeometryReferencePoints(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return [];
  }

  if (geometry.type === "LineString") {
    return getLineReferencePoints(geometry.coordinates);
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap(getLineReferencePoints);
  }

  return [];
}

function pointInRing(point, ring) {
  if (!Array.isArray(point) || !Array.isArray(ring) || ring.length < 3) {
    return false;
  }

  const x = Number(point[0]);
  const y = Number(point[1]);
  let inside = false;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    if (!Array.isArray(current) || !Array.isArray(previous)) {
      continue;
    }

    const currentX = Number(current[0]);
    const currentY = Number(current[1]);
    const previousX = Number(previous[0]);
    const previousY = Number(previous[1]);
    const crossesLatitude = (currentY > y) !== (previousY > y);

    if (!crossesLatitude) {
      continue;
    }

    const edgeSlope = (previousX - currentX) * (y - currentY);
    const edgeHeight = (previousY - currentY) || 1e-12;
    const intersectionX = edgeSlope / edgeHeight + currentX;
    if (x < intersectionX) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return false;
  }

  if (!pointInRing(point, polygon[0])) {
    return false;
  }

  return !polygon.slice(1).some((ring) => pointInRing(point, ring));
}

function buildBoundaryPolygonIndex(boundaryGeoJson) {
  const polygons = boundaryGeoJson?.features?.flatMap((feature) => {
    const geometry = feature?.geometry;
    if (!geometry) {
      return [];
    }

    if (geometry.type === "Polygon") {
      return [geometry.coordinates];
    }

    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates;
    }

    return [];
  }) || [];

  return polygons.map((polygon) => {
    let minLng = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    polygon.forEach((ring) => {
      ring.forEach((coordinate) => {
        minLng = Math.min(minLng, Number(coordinate[0]));
        minLat = Math.min(minLat, Number(coordinate[1]));
        maxLng = Math.max(maxLng, Number(coordinate[0]));
        maxLat = Math.max(maxLat, Number(coordinate[1]));
      });
    });

    return {
      polygon,
      bbox: [minLng, minLat, maxLng, maxLat],
    };
  });
}

function pointInBoundary(point, boundaryIndex) {
  return boundaryIndex.some(({ polygon, bbox }) => {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
      return false;
    }

    return pointInPolygon(point, polygon);
  });
}

function filterStreetGeoJson(geoJson, boundaryGeoJson) {
  if (!geoJson || !Array.isArray(geoJson.features)) {
    return geoJson;
  }

  const boundaryIndex = buildBoundaryPolygonIndex(boundaryGeoJson);

  return {
    ...geoJson,
    features: geoJson.features.filter((feature) => {
      if (getGeometryLength(feature?.geometry) < MIN_STREET_GEOMETRY_LENGTH) {
        return false;
      }

      if (!boundaryIndex.length) {
        return true;
      }

      const referencePoints = getGeometryReferencePoints(feature?.geometry);
      return referencePoints.some((point) => pointInBoundary(point, boundaryIndex));
    }),
  };
}

async function loadGeoJson() {
  setStatus("Loading map objects...");

  try {
    await loadCsvData();

    const [streetResponse, boundaryResponse] = await Promise.all([
      fetch(MAP_CONFIG.streetGeoJsonPath, { cache: "no-store" }),
      fetch(MAP_CONFIG.boundaryGeoJsonPath, { cache: "no-store" }),
    ]);

    if (!streetResponse.ok) {
      throw new Error(`Failed to load street GeoJSON: ${streetResponse.status}`);
    }

    if (!boundaryResponse.ok) {
      throw new Error(`Failed to load boundary GeoJSON: ${boundaryResponse.status}`);
    }

    const [geoJson, boundaryGeoJson] = await Promise.all([
      streetResponse.json(),
      boundaryResponse.json(),
    ]);

    currentBoundaryGeoJson = normalizeGeoJson(boundaryGeoJson);
    currentGeoJson = filterStreetGeoJson(normalizeGeoJson(geoJson), currentBoundaryGeoJson);
    renderGeoJsonLayer();

    const featureCount = Array.isArray(currentGeoJson?.features) ? currentGeoJson.features.length : 0;
    setStatus(`Loaded ${featureCount} objects`);
  } catch (error) {
    console.error(error);
    setStatus("GeoJSON loading error. Check configured data paths", true);
  }
}

function renderGeoJsonLayer() {
  if (!currentGeoJson) {
    return;
  }

  if (streetLayer) {
    streetLayer.remove();
  }

  streetLayer = L.geoJSON(currentGeoJson, {
    style: featureStyle,
    onEachFeature,
  }).addTo(map);

  if (boundaryLayer) {
    boundaryLayer.remove();
  }

  if (currentBoundaryGeoJson) {
    boundaryLayer = L.geoJSON(currentBoundaryGeoJson, {
      style: boundaryStyle,
      interactive: false,
    }).addTo(map);
    boundaryLayer.bringToBack();
  }

  const totalFeatures = Array.isArray(currentGeoJson.features) ? currentGeoJson.features.length : 0;
  updateStreetLayerVisibility();
  setStatus(`Loaded ${totalFeatures} objects`);

  map.fitBounds(DONETSK_BOUNDS, {
    maxZoom: MAP_CONFIG.maxZoom,
  });
  map.setMinZoom(MAP_CONFIG.minZoom);
}

async function loadCsvData() {
  try {
    const response = await fetch(encodeURI(MAP_CONFIG.csvPath), { cache: "no-store" });
    if (!response.ok) {
      console.warn(`Failed to load CSV: ${response.status}`);
      return;
    }

    const text = await response.text();
    const rows = parseCsv(text);
    if (!rows.length) return;

    const headers = rows[0].map((header) => header.replace(/\uFEFF/g, "").trim());
    const idIndex = headers.findIndex((header) => header === "ID");
    const countIndex = headers.findIndex((header) => /COUNTA of Тип заяви/i.test(header) || /COUNT/i.test(header) || /Тип заяви/i.test(header));
    const streetIndex = headers.findIndex((header) => /Вулиця/i.test(header));

    for (const row of rows.slice(1)) {
      const id = row[idIndex]?.trim();
      if (!id) continue;

      const countValue = row[countIndex] ? row[countIndex].trim().replace(/\s+/g, "") : "";
      const count = parseInt(countValue.replace(/[^0-9]/g, ""), 10) || 1;
      idCounts.set(id, count);

      const street = row[streetIndex]?.trim() || "Unknown";
      const currentStreetCount = streetCounts.get(street) || 0;
      streetCounts.set(street, currentStreetCount + count);
      maxStreetCount = Math.max(maxStreetCount, currentStreetCount + count);

      const record = {};
      headers.forEach((header, index) => {
        if (index === idIndex) return;
        const value = row[index]?.trim();
        if (value) {
          record[header] = value;
        }
      });
      csvDataById.set(id, record);
    }
  } catch (error) {
    console.warn("CSV parsing error", error);
  }
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      current.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i++;
      }
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  return rows.filter((row) => row.length > 1 || (row.length === 1 && row[0] !== ""));
}

function featureStyle(feature) {
  const props = feature.properties || {};
  const street = props["Вулиця"] || props.osm_street || "Unknown";
  const streetCount = streetCounts.get(street) || 1;

  return {
    color: getLineColor(streetCount),
    weight: 2.8,
    opacity: 0.98,
    lineCap: "butt",
    lineJoin: "miter",
  };
}

function boundaryStyle() {
  return {
    color: "#2f6fab",
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0,
    dashArray: "6 4",
    lineCap: "butt",
    lineJoin: "miter",
  };
}

function updateStreetLayerVisibility() {
  if (!streetLayer) {
    return;
  }

  const shouldShowStreetLayer = map.getZoom() >= STREET_VISIBILITY_MIN_ZOOM;
  if (shouldShowStreetLayer) {
    if (!map.hasLayer(streetLayer)) {
      streetLayer.addTo(map);
    }
    return;
  }

  if (map.hasLayer(streetLayer)) {
    streetLayer.remove();
  }
}

function getLineColor(count) {
  const colors = [
    "rgba(255, 0, 0, 0.20)",
    "rgba(255, 0, 0, 0.32)",
    "rgba(255, 0, 0, 0.48)",
    "rgba(255, 0, 0, 0.62)",
    "rgba(255, 0, 0, 0.78)",
    "rgba(255, 0, 0, 0.98)",
  ];
  if (maxStreetCount <= 1) {
    return colors[0];
  }

  const ratio = Math.min(1, Math.max(0, (count - 1) / (maxStreetCount - 1)));
  const index = Math.round(ratio * (colors.length - 1));
  return colors[index];
}

function getFeatureId(feature) {
  const props = feature?.properties || {};
  return props.ID || props.id || props["ID"] || "";
}

function onEachFeature(feature, layer) {
  layer.bindPopup(buildPopupHtml(feature), { maxWidth: 360 });

  layer.on({
    mouseover(event) {
      const props = event.target.feature.properties || {};
      const street = props["Вулиця"] || props.osm_street || "Unknown";
      const streetCount = streetCounts.get(street) || 1;
      
      event.target.setStyle({
        color: "rgba(255, 0, 0, 1)",
        weight: 3.5,
        opacity: 1,
      });
      event.target.bringToFront();
    },
    mouseout(event) {
      if (streetLayer) {
        streetLayer.resetStyle(event.target);
      }
    },
  });
}

function buildPopupHtml(feature) {
  const props = feature.properties || {};
  const id = getFeatureId(feature);
  const csvProps = csvDataById.get(id) || {};
  const title = props["Вулиця"] || props.osm_name || props.osm_street || "Об'єкт";
  const subtitleBase = props["Населений пункт"] || props["Громада"] || "Донецька обл.";
  const subtitle = id ? `${subtitleBase} · ID ${id}` : subtitleBase;

  const area = props["Область"] || csvProps["Область"] || "Донецька обл.";
  const claimCount = csvProps["COUNTA of Тип заяви"] || csvProps["Тип заяви"] || "1";
  const compensation = csvProps["SUM of Сума компенсації, грн"] || csvProps["Сума компенсації, грн"] || "0,00";

  return `
    <div class="popup">
      <div class="popup-header">
        <div class="popup-icon">≡</div>
        <div>
          <div class="popup-title">${escapeHtml(title)}</div>
          <div class="popup-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="popup-row">
        <span class="popup-key">Область</span>
        <span class="popup-value">${escapeHtml(area)}</span>
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

function safeUrl(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }

  try {
    const url = new URL(rawValue.trim());
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function attachSearchHandlers() {
  if (!searchInput || !searchButton) return;

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runMapSearch();
    }
  });

  searchButton.addEventListener("click", () => {
    runMapSearch();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const searchContainer = searchInput.closest(".map-search");
    if (searchContainer && !searchContainer.contains(target)) {
      closeSearchResults();
    }
  });
}

function runMapSearch() {
  if (!streetLayer) {
    setStatus("Завантаження карти ще не завершено, зачекайте.");
    return;
  }

  const query = searchInput?.value.trim();
  if (!query) {
    setStatus("Введіть вулицю або населений пункт для пошуку.");
    closeSearchResults();
    return;
  }

  const normalizedQuery = query.toLowerCase();
  const settlementMatches = [];
  const streetMatches = [];

  streetLayer.eachLayer((layer) => {
    const props = layer.feature?.properties || {};
    const street = (props["Вулиця"] || props.osm_street || "").toString().trim();
    const settlement = (props["Населений пункт"] || props["Громада"] || props.osm_city || "").toString().trim();
    const streetKey = street.toLowerCase();
    const settlementKey = settlement.toLowerCase();

    const settlementMatch = settlementKey && settlementKey.includes(normalizedQuery);
    const streetMatch = streetKey && streetKey.includes(normalizedQuery);

    if (settlementMatch) {
      const score = settlementKey === normalizedQuery ? 3 : settlementKey.startsWith(normalizedQuery) ? 2 : 1;
      settlementMatches.push({ layer, street, settlement, score });
    }

    if (streetMatch) {
      const score = streetKey === normalizedQuery ? 3 : streetKey.startsWith(normalizedQuery) ? 2 : 1;
      streetMatches.push({ layer, street, settlement, score });
    }
  });

  const useSettlementMatches = settlementMatches.length > 0;
  const matches = useSettlementMatches ? settlementMatches : streetMatches;

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

  const resultItems = matches.map((match) => ({
    layer: match.layer,
    street: match.street,
    settlement: match.settlement,
  }));
  renderSearchResults(resultItems);
  setStatus(`Знайдено ${matches.length} об'єктів.`);
}

function renderSearchResults(results) {
  if (!searchResultsEl) return;

  closeSearchResults();

  const list = document.createElement("ul");
  list.className = "map-search-results__list";

  results.forEach((item, index) => {
    const displayText = item.street && item.settlement
      ? `${item.street} — ${item.settlement}`
      : item.street || item.settlement || "Об'єкт";

    const listItem = document.createElement("li");
    listItem.className = "map-search-results__item";
    listItem.tabIndex = 0;
    listItem.textContent = displayText;
    listItem.addEventListener("click", () => {
      selectSearchResult(item);
      closeSearchResults();
    });
    listItem.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        selectSearchResult(item);
        closeSearchResults();
      }
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
  const bounds = match.layer.getBounds?.() || match.layer.getLatLng?.();

  if (bounds) {
    if (typeof bounds.getCenter === "function" && typeof bounds.pad === "function") {
      map.fitBounds(bounds.pad(0.2), { maxZoom: 17 });
    } else if (typeof bounds.lat === "number" && typeof bounds.lng === "number") {
      map.setView(bounds, 17);
    }
  }

  match.layer.openPopup();
  setStatus(`Перейшли до ${match.street || match.settlement || "об'єкта"}.`);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
  statusEl.classList.add("status--visible");

  if (!isError) {
    window.setTimeout(() => {
      statusEl.classList.remove("status--visible");
    }, 3200);
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
