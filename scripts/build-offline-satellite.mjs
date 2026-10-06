#!/usr/bin/env node
/** Build the licensed offline satellite MBTiles package used by HIMKONTUR.
 *
 * Source: EOX Sentinel-2 cloudless 2016 (CC BY 4.0). Only the configured
 * Monchegorsk rectangle is downloaded. Convert the result with the official
 * `pmtiles convert` command before placing it in public/map-data.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const BOUNDS = [31.515, 67.495, 34.215, 68.355];
const MIN_ZOOM = 0;
const MAX_ZOOM = 13;
const TILE_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
const ATTRIBUTION = 'EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0';

function longitudeToColumn(longitude, zoom) {
  return Math.max(0, Math.min((2 ** zoom) - 1, Math.floor((longitude + 180) / 360 * (2 ** zoom))));
}

function latitudeToRow(latitude, zoom) {
  const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
  const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
  return Math.max(0, Math.min((2 ** zoom) - 1, Math.floor(value * (2 ** zoom))));
}

function enumerateTiles() {
  const [west, south, east, north] = BOUNDS;
  const tiles = [];
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
    const left = longitudeToColumn(west, zoom);
    const right = longitudeToColumn(east, zoom);
    const top = latitudeToRow(north, zoom);
    const bottom = latitudeToRow(south, zoom);
    for (let column = left; column <= right; column += 1)
      for (let row = top; row <= bottom; row += 1) tiles.push({ zoom, column, row });
  }
  return tiles;
}

async function downloadTile(tile) {
  const url = TILE_URL.replace('{z}', tile.zoom).replace('{y}', tile.row).replace('{x}', tile.column);
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
  const output = resolve(process.argv[2] ?? 'monchegorsk-satellite-v1.mbtiles');
  const workers = Math.max(1, Number.parseInt(process.argv[3] ?? '16', 10) || 16);
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
  const metadata = {
    name: 'HIMKONTUR Monchegorsk satellite 2016',
    type: 'baselayer', version: '1',
    description: 'Offline Sentinel-2 cloudless imagery for the HIMKONTUR operating area',
    format: 'jpg', bounds: BOUNDS.join(','), center: '32.86534,67.92528,12',
    minzoom: String(MIN_ZOOM), maxzoom: String(MAX_ZOOM), attribution: ATTRIBUTION,
  };
  database.exec('BEGIN');
  for (const [name, value] of Object.entries(metadata)) insertMetadata.run(name, value);
  database.exec('COMMIT');
  const insertTile = database.prepare('INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)');

  const tiles = enumerateTiles();
  console.log(`Downloading ${tiles.length} imagery tiles (z${MIN_ZOOM}-${MAX_ZOOM})`);
  let next = 0;
  let completed = 0;
  const runWorker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next];
      next += 1;
      const result = await downloadTile(tile);
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
