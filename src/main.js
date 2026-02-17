import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './style.css';

const token = import.meta.env.VITE_MAPBOX_TOKEN;
if (!token) {
  throw new Error('Missing VITE_MAPBOX_TOKEN. Add it to .env.local before running the app.');
}
mapboxgl.accessToken = token;

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="app-shell">
    <div id="map" class="map-canvas"></div>
    <div class="dot-grid" aria-hidden="true"></div>

    <header class="topbar">
      <div class="title-wrap">
        <p class="kicker">Inner City Cape Town</p>
        <h1>Heritage Atlas</h1>
      </div>

      <div class="actions">
        <div class="view-switch" id="viewSwitch">
          <button class="view-btn active" data-view="map">Map</button>
          <button class="view-btn" data-view="trends">Trends</button>
        </div>
        <input id="searchInput" type="search" placeholder="Search buildings, streets, heritage notes" />
        <button id="styleToggle" class="pill-btn">Satellite</button>
      </div>
    </header>

    <aside class="dock">
      <div class="filter-row">
        <label>
          <span>Usage</span>
          <select id="usageFilter"></select>
        </label>
        <label>
          <span>Zoning</span>
          <select id="zoningFilter"></select>
        </label>
      </div>

      <div class="stats" id="stats"></div>

      <div class="list-block">
        <p class="list-title">Listed Sites</p>
        <ul id="siteList" class="site-list"></ul>
      </div>
    </aside>

    <main id="trendsView" class="trends-view hidden">
      <section class="trend-cards" id="trendCards"></section>
      <section class="trend-panel">
        <header>
          <h3>Size vs Value</h3>
          <p>ERF size compared with municipal value.</p>
        </header>
        <div id="sizeValueChart" class="chart-wrap"></div>
      </section>
      <section class="trend-panel">
        <header>
          <h3>Pricing Leaderboard</h3>
          <p>Highest value per m2 in current filter.</p>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Size (m2)</th>
                <th>Value</th>
                <th>Value/m2</th>
              </tr>
            </thead>
            <tbody id="pricingTableBody"></tbody>
          </table>
        </div>
      </section>
    </main>

    <article id="detailCard" class="detail-card hidden"></article>
  </div>
