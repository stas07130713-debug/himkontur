import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, addProtocol, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { FetchSource, PMTiles, type RangeResponse, type Source } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoPoint } from '../core/types';
import type { Basemap } from './MapCanvas';

let protocolRegistered = false;
let offlineArchivePromise: Promise<PMTiles> | null = null;
setWorkerUrl(mapWorkerUrl);

class OfflineReadyPmtilesSource implements Source {
  private readonly rangedSource: FetchSource;
  private completeArchive: Promise<ArrayBuffer> | null = null;

  constructor(private readonly url: string) {
    this.rangedSource = new FetchSource(url);
  }

  getKey(): string {
    return this.url;
  }

  private loadCompleteArchive(): Promise<ArrayBuffer> {
    this.completeArchive ??= fetch(this.url, { cache: 'force-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`Локальный архив карты недоступен: ${response.status}`);
      return response.arrayBuffer();
    });
    return this.completeArchive;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    if (this.completeArchive === null) {
      try {
        return await this.rangedSource.getBytes(offset, length, signal, etag);
      } catch {
        // A service worker serves a precached PMTiles file as a complete 200
        // response. PMTiles normally expects HTTP byte ranges, so offline PWA
        // mode falls back to the same bundled archive held in memory and
        // returns the requested slice locally.
      }
    }
    const archive = await this.loadCompleteArchive();
    if (offset < 0 || length < 0 || offset + length > archive.byteLength)
      throw new Error('Запрошенный фрагмент выходит за границы локальной карты.');
    return { data: archive.slice(offset, offset + length) };
  }
}

function getOfflineArchive(): Promise<PMTiles> {
  if (offlineArchivePromise !== null) return offlineArchivePromise;
  const archiveUrl = new URL('map-data/monchegorsk-v5.pmtiles', document.baseURI).href;
  // PMTiles reads only the header, directory and currently visible tiles via
  // byte ranges. Loading the whole archive here blocked the reference cards
  // and looked like an endless application startup on slower devices.
  offlineArchivePromise = Promise.resolve(new PMTiles(new OfflineReadyPmtilesSource(archiveUrl)));
  return offlineArchivePromise;
}

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  addProtocol('localtiles', async (request) => {
    const coordinates = /\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if (coordinates === null) return { data: new Uint8Array() };
    const [, zoom, column, row] = coordinates;
    const archive = await getOfflineArchive();
    const tile = await archive.getZxy(Number(zoom), Number(column), Number(row));
    return { data: tile?.data ?? new Uint8Array() };
  });
  protocolRegistered = true;
}

function satelliteTileTemplate(): string {
  const local = navigator.userAgent.includes('Electron') ||
    (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) && window.location.port !== '');
  return local
    ? '/map-tiles/esri/{z}/{y}/{x}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
}

const LOCAL_LAYER_IDS = [
  'earth', 'landcover', 'landuse', 'water', 'buildings', 'roads-casing', 'roads', 'boundaries',
] as const;

function basemapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        tiles: ['localtiles://tiles/{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: 15,
        attribution: '© Protomaps © OpenStreetMap contributors',
      },
      satellite: {
        type: 'raster',
        tiles: [satelliteTileTemplate()],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: 'Источник снимков: Esri World Imagery',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf1ea' } },
      { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': '#f2efe6' } },
      { id: 'landcover', type: 'fill', source: 'protomaps', 'source-layer': 'landcover', paint: { 'fill-color': '#dce9d2', 'fill-opacity': 0.72 } },
      { id: 'landuse', type: 'fill', source: 'protomaps', 'source-layer': 'landuse', paint: { 'fill-color': '#e5eadc', 'fill-opacity': 0.68 } },
      { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': '#9fcfe0' } },
      { id: 'buildings', type: 'fill', source: 'protomaps', 'source-layer': 'buildings', minzoom: 10, paint: { 'fill-color': '#cbbfb3', 'fill-outline-color': '#ae9e91' } },
      { id: 'roads-casing', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': '#c8bcae', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 15, 5] } },
      { id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': '#fffdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.25, 15, 3] } },
      { id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries', paint: { 'line-color': '#8b9a94', 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      {
        id: 'satellite-imagery',
        type: 'raster',
        source: 'satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 0, 'raster-opacity': 1 },
      },
    ],
  };
}

function applyBasemap(map: MapLibreMap, basemap: Basemap, container: HTMLDivElement | null) {
  const satellite = basemap === 'satellite';
  // The local vector map always remains underneath the optional online
  // imagery. If the network disappears or an imagery tile is unavailable,
  // the user sees a complete autonomous map instead of empty squares.
  for (const layerId of LOCAL_LAYER_IDS) {
    if (map.getLayer(layerId) !== undefined) map.setLayoutProperty(layerId, 'visibility', 'visible');
  }
  if (map.getLayer('satellite-imagery') !== undefined) {
    map.setLayoutProperty('satellite-imagery', 'visibility', satellite ? 'visible' : 'none');
  }
  if (container !== null) {
    container.dataset.basemap = basemap;
    container.dataset.satelliteRequested = String(satellite);
  }
}

export function OfflineBasemap({ center, zoom, basemap }: Readonly<{ center: GeoPoint; zoom: number; basemap: Basemap }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const initialViewRef = useRef({ center, zoom });
  const initialStyleRef = useRef(basemapStyle());
  const appliedBasemapRef = useRef(basemap);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    ensurePmtilesProtocol();
    container.dataset.mapStatus = 'starting';
    const initialView = initialViewRef.current;
    const map = new MapLibreMap({
      container,
      center: [initialView.center.longitude, initialView.center.latitude],
      zoom: initialView.zoom,
      style: initialStyleRef.current,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.on('load', () => {
      applyBasemap(map, appliedBasemapRef.current, container);
      container.dataset.mapReady = 'true';
      container.dataset.mapStatus = 'loaded';
    });
    map.on('styledata', () => { container.dataset.styleEvent = 'true'; });
    map.on('idle', () => { container.dataset.mapIdle = 'true'; container.dataset.mapStatus = 'idle'; });
    map.on('sourcedata', (event) => {
      if (event.isSourceLoaded) container.dataset.sourceReady = 'true';
    });
    map.on('error', (event) => {
      const message = event.error.message;
      container.dataset.mapError = message;
      // Failure of the optional Internet imagery is not a map failure: the
      // bundled vector map is still fully usable and stays visible beneath it.
      if (!/satellite|arcgis|map-tiles|tile/iu.test(message)) container.dataset.mapStatus = 'error';
    });
    const auditTimer = window.setInterval(() => {
      container.dataset.styleLoaded = String(map.isStyleLoaded());
      container.dataset.mapZoom = map.getZoom().toFixed(2);
      const currentCenter = map.getCenter();
      container.dataset.mapCenter = `${currentCenter.lng.toFixed(6)},${currentCenter.lat.toFixed(6)}`;
    }, 500);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      window.clearInterval(auditTimer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    const container = containerRef.current;
    applyBasemap(map, basemap, container);
  }, [basemap]);

  useEffect(() => {
    mapRef.current?.jumpTo({ center: [center.longitude, center.latitude], zoom });
  }, [center.latitude, center.longitude, zoom]);

  const tileSource = basemap === 'satellite' ? satelliteTileTemplate() : 'local-pmtiles';
  return <div className="offline-vector-map" ref={containerRef} data-basemap={basemap} data-tile-source={tileSource} aria-hidden="true" />;
}
