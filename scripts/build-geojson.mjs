import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const workbookPath = path.resolve(rootDir, '..', 'Heritage%20Stock_UPDATED_with_CMA_ROWS1-7_FILLED.xlsx');
const cbdGeojsonPath = path.resolve(rootDir, '..', 'CBD_Hertitage building.geojson');
const outputPath = path.resolve(rootDir, 'public', 'data', 'heritage.geojson');

function parseCoord(value, axis) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?/i);
  if (!match) return null;

  let numeric = Number.parseFloat(match[1]);
  if (Number.isNaN(numeric)) return null;

  const hemisphere = (match[2] || '').toUpperCase();
  if (hemisphere) {
    const isNegative = hemisphere === 'S' || hemisphere === 'W';
    numeric = Math.abs(numeric) * (isNegative ? -1 : 1);
  } else if (axis === 'lat') {
    numeric = -Math.abs(numeric);
  }

  return numeric;
}

function parseGps(gpsValue) {
  if (!gpsValue) return null;
  const parts = String(gpsValue)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const first = parseCoord(parts[0], 'lon');
  const second = parseCoord(parts[1], 'lat');
  if (first == null || second == null) return null;

  let lon = first;
  let lat = second;

  if (Math.abs(first) <= 90 && Math.abs(second) > 90) {
    lon = second;
    lat = first;
  }

  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return [lon, lat];
}

function asText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function projectLonLatTo3857(lonLat) {
  const [lon, lat] = lonLat;
  const maxLat = 85.05112878;
  const clampedLat = Math.max(-maxLat, Math.min(maxLat, lat));
  const radLon = (lon * Math.PI) / 180;
  const radLat = (clampedLat * Math.PI) / 180;
  const R = 6378137;

  return [R * radLon, R * Math.log(Math.tan(Math.PI / 4 + radLat / 2))];
}

function ringContainsPoint(ring, point) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function polygonContainsPoint(rings, point) {
  if (!rings.length) return false;
  if (!ringContainsPoint(rings[0], point)) return false;

  for (let i = 1; i < rings.length; i += 1) {
    if (ringContainsPoint(rings[i], point)) return false;
  }
  return true;
}

function pointInBBox(point, bbox) {
  const [x, y] = point;
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}

function computeBBox(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  return [minX, minY, maxX, maxY];
}

function normalize(value) {
  return asText(value) || null;
}

function normalizeAddress(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\bst\b/g, 'street')
    .replace(/\brd\b/g, 'road')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeAddress(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function extractHouseNumber(value) {
  const match = normalizeAddress(value).match(/\b\d{1,5}\b/);
  return match ? match[0] : '';
}

function matchScore(targetAddress, targetName, candidate) {
  const addressA = normalizeAddress(targetAddress);
  const nameA = normalizeAddress(targetName);
  const addressB = candidate.addressNorm;
  const nameB = candidate.siteNameNorm;

  let score = 0;

  const numberA = extractHouseNumber(addressA);
  const numberB = extractHouseNumber(addressB);
  if (numberA && numberB && numberA === numberB) score += 4;

  const tokensA = new Set([...tokens(addressA), ...tokens(nameA)]);
  const tokensB = new Set([...tokens(addressB), ...tokens(nameB)]);

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  score += overlap;

  if (addressA && addressB && (addressB.includes(addressA) || addressA.includes(addressB))) {
    score += 4;
  }

  return score;
}

function loadCBDIndex() {
  if (!fs.existsSync(cbdGeojsonPath)) return [];
  const cbd = JSON.parse(fs.readFileSync(cbdGeojsonPath, 'utf8'));
  const features = cbd.features || [];

  return features
    .map((feature) => {
      const p = feature.properties || {};
      const geometry = feature.geometry || {};
      let polygons = [];
      if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        polygons = geometry.coordinates;
      } else if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        polygons = [geometry.coordinates];
      }

      const heritageAddress = normalize(p.STR_ADR);
      const heritageSiteName = normalize(p.HRTG_INV_SITE_NAME);

      if ((!heritageAddress && !heritageSiteName) || !polygons.length) return null;

      const bbox = computeBBox(polygons);

      return {
        bbox,
        polygons,
        addressNorm: normalizeAddress(heritageAddress),
        siteNameNorm: normalizeAddress(heritageSiteName),
        properties: {
          heritageInventoryKey: normalize(p.SL_HRTG_INV_KEY),
          heritageStatus: normalize(p.HRTG_INV_STS),
          heritageSiteName,
          heritageResourceCategory: normalize(p.HRTG_INV_RCS_CAT),
          heritageTypePrimary: normalize(p.HRTG_INV_RCS_TYPE_1),
          heritageTypeSecondary: normalize(p.HRTG_INV_RCS_TYPE_2),
          heritageCityGrade: normalize(p.PRSD_CITY_GRD),
          heritageCouncilGrade: normalize(p.CNFR_CCT_GRD),
          heritageManagementGrade: normalize(p.CNFR_CCT_MGNT_GD),
          nhraStatus: normalize(p.NHRA_STS),
          heritageStatement: normalize(p.STMN_SGNF_SHRT),
          heritageAddress,
          heritageParcelKey: normalize(p.SL_LAND_PRCL_KEY),
        },
      };
    })
    .filter(Boolean);
}