`;

const searchInput = document.querySelector('#searchInput');
const usageFilter = document.querySelector('#usageFilter');
const zoningFilter = document.querySelector('#zoningFilter');
const siteList = document.querySelector('#siteList');
const stats = document.querySelector('#stats');
const detailCard = document.querySelector('#detailCard');
const styleToggle = document.querySelector('#styleToggle');
const trendsView = document.querySelector('#trendsView');
const viewSwitch = document.querySelector('#viewSwitch');
const trendCards = document.querySelector('#trendCards');
const sizeValueChart = document.querySelector('#sizeValueChart');
const pricingTableBody = document.querySelector('#pricingTableBody');

const state = {
  data: null,
  filteredFeatures: [],
  selectedId: null,
  search: '',
  usage: 'all',
  zoning: 'all',
  styleKey: 'dark',
  view: 'map',
};

const styles = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};

const METRIC_OVERRIDES = new Map([
  [
    'tobacco mini market|93 loop street',
    { size: 453, value: 16000000 },
  ],
  [
    '121 long salon|121 long st',
    { size: 64, value: 7500000 },
  ],
  [
    'langham house|59 long st',
    { size: 190, value: 12850000 },
  ],
]);

const map = new mapboxgl.Map({
  container: 'map',
  style: styles.dark,
  center: [18.4233, -33.9189],
  zoom: 14,
  pitch: 52,
  bearing: -12,
  attributionControl: false,
  antialias: true,
});

map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

async function loadData() {
  const response = await fetch('/data/heritage.geojson');
  if (!response.ok) throw new Error('Could not load heritage.geojson');
  state.data = await response.json();
}

function getUniqueValues(key) {
  const values = new Set();
  for (const feature of state.data.features) {
    const value = String(feature.properties[key] || '').trim();
    if (value) values.add(value);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function fillFilter(selectEl, values) {
  selectEl.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'All';
  selectEl.appendChild(all);

  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  }
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function parseNumber(value) {
  if (value == null) return null;
  let clean = String(value).trim();
  clean = clean.replace(/\s+/g, '');
  clean = clean.replace(/,/g, '');
  clean = clean.replace(/[^\d.-]/g, '');
  if (!clean) return null;
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSizeNumber(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (text.includes('+')) {
    const parts = text
      .split('+')
      .map((part) => parseNumber(part))
      .filter((part) => Number.isFinite(part));
    if (!parts.length) return null;
    return parts.reduce((sum, part) => sum + part, 0);
  }

  return parseNumber(text);
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: digits }).format(value);
}

function keyForOverride(name, address) {
  return `${normalize(name)}|${normalize(address)}`;
}

function currentCollection() {
  return {
    type: 'FeatureCollection',
    features: state.filteredFeatures,
  };
}

function applyFilters() {
  const search = normalize(state.search);

  state.filteredFeatures = state.data.features.filter((feature) => {
    const p = feature.properties;

    if (state.usage !== 'all' && p.usage !== state.usage) return false;
    if (state.zoning !== 'all' && p.zoning !== state.zoning) return false;

    if (!search) return true;
    const haystack = [p.name, p.address, p.significance, p.owner, p.usage, p.zoning]
      .map(normalize)
      .join(' ');

    return haystack.includes(search);
  });

  const isSelectedVisible = state.filteredFeatures.some(
    (feature) => String(feature.properties.id) === String(state.selectedId),
  );
  if (!isSelectedVisible) state.selectedId = null;

  updateSourceData();
  renderStats();
  renderList();
  syncDetailCard();
  renderTrends();
}

function addDataLayers() {
  if (!map.getSource('heritage')) {
    map.addSource('heritage', {
      type: 'geojson',
      data: currentCollection(),
      cluster: true,
      clusterRadius: 55,
      clusterMaxZoom: 14,
    });
  }

  if (!map.getLayer('cluster-halo')) {
    map.addLayer({
      id: 'cluster-halo',
      type: 'circle',
      source: 'heritage',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(255, 77, 41, 0.2)',
        'circle-radius': ['step', ['get', 'point_count'], 24, 10, 32, 25, 40],
        'circle-blur': 0.5,
      },
    });
  }

  if (!map.getLayer('clusters')) {
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'heritage',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#ff4d29', 10, '#ff6749', 25, '#ff8368'],
        'circle-radius': ['step', ['get', 'point_count'], 17, 10, 22, 25, 27],
        'circle-stroke-color': '#0a0b0f',
        'circle-stroke-width': 1.5,
      },
    });
  }

  if (!map.getLayer('cluster-count')) {
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'heritage',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 11,
      },
      paint: {
        'text-color': '#11121a',
      },
    });
  }

  if (!map.getLayer('points')) {
    map.addLayer({
      id: 'points',
      type: 'circle',
      source: 'heritage',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#c7c9d4',
        'circle-radius': 5.5,
        'circle-stroke-width': 1.3,
        'circle-stroke-color': '#0f1118',
      },
    });
  }

  if (!map.getLayer('selected-halo')) {
    map.addLayer({
      id: 'selected-halo',
      type: 'circle',
      source: 'heritage',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-color': 'rgba(58, 109, 255, 0.28)',
        'circle-radius': 18,
        'circle-blur': 0.45,
      },
    });
  }

  if (!map.getLayer('selected-point')) {
    map.addLayer({
      id: 'selected-point',
      type: 'circle',
      source: 'heritage',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-color': '#3a6dff',
        'circle-radius': 7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f5f7ff',
      },
    });
  }

  bindLayerInteractions();
  updateSelectedLayer();
}

function bindLayerInteractions() {
  if (map.__heritageBound) return;
  map.__heritageBound = true;

  map.on('click', 'clusters', (event) => {
    const [feature] = map.queryRenderedFeatures(event.point, { layers: ['clusters'] });
    if (!feature) return;

    const clusterId = feature.properties.cluster_id;
    map.getSource('heritage').getClusterExpansionZoom(clusterId, (error, zoom) => {
      if (error) return;
      map.easeTo({ center: feature.geometry.coordinates, zoom });
    });
  });

  map.on('click', 'points', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectFeatureById(feature.properties.id, true);
  });

  for (const layerId of ['clusters', 'points']) {
    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

function updateSourceData() {
  const source = map.getSource('heritage');
  if (!source) return;
  source.setData(currentCollection());
}

function renderStats() {
  const shown = state.filteredFeatures.length;
  const total = state.data.features.length;
  const missingCoords = state.data.skippedRows || 0;

  stats.innerHTML = `
    <div class="stat-card">
      <small>Visible</small>
      <strong>${shown}</strong>
    </div>
    <div class="stat-card">
      <small>Total</small>
      <strong>${total}</strong>
    </div>
    <div class="stat-card">
      <small>Missing GPS</small>
      <strong>${missingCoords}</strong>
    </div>
  `;
}

function renderList() {
  siteList.innerHTML = '';

  for (const feature of state.filteredFeatures) {
    const item = document.createElement('li');
    const isActive = String(feature.properties.id) === String(state.selectedId);
    item.className = `site-item ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <button data-id="${feature.properties.id}">
        <strong>${feature.properties.name || 'Unnamed site'}</strong>
        <span>${feature.properties.address || 'No address'}</span>
      </button>
    `;
    siteList.appendChild(item);
  }
}

function getMetricsRows() {
  return state.filteredFeatures.map((feature) => {
    const p = feature.properties;
    const override = METRIC_OVERRIDES.get(keyForOverride(p.name, p.address));

    const sizeFromData = parseSizeNumber(p.erfSize);
    const municipalValue = parseNumber(p.cmaMunicipalValue2023);
    const estValue = parseNumber(p.estValue);
    const valueFromData = municipalValue ?? estValue;

    const size = override?.size ?? sizeFromData;
    const value = override?.value ?? valueFromData;
    const rates = parseNumber(p.cmaRatesEstimate);

    return {
      id: p.id,
      name: p.name || 'Unnamed site',
      size,
      value,
      rates,
      pricePerM2: Number.isFinite(size) && size > 0 && Number.isFinite(value) ? value / size : null,
    };
  });
}

function renderTrendCards(rows) {
  const sizedRows = rows.filter((row) => Number.isFinite(row.size) && row.size > 0 && row.size < 20000);
  const usable = rows.filter(
    (row) =>
      Number.isFinite(row.size) &&
      row.size > 0 &&
      row.size < 20000 &&
      Number.isFinite(row.value) &&
      row.value > 0,
  );

  const totalValue = usable.reduce((acc, row) => acc + row.value, 0);
  const totalFootprint = sizedRows.reduce((acc, row) => acc + row.size, 0);

  const perM2 = usable.map((row) => row.pricePerM2).filter((value) => Number.isFinite(value));
  const avgPerM2 = perM2.length ? perM2.reduce((acc, value) => acc + value, 0) / perM2.length : null;

  const rates = rows.map((row) => row.rates).filter((value) => Number.isFinite(value));
  const avgRates = rates.length ? rates.reduce((acc, value) => acc + value, 0) / rates.length : null;

  trendCards.innerHTML = `
    <article class="trend-card"><p>Portfolio Value</p><strong>${formatCurrency(totalValue)}</strong></article>
    <article class="trend-card"><p>Portfolio Footprint</p><strong>${formatNumber(totalFootprint)} m2</strong></article>
    <article class="trend-card"><p>Avg Value / m2</p><strong>${formatCurrency(avgPerM2)}</strong></article>
    <article class="trend-card"><p>Avg Rates</p><strong>${formatCurrency(avgRates)}</strong></article>
  `;
}

function renderSizeValueChart(rows) {
  const points = rows.filter(
    (row) =>
      Number.isFinite(row.size) &&
      row.size > 0 &&
      row.size < 20000 &&
      Number.isFinite(row.value) &&
      row.value > 0,
  );
  if (!points.length) {
    sizeValueChart.innerHTML = '<p class="empty">No size/value records in current filter.</p>';
    return;
  }

  const width = 620;
  const height = 270;
  const pad = { top: 20, right: 16, bottom: 30, left: 58 };
  const maxX = Math.max(...points.map((point) => point.size));
  const maxY = Math.max(...points.map((point) => point.value));
  const minX = Math.min(...points.map((point) => point.size));
  const minY = Math.min(...points.map((point) => point.value));

  const xMin = Math.max(0, minX * 0.9);
  const xMax = maxX * 1.1;
  const yMin = Math.max(0, minY * 0.9);
  const yMax = maxY * 1.1;

  const x = (value) => pad.left + ((value - xMin) / (xMax - xMin || 1)) * (width - pad.left - pad.right);
  const y = (value) =>
    height - pad.bottom - ((value - yMin) / (yMax - yMin || 1)) * (height - pad.top - pad.bottom);

  const xTickCount = 5;
  const yTickCount = 4;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => xMin + (index / (xTickCount - 1)) * (xMax - xMin));
  const yTicks = Array.from({ length: yTickCount }, (_, index) => yMin + (index / (yTickCount - 1)) * (yMax - yMin));

  const vGrid = xTicks
    .map((tick) => {
      const xx = x(tick);
      return `
        <line class="grid-line" x1="${xx}" y1="${pad.top}" x2="${xx}" y2="${height - pad.bottom}" />
        <text class="tick-label x-tick" x="${xx}" y="${height - 10}">${formatNumber(tick)}</text>
      `;
    })
    .join('');

  const hGrid = yTicks
    .map((tick) => {
      const yy = y(tick);
      return `
        <line class="grid-line" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />
        <text class="tick-label y-tick" x="${pad.left - 8}" y="${yy + 3}">${formatNumber(tick / 1000000, 1)}M</text>
      `;
    })
    .join('');

  const circles = points
    .map(
      (point) => {
        const radius = 5.8;
        return `<circle cx="${x(point.size).toFixed(2)}" cy="${y(point.value).toFixed(2)}" r="${radius}"><title>${point.name}: ${formatNumber(point.size)} m2 | ${formatCurrency(point.value)}</title></circle>`;
      },
    )
    .join('');

  sizeValueChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="ERF size and value chart">
      ${hGrid}
      ${vGrid}
      <line class="axis-line" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" />
      <line class="axis-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" />
      ${circles}
      <text class="axis-label" x="${pad.left}" y="${pad.top - 8}">Value (ZAR)</text>
      <text class="axis-label" x="${width - pad.right - 92}" y="${height - 8}">ERF Size (m2)</text>
    </svg>
  `;
}

