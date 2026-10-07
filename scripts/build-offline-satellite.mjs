#!/usr/bin/env node
/** Build the licensed offline satellite MBTiles package used by HIMKONTUR.
 *
 * Base source: EOX Sentinel-2 cloudless 2016 (CC BY 4.0). With --detail the
 * package also receives a nested high-resolution pyramid from Esri World
 * Imagery (for Export). An ArcGIS token can be supplied with ARCGIS_TOKEN when
 * the account requires it. The ordinary public World Imagery viewing layer is
 * deliberately never exported. Convert the result with the official
 * `pmtiles convert` command before placing it in public/map-data.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const BOUNDS = [31.515, 67.495, 34.215, 68.355];
const MIN_ZOOM = 0;
const MAX_ZOOM = 13;
const EOX_TILE_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
const ARCGIS_EXPORT_TILE_URL = 'https://tiledbasemaps.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const BASE_ATTRIBUTION = 'EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0';
const DETAIL_ATTRIBUTION = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community';

// Higher levels are deliberately nested. The broad operating rectangle stays
// compact, the city and industrial area get street-level detail, and the KGMK
// core receives the sharpest level without turning the APK into many gigabytes.
const DETAIL_TIERS = [
  { zoom: 14, bounds: [32.45, 67.78, 33.25, 68.07] },
  { zoom: 15, bounds: [32.58, 67.83, 33.17, 68.03] },
  { zoom: 16, bounds: [32.70, 67.87, 33.03, 67.99] },
];

function longitudeToColumn(longitude, zoom) {
  return Math.max(0, Math.min((2 ** zoom) - 1, Math.floor((longitude + 180) / 360 * (2 ** zoom))));
}

function latitudeToRow(latitude, zoom) {
  const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
  const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
  return Math.max(0, Math.min((2 ** zoom) - 1, Math.floor(value * (2 ** zoom))));
}

function enumerateBounds(bounds, minZoom, maxZoom, provider) {
  const [west, south, east, north] = bounds;
  const tiles = [];
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    const left = longitudeToColumn(west, zoom);
    const right = longitudeToColumn(east, zoom);
    const top = latitudeToRow(north, zoom);
    const bottom = latitudeToRow(south, zoom);
    for (let column = left; column <= right; column += 1)
      for (let row = top; row <= bottom; row += 1) tiles.push({ zoom, column, row, provider });
  }
  return tiles;
}

function enumerateTiles(includeDetail, selectedTier) {
  if (selectedTier !== null)
    return enumerateBounds(selectedTier.bounds, selectedTier.zoom, selectedTier.zoom, 'arcgis-export');
  const tiles = enumerateBounds(BOUNDS, MIN_ZOOM, MAX_ZOOM, 'eox');
  if (includeDetail)
    for (const tier of DETAIL_TIERS)
      tiles.push(...enumerateBounds(tier.bounds, tier.zoom, tier.zoom, 'arcgis-export'));
  return tiles;
}

async function downloadTile(tile, arcgisToken) {
  const template = tile.provider === 'arcgis-export' ? ARCGIS_EXPORT_TILE_URL : EOX_TILE_URL;
  const baseUrl = template
    .replace('{z}', tile.zoom)
    .replace('{y}', tile.row)
    .replace('{x}', tile.column);
  const url = tile.provider === 'arcgis-export' && arcgisToken.length > 0
    ? `${baseUrl}?token=${encodeURIComponent(arcgisToken)}`
    : baseUrl;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'HIMKONTUR offline-map builder/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length < 100 || data[0] !== 0xff || data[1] !== 0xd8)
        throw new Error(`unexpected response (${data.length} bytes)`);
      return { ...tile, data };
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 600 * attempt));
    }
  }
  throw new Error(`Cannot download ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  const output = resolve(process.argv[2] ?? 'monchegorsk-satellite-v2.mbtiles');
  const workers = Math.max(1, Number.parseInt(process.argv[3] ?? '16', 10) || 16);
  const includeDetail = process.argv.includes('--detail');
  const planOnly = process.argv.includes('--plan');
  const tierArgument = process.argv.find((argument) => argument.startsWith('--tier='));
  const tierZoom = tierArgument === undefined ? null : Number.parseInt(tierArgument.slice('--tier='.length), 10);
  const selectedTier = tierZoom === null ? null : DETAIL_TIERS.find((tier) => tier.zoom === tierZoom) ?? null;
  if (tierArgument !== undefined && selectedTier === null)
    throw new Error('Неизвестный уровень детализации. Допустимы --tier=14, --tier=15 или --tier=16.');
  const arcgisToken = process.env.ARCGIS_TOKEN?.trim() ?? '';
  const tiles = enumerateTiles(includeDetail, selectedTier);
  const minimumZoom = selectedTier?.zoom ?? MIN_ZOOM;
  const maximumZoom = selectedTier?.zoom ?? (includeDetail ? DETAIL_TIERS.at(-1).zoom : MAX_ZOOM);
  console.log(`Prepared ${tiles.length} imagery tiles (z${minimumZoom}-${maximumZoom})`);
  if (includeDetail && selectedTier === null) {
    console.log('Detailed tiers:');
    for (const tier of DETAIL_TIERS) {
      const count = enumerateBounds(tier.bounds, tier.zoom, tier.zoom, 'arcgis-export').length;
      console.log(`  z${tier.zoom}: ${count} tiles, ${tier.bounds.join(',')}`);
    }
  }
  if (planOnly) return;
  await mkdir(resolve(output, '..'), { recursive: true });
  await rm(output, { force: true });

  const database = new DatabaseSync(output);
  database.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);
  const insertMetadata = database.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
  const archiveBounds = selectedTier?.bounds ?? BOUNDS;
  const metadata = {
    name: selectedTier !== null
      ? `HIMKONTUR Monchegorsk offline satellite z${selectedTier.zoom}`
      : (includeDetail ? 'HIMKONTUR Monchegorsk detailed offline satellite' : 'HIMKONTUR Monchegorsk satellite 2016'),
    type: 'baselayer', version: '1',
    description: selectedTier !== null
      ? `Offline high-resolution imagery z${selectedTier.zoom} for the HIMKONTUR operating area`
      : (includeDetail
        ? 'Offline Sentinel-2 base with licensed nested high-resolution imagery for the HIMKONTUR operating area'
        : 'Offline Sentinel-2 cloudless imagery for the HIMKONTUR operating area'),
    format: 'jpg', bounds: archiveBounds.join(','), center: '32.86534,67.92528,12',
    minzoom: String(minimumZoom), maxzoom: String(maximumZoom),
    attribution: selectedTier !== null
      ? DETAIL_ATTRIBUTION
      : (includeDetail ? `${BASE_ATTRIBUTION}; ${DETAIL_ATTRIBUTION}` : BASE_ATTRIBUTION),
  };
  database.exec('BEGIN');
  for (const [name, value] of Object.entries(metadata)) insertMetadata.run(name, value);
  database.exec('COMMIT');
  const insertTile = database.prepare('INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)');

  console.log(`Downloading ${tiles.length} imagery tiles (z${MIN_ZOOM}-${maximumZoom})`);
  let next = 0;
  let completed = 0;
  const runWorker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next];
      next += 1;
      const result = await downloadTile(tile, arcgisToken);
      const tmsRow = (2 ** result.zoom) - 1 - result.row;
      insertTile.run(result.zoom, result.column, tmsRow, result.data);
      completed += 1;
      if (completed % 200 === 0) console.log(`${completed}/${tiles.length}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: workers }, runWorker));
  } finally {
    database.close();
  }
  const information = await stat(output);
  console.log(`Created ${output} (${(information.size / 1024 / 1024).toFixed(1)} MiB)`);
}

await main();
