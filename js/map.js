import { MAP_CONFIG, FEATURE_HOVER_STYLE } from "./config.js";

const map = L.map("map", {
  zoomControl: true,
  minZoom: MAP_CONFIG.minZoom,
  maxZoom: MAP_CONFIG.maxZoom,
  maxBoundsViscosity: 1,
  worldCopyJump: false,
});

const statusEl = document.getElementById("status");
let geoJsonLayer;
const idCounts = new Map();
const csvDataById = new Map();
let maxCsvCount = 1;

L.tileLayer(MAP_CONFIG.tileUrl, {
  attribution: MAP_CONFIG.tileAttribution,
  subdomains: "abcd",
  maxZoom: MAP_CONFIG.maxZoom,
}).addTo(map);

L.control.scale({ imperial: false }).addTo(map);
map.setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);

loadGeoJson();

async function loadGeoJson() {
  setStatus("Loading map objects...");

  try {
    await loadCsvData();

    const response = await fetch(MAP_CONFIG.geoJsonPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load GeoJSON: ${response.status}`);
    }

    const geoJson = await response.json();

    geoJsonLayer = L.geoJSON(geoJson, {
      style: featureStyle,
      onEachFeature,
    }).addTo(map);

    const bounds = geoJsonLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });

      const paddedBounds = bounds.pad(MAP_CONFIG.maxBoundsPad);
      map.setMaxBounds(paddedBounds);

      const fitZoom = map.getBoundsZoom(bounds, false, [20, 20]);
      map.setMinZoom(Math.max(MAP_CONFIG.minZoom, fitZoom));
    }

    const featureCount = Array.isArray(geoJson.features) ? geoJson.features.length : 0;
    setStatus(`Loaded ${featureCount} objects`);
  } catch (error) {
    console.error(error);
    setStatus(`GeoJSON loading error. Check ${MAP_CONFIG.geoJsonPath}`, true);
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

    for (const row of rows.slice(1)) {
      const id = row[idIndex]?.trim();
      if (!id) continue;

      const countValue = row[countIndex] ? row[countIndex].trim().replace(/\s+/g, "") : "";
      const count = parseInt(countValue.replace(/[^0-9]/g, ""), 10) || 1;
      idCounts.set(id, count);
      maxCsvCount = Math.max(maxCsvCount, count);

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
  const id = props.ID || props.id || "";
  const count = idCounts.get(id) || 1;
  const fillColor = getFillColor(count);
  const borderColor = "#b30000";

  return {
    color: borderColor,
    fillColor,
    weight: 2.8,
    opacity: 0.9,
    fillOpacity: 0.45,
  };
}

function getFillColor(count) {
  const colors = [
    "#fff0f0",
    "#ffd6d6",
    "#ffb3b3",
    "#ff8c8c",
    "#ff6666",
    "#ff3b3b",
    "#e60000",
  ];
  if (maxCsvCount <= 1) {
    return colors[0];
  }

  const ratio = Math.min(1, Math.max(0, (count - 1) / (maxCsvCount - 1)));
  const index = Math.round(ratio * (colors.length - 1));
  return colors[index];
}

function getBorderColor(count) {
  return "#b30000";
}

function onEachFeature(feature, layer) {
  layer.bindPopup(buildPopupHtml(feature), { maxWidth: 360 });

  layer.on({
    mouseover(event) {
      event.target.setStyle({
        ...FEATURE_HOVER_STYLE,
        color: "#550000",
        fillColor: "#ff6666",
        fillOpacity: 0.75,
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
        <span class="popup-key">Кількість заяв</span>
        <span class="popup-value">${escapeHtml(String(claimCount))}</span>
      </div>
      <div class="popup-row">
        <span class="popup-key">Наявна сума компенсації в грн</span>
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