function renderPricingTable(rows) {
  const ranked = rows
    .filter((row) => Number.isFinite(row.pricePerM2))
    .sort((a, b) => b.pricePerM2 - a.pricePerM2)
    .slice(0, 10);

  if (!ranked.length) {
    pricingTableBody.innerHTML = '<tr><td colspan="4">No pricing data in current filter.</td></tr>';
    return;
  }

  pricingTableBody.innerHTML = ranked
    .map(
      (row) => `
        <tr>
          <td>${row.name}</td>
          <td>${formatNumber(row.size)}</td>
          <td>${formatCurrency(row.value)}</td>
          <td>${formatCurrency(row.pricePerM2)}</td>
        </tr>
      `,
    )
    .join('');
}

function renderTrends() {
  const rows = getMetricsRows();
  renderTrendCards(rows);
  renderSizeValueChart(rows);
  renderPricingTable(rows);
}

function featureById(id) {
  return state.filteredFeatures.find((feature) => String(feature.properties.id) === String(id)) || null;
}

function updateSelectedLayer() {
  const targetId = state.selectedId ? String(state.selectedId) : '';
  if (map.getLayer('selected-point')) {
    map.setFilter('selected-point', ['==', ['get', 'id'], targetId]);
  }
  if (map.getLayer('selected-halo')) {
    map.setFilter('selected-halo', ['==', ['get', 'id'], targetId]);
  }
}