if (!fs.existsSync(workbookPath)) {
  throw new Error(`Workbook not found: ${workbookPath}`);
}

const cbdIndex = loadCBDIndex();

const workbook = XLSX.readFile(workbookPath, { cellDates: true });
const firstSheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' });

const features = [];
let skipped = 0;
let matchedCBD = 0;
const ADDRESS_MATCH_THRESHOLD = 8;
const ADDRESS_MATCH_LOW_THRESHOLD = 6;

for (const row of rows) {
  const coords = parseGps(row.CMA_GPS);
  if (!coords) {
    skipped += 1;
    continue;
  }
  const point3857 = projectLonLatTo3857(coords);

  const sourceAddress = asText(row['77 Shortmarket Street']);
  const sourceName = asText(row['Name / Description']);

  let heritageContext = null;
  let matchMethod = null;
  let matchScoreValue = null;
  let matchConfidence = null;

  for (const candidate of cbdIndex) {
    if (!pointInBBox(point3857, candidate.bbox)) continue;

    let contained = false;
    for (const polygon of candidate.polygons) {
      if (polygonContainsPoint(polygon, point3857)) {
        contained = true;
        break;
      }
    }

    if (contained) {
      heritageContext = candidate.properties;
      matchMethod = 'spatial-3857';
      matchScoreValue = 100;
      matchConfidence = 'high';
      break;
    }
  }

  if (!heritageContext) {
    let bestCandidate = null;
    let bestScore = 0;
    for (const candidate of cbdIndex) {
      const score = matchScore(sourceAddress, sourceName, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    if (bestScore >= ADDRESS_MATCH_THRESHOLD && bestCandidate) {
      heritageContext = bestCandidate.properties;
      matchMethod = 'address-fuzzy';
      matchScoreValue = bestScore;
      matchConfidence = 'medium';
    } else if (bestScore >= ADDRESS_MATCH_LOW_THRESHOLD && bestCandidate) {
      heritageContext = bestCandidate.properties;
      matchMethod = 'address-fuzzy-low';
      matchScoreValue = bestScore;
      matchConfidence = 'low';
    }
  }

  if (heritageContext) matchedCBD += 1;

  features.push({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: coords,
    },
    properties: {
      id: asText(row['#']) || `row-${features.length + 1}`,
      name: asText(row['Name / Description']),
      address: asText(row['77 Shortmarket Street']),
      erfNo: asText(row['ERF No.']),
      erfSize: asText(row['ERF Size']),
      estValue: asText(row['Est. Value']),
      zoning: asText(row['CMA_Zoning'] || row['Zoning']),
      usage: asText(row['CMA_Usage']),
      owner: asText(row['CMA_Owner'] || row['Owner']),
      significance: asText(row['Heritage / Significance (as listed)']),
      cmaGps: asText(row.CMA_GPS),
      cmaMunicipalValue2023: asText(row.CMA_Municipal_value_2023),
      cmaRatesEstimate: asText(row.CMA_Rates_est),
      ...heritageContext,
      heritageMatchMethod: heritageContext ? matchMethod : null,
      heritageMatchScore: heritageContext ? matchScoreValue : null,
      heritageMatchConfidence: heritageContext ? matchConfidence : null,
      hasCBDHeritageMatch: Boolean(heritageContext),
    },
  });
}

const geojson = {
  type: 'FeatureCollection',
  generatedAt: new Date().toISOString(),
  sourceWorkbook: path.basename(workbookPath),
  sourceCBDGeoJSON: fs.existsSync(cbdGeojsonPath) ? path.basename(cbdGeojsonPath) : null,
  totalRows: rows.length,
  skippedRows: skipped,
  matchedCBDHeritageRows: matchedCBD,
  features,
};

fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

console.log(`Wrote ${features.length} features to ${outputPath}`);
console.log(`Skipped ${skipped} rows without valid GPS`);
console.log(`CBD heritage matches: ${matchedCBD}`);
