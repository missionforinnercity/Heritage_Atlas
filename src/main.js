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

    <header class="topbar">
      <div class="title-wrap">
        <p class="kicker">Mission For Inner City</p>
        <h1>Heritage Atlas</h1>
      </div>
      <div class="actions">
        <div class="view-switch" id="viewSwitch">
          <button class="view-btn active" data-view="trends">Dashboard</button>
          <button class="view-btn" data-view="map">Map</button>
        </div>
        <button id="styleToggle" class="pill-btn">Dark Map</button>
      </div>
    </header>

    <aside class="dock">
      <label class="field search-field">
        <span>Search</span>
        <input id="searchInput" type="search" placeholder="Buildings, streets, notes" />
      </label>

      <div class="filter-row">
        <label class="field">
          <span>Usage</span>
          <select id="usageFilter"></select>
        </label>
        <label class="field">
          <span>Zoning</span>
          <select id="zoningFilter"></select>
        </label>
        <label class="field">
          <span>Heritage Grade</span>
          <select id="heritageGradeFilter"></select>
        </label>
      </div>

      <div class="stats" id="stats"></div>

      <div class="list-block">
        <p class="list-title">Listed Sites</p>
        <ul id="siteList" class="site-list"></ul>
      </div>
    </aside>

    <main id="trendsView" class="trends-view">
      <section class="trend-cards" id="trendCards"></section>

      <section class="trend-panel chart-panel">
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
const heritageGradeFilter = document.querySelector('#heritageGradeFilter');
const siteList = document.querySelector('#siteList');
const stats = document.querySelector('#stats');
const detailCard = document.querySelector('#detailCard');
const styleToggle = document.querySelector('#styleToggle');
const trendsView = document.querySelector('#trendsView');
const viewSwitch = document.querySelector('#viewSwitch');
const trendCards = document.querySelector('#trendCards');
const sizeValueChart = document.querySelector('#sizeValueChart');
const pricingTableBody = document.querySelector('#pricingTableBody');
const mapContainer = document.querySelector('#map');

const state = {
  data: null,
  filteredFeatures: [],
  selectedId: null,
  search: '',
  usage: 'all',
  zoning: 'all',
  heritageGrade: 'all',
  styleKey: 'light',
  view: 'trends',
};

const styles = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite3d: 'mapbox://styles/mapbox/satellite-streets-v12',
};
const styleOrder = ['light', 'dark', 'satellite3d'];

const METRIC_OVERRIDES = new Map([
  ['tobacco mini market|93 loop street', { size: 453, value: 16000000 }],
  ['121 long salon|121 long st', { size: 64, value: 7500000 }],
  ['langham house|59 long st', { size: 190, value: 12850000 }],
]);

const map = new mapboxgl.Map({
  container: 'map',
  style: styles.light,
  center: [18.4233, -33.9189],
  zoom: 14,
  pitch: 0,
  bearing: 0,
  attributionControl: false,
  antialias: true,
});

map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

async function loadData() {
  const response = await fetch(`/data/heritage.geojson?t=${Date.now()}`, { cache: 'no-store' });
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
  return new Intl.NumberFormat('en-ZA', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? digits : 0,
    useGrouping: true,
  }).format(value);
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
    if (state.heritageGrade !== 'all' && p.heritageCityGrade !== state.heritageGrade) return false;

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
      clusterRadius: 46,
      clusterMaxZoom: 14,
    });
  }

  if (!map.getLayer('clusters')) {
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'heritage',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#f25734', 10, '#d94f30', 25, '#bc472c'],
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 25, 25],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111111',
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
        'text-color': '#111111',
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
        'circle-color': '#111111',
        'circle-radius': 5.5,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f2f2f7',
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
        'circle-color': '#f25734',
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111111',
      },
    });
  }

  bindLayerInteractions();
  updateSelectedLayer();
}

function ensure3DContext() {
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    });
  }

  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.15 });
  map.setFog({
    range: [-0.2, 2],
    color: '#ffffff',
    'high-color': '#f2f2f7',
    'space-color': '#e3e3e3',
    'horizon-blend': 0.12,
  });

  if (!map.getLayer('3d-buildings')) {
    const layers = map.getStyle().layers || [];
    const labelLayer = layers.find((layer) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']);
    const beforeId = labelLayer ? labelLayer.id : undefined;

    map.addLayer(
      {
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', ['get', 'extrude'], 'true'],
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#d7d9df',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.72,
        },
      },
      beforeId,
    );
  }

  map.easeTo({ pitch: 58, bearing: -20, duration: 900 });
}

function applyMapPresentation() {
  if (state.styleKey === 'satellite3d') {
    ensure3DContext();
    return;
  }

  map.setTerrain(null);
  map.setFog(null);
  map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
}