function syncDetailCard() {
  const feature = state.selectedId ? featureById(state.selectedId) : null;
  if (!feature || state.view !== 'map') {
    detailCard.classList.add('hidden');
    detailCard.innerHTML = '';
    updateSelectedLayer();
    return;
  }

  const p = feature.properties;
  detailCard.classList.remove('hidden');
  detailCard.innerHTML = `
    <h2>${p.name || 'Unnamed site'}</h2>
    <p class="address">${p.address || 'No address listed'}</p>

    <dl>
      <div><dt>Usage</dt><dd>${p.usage || 'N/A'}</dd></div>
      <div><dt>Zoning</dt><dd>${p.zoning || 'N/A'}</dd></div>
      <div><dt>ERF</dt><dd>${p.erfNo || 'N/A'}</dd></div>
      <div><dt>ERF Size</dt><dd>${p.erfSize || 'N/A'}</dd></div>
      <div><dt>Municipal Value</dt><dd>${p.cmaMunicipalValue2023 || p.estValue || 'N/A'}</dd></div>
      <div><dt>Rates Est.</dt><dd>${p.cmaRatesEstimate || 'N/A'}</dd></div>
      <div><dt>Owner</dt><dd>${p.owner || 'N/A'}</dd></div>
    </dl>

    <p class="sig">${p.significance || 'No significance text available.'}</p>
  `;

  updateSelectedLayer();
}

