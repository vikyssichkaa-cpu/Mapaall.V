import { MAP_CONFIG, FEATURE_HOVER_STYLE } from "./config.js";

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
const occupiedToggle = document.getElementById("filter-occupied-toggle");
const searchResultsEl = document.getElementById("map-search-results");
let geoJsonLayer;
let currentGeoJson = null;
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

const donetskBounds = L.latLngBounds(
  [46.88, 36.55],
  [49.05, 38.87]
);
map.setMaxBounds(donetskBounds.pad(0.07));

map.setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);

attachSearchHandlers();
loadGeoJson();

if (occupiedToggle) {
  occupiedToggle.addEventListener("change", () => {
    renderGeoJsonLayer();
    setStatus(
      occupiedToggle.checked
        ? "Показано всі території, включно з окупованими."
        : "Окуповані території приховано."
    );
  });
}

const OCCUPIED_AREA_BBOXES = [
  { name: "Горлівка", lon: [37.95, 38.15], lat: [48.25, 48.40] },
  { name: "Донецьк", lon: [37.70, 37.95], lat: [47.90, 48.10] },
  { name: "Макіївка", lon: [37.40, 37.75], lat: [48.00, 48.20] },
];

const VALID_MAP_BOUNDS = {
  lon: [36.55, 38.87],
  lat: [46.88, 49.05],
};

const OCCUPIED_STYLE = {
  color: "rgba(107, 114, 128, 0.7)",
  weight: 3,
  opacity: 0.78,
  dashArray: "6, 5",
};

const OUT_OF_BOUNDS_STYLE = {
  color: "rgba(220, 38, 38, 0.95)",
  weight: 3,
  opacity: 1,
  dashArray: "8, 6",
};

function isOccupiedPoint([lng, lat]) {
  return OCCUPIED_AREA_BBOXES.some((bbox) => {
    return lng >= bbox.lon[0] && lng <= bbox.lon[1] && lat >= bbox.lat[0] && lat <= bbox.lat[1];
  });
}

function isPointInValidBounds([lng, lat]) {
  return (
    lng >= VALID_MAP_BOUNDS.lon[0] &&
    lng <= VALID_MAP_BOUNDS.lon[1] &&
    lat >= VALID_MAP_BOUNDS.lat[0] &&
    lat <= VALID_MAP_BOUNDS.lat[1]
  );
}

function extractCoordinates(geometry) {
  const coords = [];

  function walk(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return;
    }
    if (typeof points[0] === "number") {
      coords.push(points);
      return;
    }
    points.forEach(walk);
  }

  walk(geometry.coordinates || []);
  return coords;
}

function getFeatureStatus(feature) {
  if (!feature || !feature.geometry) {
    return "unknown";
  }

  const coords = extractCoordinates(feature.geometry);
  const hasInvalid = coords.some((coord) => !isPointInValidBounds(coord));
  if (hasInvalid) {
    return "invalid";
  }

  const hasOccupied = coords.some(isOccupiedPoint);
  if (hasOccupied) {
    return "occupied";
  }

  return "normal";
}

function isOccupiedFeature(feature) {
  return getFeatureStatus(feature) === "occupied";
}

function isFeatureHiddenByToggle(feature) {
  return occupiedToggle && !occupiedToggle.checked && isOccupiedFeature(feature);
}

async function loadGeoJson() {
  setStatus("Loading map objects...");

  try {
    await loadCsvData();

    const response = await fetch(MAP_CONFIG.geoJsonPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load GeoJSON: ${response.status}`);
    }

    const geoJson = await response.json();
    currentGeoJson = geoJson;
    renderGeoJsonLayer();

    const featureCount = Array.isArray(currentGeoJson?.features) ? currentGeoJson.features.length : 0;
    setStatus(`Loaded ${featureCount} objects`);
  } catch (error) {
    console.error(error);
    setStatus(`GeoJSON loading error. Check ${MAP_CONFIG.geoJsonPath}`, true);
  }
}

function renderGeoJsonLayer() {
  if (!currentGeoJson) {
    return;
  }

  if (geoJsonLayer) {
    geoJsonLayer.remove();
  }

  geoJsonLayer = L.geoJSON(currentGeoJson, {
    style: featureStyle,
    onEachFeature,
    filter: (feature) => !isFeatureHiddenByToggle(feature),
  }).addTo(map);

  const totalFeatures = Array.isArray(currentGeoJson.features) ? currentGeoJson.features.length : 0;
  const invalidCount = currentGeoJson.features.filter((feature) => getFeatureStatus(feature) === "invalid").length;
  const occupiedCount = currentGeoJson.features.filter((feature) => getFeatureStatus(feature) === "occupied").length;
  const hiddenText = occupiedToggle && !occupiedToggle.checked ? ` (${occupiedCount} окупованих приховано)` : "";
  setStatus(`Loaded ${totalFeatures} objects${hiddenText}`);

  const bounds = geoJsonLayer.getBounds();
  if (bounds.isValid()) {
    const paddedBounds = bounds.pad(MAP_CONFIG.maxBoundsPad);
    map.fitBounds(paddedBounds, {
      maxZoom: MAP_CONFIG.maxZoom,
    });
    map.setMinZoom(MAP_CONFIG.minZoom);
  }
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
  const status = getFeatureStatus(feature);

  if (status === "invalid") {
    return OUT_OF_BOUNDS_STYLE;
  }
  if (status === "occupied") {
    return OCCUPIED_STYLE;
  }

  return {
    color: getLineColor(streetCount),
    weight: 2.8,
    opacity: 0.98,
  };
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
      if (geoJsonLayer) {
        geoJsonLayer.resetStyle(event.target);
      }
    },
  });
}

function buildPopupHtml(feature) {
  const props = feature.properties || {};
  const status = getFeatureStatus(feature);
  const id = props.ID || props.id || "";
  const csvProps = csvDataById.get(id) || {};
  const title = props["Вулиця"] || props.osm_name || props.osm_street || "Об'єкт";
  const subtitle = props["Населений пункт"] || props["Громада"] || "Донецька обл.";

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
        <span class="popup-key">Статус території</span>
        <span class="popup-value">${escapeHtml(
          status === "occupied"
            ? "Окупована територія"
            : status === "invalid"
            ? "Поза межами Донецької області"
            : "Контрольована Україною"
        )}</span>
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
  if (!geoJsonLayer) {
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

  geoJsonLayer.eachLayer((layer) => {
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
