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
const addressCounts = new Map();

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
    const response = await fetch(MAP_CONFIG.geoJsonPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load GeoJSON: ${response.status}`);
    }

    const geoJson = await response.json();
    computeAddressCounts(geoJson.features || []);

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

function computeAddressCounts(features) {
  for (const feature of features) {
    const addressKey = getAddressKey(feature.properties || {});
    addressCounts.set(addressKey, (addressCounts.get(addressKey) || 0) + 1);
  }
}

function getAddressKey(props = {}) {
  const parts = ["Область", "Громада", "Населений пункт", "Вулиця"];
  const addressParts = parts.map((key) => props[key]).filter(Boolean);
  if (addressParts.length) {
    return addressParts.join(" | ");
  }
  if (props.osm_street) return props.osm_street;
  if (props.osm_name) return props.osm_name;
  return "Unknown address";
}

function featureStyle(feature) {
  const props = feature.properties || {};
  const count = addressCounts.get(getAddressKey(props)) || 1;

  return {
    color: getLineColor(count),
    weight: 2.2,
    opacity: 0.85,
  };
}

function getLineColor(count) {
  const colors = ["#ffb3b3", "#ff8080", "#ff4d4d", "#ff1a1a", "#e60000", "#990000"];
  return colors[Math.min(count, colors.length) - 1] || colors[colors.length - 1];
}

function onEachFeature(feature, layer) {
  layer.bindPopup(buildPopupHtml(feature), { maxWidth: 360 });

  layer.on({
    mouseover(event) {
      event.target.setStyle(FEATURE_HOVER_STYLE);
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
  const addressKey = getAddressKey(props);
  const count = addressCounts.get(addressKey) || 1;
  const title = props["Вулиця"] || props.osm_name || props.osm_street || `Object ${props.ID || ""}`;

  const details = Object.entries(props)
    .filter(([key, value]) => key !== "ID" && value != null && value !== "")
    .map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</p>`)
    .join("");

  const repeatHtml = count > 1 ? `<p><strong>Повторів за адресою:</strong> ${count}</p>` : "";

  return `
    <div class="popup">
      <h3>${escapeHtml(title)}</h3>
      ${repeatHtml}
      ${details}
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