function selectFeatureById(id, flyTo = false) {
  state.selectedId = id;
  renderList();
  syncDetailCard();

  const feature = featureById(id);
  if (feature && flyTo && state.view === 'map') {
    map.flyTo({
      center: feature.geometry.coordinates,
      zoom: Math.max(map.getZoom(), 16.5),
      speed: 0.72,
      curve: 1.15,
      essential: true,
    });
  }
}

function fitToVisible() {
  if (!state.filteredFeatures.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  for (const feature of state.filteredFeatures) {
    bounds.extend(feature.geometry.coordinates);
  }

  const leftPad = window.innerWidth < 860 ? 30 : 440;
  map.fitBounds(bounds, {
    padding: { top: 100, right: 100, bottom: 100, left: leftPad },
    duration: 850,
    maxZoom: 16,
  });
}

function setView(view) {
  state.view = view;

  const buttons = viewSwitch.querySelectorAll('.view-btn');
  for (const button of buttons) {
    button.classList.toggle('active', button.dataset.view === view);
  }

  const mapVisible = view === 'map';
  document.querySelector('#map').classList.toggle('hidden', !mapVisible);
  document.querySelector('.dot-grid').classList.toggle('hidden', !mapVisible);
  detailCard.classList.toggle('hidden', !mapVisible || !state.selectedId);
  trendsView.classList.toggle('hidden', mapVisible);
  styleToggle.disabled = !mapVisible;
  styleToggle.classList.toggle('disabled', !mapVisible);

  if (mapVisible) {
    setTimeout(() => map.resize(), 120);
  }

  syncDetailCard();
}

function wireInputs() {
  searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    applyFilters();
  });

  usageFilter.addEventListener('change', (event) => {
    state.usage = event.target.value;
    applyFilters();
  });

  zoningFilter.addEventListener('change', (event) => {
    state.zoning = event.target.value;
    applyFilters();
  });

  siteList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    selectFeatureById(button.dataset.id, true);
  });

  styleToggle.addEventListener('click', () => {
    state.styleKey = state.styleKey === 'dark' ? 'satellite' : 'dark';
    styleToggle.textContent = state.styleKey === 'dark' ? 'Satellite' : 'Dark';

    map.setStyle(styles[state.styleKey]);
    map.once('style.load', () => {
      addDataLayers();
      updateSourceData();
      updateSelectedLayer();
    });
  });

  viewSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    setView(button.dataset.view);
  });
}

async function init() {
  await loadData();
  fillFilter(usageFilter, getUniqueValues('usage'));
  fillFilter(zoningFilter, getUniqueValues('zoning'));
  wireInputs();

  map.on('load', () => {
    addDataLayers();
    applyFilters();
    fitToVisible();
    setView('map');
  });
}

init().catch((error) => {
  app.innerHTML = `<pre class="error">${error.message}</pre>`;
  console.error(error);
});
