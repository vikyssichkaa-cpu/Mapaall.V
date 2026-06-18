import { MAP_CONFIG, FEATURE_STYLE, FEATURE_HOVER_STYLE } from "./config.js";

const map = L.map("map", {
  zoomControl: true,
  minZoom: MAP_CONFIG.minZoom,
  maxZoom: MAP_CONFIG.maxZoom,
  maxBoundsViscosity: 1,
  worldCopyJump: false,
});

const statusEl = document.getElementById("status");
let geoJsonLayer;

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
    geoJsonLayer = L.geoJSON(geoJson, {
      style: FEATURE_STYLE,
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

  const title = escapeHtml(props.attr_Title || `Object ${props.ID || ""}`.trim() || "Object");
  const description = props.attr_Text ? `<p class="popup__text">${escapeHtml(props.attr_Text)}</p>` : "";

  const addressParts = [props["attr_Тип ВДМ"], props["attr_Вулиця"], props["attr_Номер будинку"]].filter(Boolean);
  const addressHtml = addressParts.length
    ? `<p><strong>Address:</strong> ${escapeHtml(addressParts.join(" "))}</p>`
    : "";

  const typeHtml = props["attr_Вид"] ? `<p><strong>Type:</strong> ${escapeHtml(props["attr_Вид"])}</p>` : "";

  const sourceUrl = safeUrl(props.attr_Source);
  const sourceHtml = sourceUrl ? `<p><a href="${sourceUrl}" target="_blank" rel="noopener">Source</a></p>` : "";

  return `
    <div class="popup">
      <h3>${title}</h3>
      ${typeHtml}
      ${addressHtml}
      ${description}
      ${sourceHtml}
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