function updateStyleToggleLabel() {
  styleToggle.textContent =
    state.styleKey === 'light'
      ? 'Dark Map'
      : state.styleKey === 'dark'
        ? 'Satellite 3D'
        : 'Light Map';
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
    <div class="stat-card"><small>Visible</small><strong>${shown}</strong></div>
    <div class="stat-card"><small>Total</small><strong>${total}</strong></div>
    <div class="stat-card"><small>Missing GPS</small><strong>${missingCoords}</strong></div>
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
    (row) => Number.isFinite(row.size) && row.size > 0 && row.size < 20000 && Number.isFinite(row.value) && row.value > 0,
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
    (row) => Number.isFinite(row.size) && row.size > 0 && row.size < 20000 && Number.isFinite(row.value) && row.value > 0,
  );

  if (!points.length) {
    sizeValueChart.innerHTML = '<p class="empty">No size/value records in current filter.</p>';
    return;
  }

  const width = 720;
  const height = 360;
  const pad = { top: 32, right: 24, bottom: 58, left: 76 };

  const maxX = Math.max(...points.map((p) => p.size));
  const maxY = Math.max(...points.map((p) => p.value));
  const minX = Math.min(...points.map((p) => p.size));
  const minY = Math.min(...points.map((p) => p.value));

  const xMin = Math.max(0, minX * 0.9);
  const xMax = maxX * 1.08;
  const yMin = Math.max(0, minY * 0.9);
  const yMax = maxY * 1.08;

  const x = (value) => pad.left + ((value - xMin) / (xMax - xMin || 1)) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - ((value - yMin) / (yMax - yMin || 1)) * (height - pad.top - pad.bottom);

  const gridPitch = 14;
  const dotGrid = [];
  for (let yy = pad.top; yy <= height - pad.bottom; yy += gridPitch) {
    for (let xx = pad.left; xx <= width - pad.right; xx += gridPitch) {
      dotGrid.push(`<circle class="bg-dot" cx="${xx}" cy="${yy}" r="1.4" />`);
    }
  }

  const xTicks = [xMin, xMin + (xMax - xMin) / 2, xMax];
  const yTicks = [yMin, yMin + (yMax - yMin) / 2, yMax];

  const xTickLabels = xTicks
    .map((tick, i) => {
      const xx = x(tick);
      const isLast = i === xTicks.length - 1;
      return `<text class="tick-label x-tick" x="${xx}" y="${height - 30}">${isLast ? '' : formatNumber(tick)}</text>`;
    })
    .join('');

  const yTickLabels = yTicks
    .map((tick) => {
      const yy = y(tick);
      return `<text class="tick-label y-tick" x="${pad.left - 10}" y="${yy + 3}">${formatNumber(tick / 1000000, 1)}M</text>`;
    })
    .join('');

  const pointMarks = points
    .map((point) => {
      const cx = x(point.size);
      const cy = y(point.value);
      return `<g><circle class="point" cx="${cx}" cy="${cy}" r="6"></circle><title>${point.name}: ${formatNumber(point.size)} m2 | ${formatCurrency(point.value)}</title></g>`;
    })
    .join('');

  sizeValueChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-label="ERF size and value chart">
      ${dotGrid.join('')}
      <line class="axis-line" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" />
      <line class="axis-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" />
      ${xTickLabels}
      ${yTickLabels}
      ${pointMarks}
      <text class="axis-label" x="${pad.left}" y="${pad.top - 14}">VALUE (ZAR)</text>
      <text class="axis-label x-axis-label" x="${width - pad.right}" y="${height - 12}">ERF SIZE (M2)</text>
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
      <div><dt>City Grade</dt><dd>${p.heritageCityGrade || 'N/A'}</dd></div>
      <div><dt>Council Grade</dt><dd>${p.heritageCouncilGrade || 'N/A'}</dd></div>
      <div><dt>NHRA Status</dt><dd>${p.nhraStatus || 'N/A'}</dd></div>
      <div><dt>Heritage Source</dt><dd>${p.heritageAddress || 'N/A'}</dd></div>
      <div><dt>Match Method</dt><dd>${p.heritageMatchMethod || 'N/A'}${p.heritageMatchConfidence ? ` (${p.heritageMatchConfidence})` : ''}</dd></div>
    </dl>
    <p class="sig">${p.heritageStatement || p.significance || 'No significance text available.'}</p>
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
      zoom: Math.max(map.getZoom(), 16),
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

  const leftPad = window.innerWidth < 980 ? 20 : 430;
  map.fitBounds(bounds, {
    padding: { top: 80, right: 80, bottom: 80, left: leftPad },
    duration: 850,
    maxZoom: 16,
  });
}

function setView(view) {
  state.view = view;
  const mapVisible = view === 'map';

  for (const button of viewSwitch.querySelectorAll('.view-btn')) {
    button.classList.toggle('active', button.dataset.view === view);
  }

  mapContainer.classList.toggle('hidden', !mapVisible);
  detailCard.classList.toggle('hidden', !mapVisible || !state.selectedId);
  trendsView.classList.toggle('hidden', mapVisible);
  styleToggle.disabled = !mapVisible;
  styleToggle.classList.toggle('disabled', !mapVisible);

  if (mapVisible) setTimeout(() => map.resize(), 120);
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

  heritageGradeFilter.addEventListener('change', (event) => {
    state.heritageGrade = event.target.value;
    applyFilters();
  });

  siteList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    selectFeatureById(button.dataset.id, true);
  });

  styleToggle.addEventListener('click', () => {
    const currentIndex = styleOrder.indexOf(state.styleKey);
    state.styleKey = styleOrder[(currentIndex + 1) % styleOrder.length];
    updateStyleToggleLabel();

    map.setStyle(styles[state.styleKey]);
    map.once('style.load', () => {
      addDataLayers();
      applyMapPresentation();
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
  fillFilter(heritageGradeFilter, getUniqueValues('heritageCityGrade'));
  wireInputs();

  map.on('load', () => {
    addDataLayers();
    applyMapPresentation();
    applyFilters();
    fitToVisible();
    const defaultView = window.innerWidth < 980 ? 'trends' : 'map';
    updateStyleToggleLabel();
    setView(defaultView);
  });
}

init().catch((error) => {
  app.innerHTML = `<pre class="error">${error.message}</pre>`;
  console.error(error);
});
