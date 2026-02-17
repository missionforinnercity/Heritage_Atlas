import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const workbookPath = path.resolve(rootDir, '..', 'Heritage%20Stock_UPDATED_with_CMA_ROWS1-7_FILLED.xlsx');
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

if (!fs.existsSync(workbookPath)) {
  throw new Error(`Workbook not found: ${workbookPath}`);
}

const workbook = XLSX.readFile(workbookPath, { cellDates: true });
const firstSheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' });

const features = [];
let skipped = 0;

for (const row of rows) {
  const coords = parseGps(row.CMA_GPS);
  if (!coords) {
    skipped += 1;
    continue;
  }

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
    },
  });
}

const geojson = {
  type: 'FeatureCollection',
  generatedAt: new Date().toISOString(),
  sourceWorkbook: path.basename(workbookPath),
  totalRows: rows.length,
  skippedRows: skipped,
  features,
};

fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

console.log(`Wrote ${features.length} features to ${outputPath}`);
console.log(`Skipped ${skipped} rows without valid GPS`);
