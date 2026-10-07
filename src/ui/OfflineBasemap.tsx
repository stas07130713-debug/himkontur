import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Map as MapLibreMap, addProtocol, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { FetchSource, PMTiles, type RangeResponse, type Source } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoPoint } from '../core/types';
import type { Basemap } from './MapCanvas';

let protocolRegistered = false;
let offlineVectorArchivePromise: Promise<PMTiles> | null = null;
let offlineSatelliteArchivePromise: Promise<PMTiles> | null = null;
let satelliteSourceSequence = 0;
setWorkerUrl(new URL(mapWorkerUrl, document.baseURI).href);

function isNativeMobileRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

class OfflineReadyPmtilesSource implements Source {
  private readonly rangedSource: FetchSource;
  private completeArchive: Promise<ArrayBuffer> | null = null;
  private readonly useCompleteArchive: boolean;

  constructor(private readonly url: string) {
    this.rangedSource = new FetchSource(url);
    // Android WebView serves packaged assets through Capacitor's local HTTPS
    // server. Byte-range responses for compressed APK assets are not reliable
    // on every Android version. The bundled Monchegorsk archive is small
    // enough to read once and slice in memory, which makes the offline map
    // deterministic on phones while browsers keep efficient range requests.
    this.useCompleteArchive = isNativeMobileRuntime();
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
    if (!this.useCompleteArchive && this.completeArchive === null) {
      try {
        return await this.rangedSource.getBytes(offset, length, signal, etag);
      } catch {
        // A service worker serves a precached PMTiles file as a complete 200
        // response. PMTiles normally expects HTTP byte ranges, so offline PWA
        // mode falls back to the same bundled archive held in memory and
        // returns the requested slice locally.
      }
    }
    if (signal?.aborted === true) throw new DOMException('Операция отменена.', 'AbortError');
    const archive = await this.loadCompleteArchive();
    if (offset < 0 || length < 0 || offset + length > archive.byteLength)
      throw new Error('Запрошенный фрагмент выходит за границы локальной карты.');
    return { data: archive.slice(offset, offset + length) };
  }
}

function getOfflineArchive(kind: 'vector' | 'satellite'): Promise<PMTiles> {
  const current = kind === 'vector' ? offlineVectorArchivePromise : offlineSatelliteArchivePromise;
  if (current !== null) return current;
  const fileName = kind === 'vector' ? 'monchegorsk-v5.pmtiles' : 'monchegorsk-satellite-v1.pmtiles';
  const archiveUrl = new URL(`map-data/${fileName}`, document.baseURI).href;
  // PMTiles reads only the header, directory and currently visible tiles via
  // byte ranges. Loading the whole archive here blocked the reference cards
  // and looked like an endless application startup on slower devices.
  const archive = Promise.resolve(new PMTiles(new OfflineReadyPmtilesSource(archiveUrl)));
  if (kind === 'vector') offlineVectorArchivePromise = archive;
  else offlineSatelliteArchivePromise = archive;
  return archive;
}

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  addProtocol('localtiles', async (request) => {
    const coordinates = /\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if (coordinates === null) return { data: new Uint8Array() };
    const [, zoom, column, row] = coordinates;
    const archive = await getOfflineArchive('vector');
    const tile = await archive.getZxy(Number(zoom), Number(column), Number(row));
    return { data: tile?.data ?? new Uint8Array() };
  });
  addProtocol('localsatellite', async (request) => {
    const coordinates = /\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if (coordinates === null) return { data: new Uint8Array() };
    const [, zoom, column, row] = coordinates;
    const archive = await getOfflineArchive('satellite');
    const tile = await archive.getZxy(Number(zoom), Number(column), Number(row));
    return { data: tile?.data ?? new Uint8Array() };
  });
  protocolRegistered = true;
}

function satelliteTileTemplate(useOnlineDetail: boolean): string {
  if (!useOnlineDetail) return 'localsatellite://tiles/{z}/{x}/{y}';
  // The Windows shell stores successfully opened detailed tiles on disk. Web
  // and Android builds use the same provider directly; the PWA worker caches
  // recent tiles where the host WebView supports service workers.
  if (navigator.userAgent.includes('Electron')) return '/map-tiles/esri/{z}/{y}/{x}';
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
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
    ],
  };
}

function removeSatelliteLayer(map: MapLibreMap) {
  if (map.getLayer('satellite-imagery') !== undefined) map.removeLayer('satellite-imagery');
  for (const sourceId of Object.keys(map.getStyle().sources)) {
    if (sourceId.startsWith('satellite-') && map.getSource(sourceId) !== undefined)
      map.removeSource(sourceId);
  }
}

function setLocalLayersVisible(map: MapLibreMap, visible: boolean) {
  for (const layerId of LOCAL_LAYER_IDS) {
    if (map.getLayer(layerId) !== undefined)
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }
}

function revealCompleteSatellite(map: MapLibreMap, container: HTMLDivElement) {
  if (map.getLayer('satellite-imagery') === undefined || container.dataset.satelliteFailed === 'true') return;
  // Raster tiles arrive independently. Never show a half satellite / half
  // vector mosaic: retain the complete local map until every visible imagery
  // tile is ready, then replace the whole viewport in one repaint.
  map.setPaintProperty('satellite-imagery', 'raster-opacity', 1);
  setLocalLayersVisible(map, false);
  container.dataset.satelliteLoaded = 'true';
  container.dataset.renderMode = 'satellite';
}

function concealIncompleteSatellite(map: MapLibreMap, container: HTMLDivElement) {
  // Once a complete satellite frame has been shown, keep it during pan/zoom.
  // MapLibre stretches the previous imagery briefly while fetching the next
  // tiles; returning to the vector map on every movement looked like the
  // selected basemap was switching by itself.
  if (container.dataset.satelliteLoaded === 'true') return;
  if (map.getLayer('satellite-imagery') !== undefined)
    // A zero-opacity raster may be deprioritised by some WebView/MapLibre
    // combinations. This effectively invisible value keeps its requests
    // active while the complete local map remains visually dominant.
    map.setPaintProperty('satellite-imagery', 'raster-opacity', 0.001);
  setLocalLayersVisible(map, true);
  container.dataset.satelliteLoaded = 'false';
  container.dataset.renderMode = 'standard-fallback';
}

function applyBasemap(
  map: MapLibreMap,
  basemap: Basemap,
  container: HTMLDivElement | null,
  satelliteMode: 'auto' | 'local' = 'auto',
) {
  const satellite = basemap === 'satellite';
  const useOnlineDetail = satellite && satelliteMode === 'auto' && navigator.onLine;
  // Both basemaps are bundled. The vector layer remains underneath until the
  // complete local satellite frame is decoded, avoiding blank squares while
  // switching even on slower Android devices.
  setLocalLayersVisible(map, true);
  removeSatelliteLayer(map);
  if (satellite) {
    const satelliteSourceId = `satellite-${++satelliteSourceSequence}`;
    map.addSource(satelliteSourceId, {
      type: 'raster',
      tiles: [satelliteTileTemplate(useOnlineDetail)],
      tileSize: 256,
      minzoom: 0,
      maxzoom: useOnlineDetail ? 19 : 13,
      attribution: useOnlineDetail
        ? 'Source: Esri World Imagery'
        : 'EOxCloudless © EOX IT Services GmbH · Copernicus Sentinel data 2016 · CC BY 4.0',
    });
    map.addLayer({
      id: 'satellite-imagery',
      type: 'raster',
      source: satelliteSourceId,
      paint: { 'raster-fade-duration': 0, 'raster-opacity': 0.001 },
    });
  }
  if (container !== null) {
    container.dataset.basemap = basemap;
    container.dataset.satelliteRequested = String(satellite);
    if (satellite) container.dataset.satelliteSourceId = map.getLayer('satellite-imagery')?.source ?? '';
    else delete container.dataset.satelliteSourceId;
    container.dataset.satelliteLoaded = 'false';
    container.dataset.satelliteFailed = 'false';
    container.dataset.satelliteProvider = satellite
      ? (useOnlineDetail ? 'online-esri-world-imagery' : 'offline-eox-sentinel-2')
      : 'off';
    container.dataset.renderMode = satellite ? 'standard-fallback' : 'standard';
    delete container.dataset.mapError;
    delete container.dataset.satelliteError;
  }
  map.triggerRepaint();
}

export function OfflineBasemap({ center, zoom, basemap }: Readonly<{ center: GeoPoint; zoom: number; basemap: Basemap }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const initialViewRef = useRef({ center, zoom });
  const initialStyleRef = useRef(basemapStyle());
  const desiredBasemapRef = useRef(basemap);
  const appliedBasemapRef = useRef<Basemap | null>(null);
  const mapReadyRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    ensurePmtilesProtocol();
    container.dataset.mapStatus = 'starting';
    container.dataset.archiveMode = isNativeMobileRuntime() ? 'complete-local-archive' : 'http-range';
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
      mapReadyRef.current = true;
      applyBasemap(map, desiredBasemapRef.current, container);
      appliedBasemapRef.current = desiredBasemapRef.current;
      container.dataset.mapReady = 'true';
      container.dataset.mapStatus = 'loaded';
    });
    map.on('styledata', () => { container.dataset.styleEvent = 'true'; });
    map.on('idle', () => {
      container.dataset.mapIdle = 'true';
      container.dataset.mapStatus = 'idle';
      if (
        desiredBasemapRef.current === 'satellite' &&
        container.dataset.satelliteSourceId !== undefined &&
        map.getSource(container.dataset.satelliteSourceId) !== undefined &&
        map.isSourceLoaded(container.dataset.satelliteSourceId)
      ) revealCompleteSatellite(map, container);
    });
    map.on('sourcedata', (event) => {
      if (event.isSourceLoaded) container.dataset.sourceReady = 'true';
      if (event.sourceId === container.dataset.satelliteSourceId && desiredBasemapRef.current === 'satellite') {
        if (event.isSourceLoaded) revealCompleteSatellite(map, container);
        else concealIncompleteSatellite(map, container);
      }
    });
    map.on('error', (event) => {
      const message = event.error.message;
      const failedSourceId = (event as typeof event & { sourceId?: string }).sourceId;
      if (failedSourceId?.startsWith('satellite-') === true && failedSourceId !== container.dataset.satelliteSourceId)
        return;
      // A corrupt local imagery tile is not a total map failure: the bundled
      // vector map remains visible and the condition is exposed to audits.
      const optionalImageryFailure = /satellite|local|pmtiles|tile/iu.test(message) ||
        (/failed to fetch/iu.test(message) && container.dataset.sourceReady === 'true');
      if (optionalImageryFailure) {
        delete container.dataset.mapError;
        if (desiredBasemapRef.current === 'satellite') {
          if (container.dataset.satelliteProvider === 'online-esri-world-imagery') {
            container.dataset.satelliteProvider = 'switching-to-offline';
            window.setTimeout(() => {
              if (desiredBasemapRef.current !== 'satellite' || !mapReadyRef.current) return;
              applyBasemap(map, 'satellite', container, 'local');
              appliedBasemapRef.current = 'satellite';
            }, 0);
            return;
          }
          if (container.dataset.satelliteLoaded === 'true') {
            container.dataset.satelliteError = message;
            return;
          }
          container.dataset.satelliteFailed = 'true';
          container.dataset.satelliteError = message;
          concealIncompleteSatellite(map, container);
        }
      } else {
        container.dataset.mapError = message;
        container.dataset.mapStatus = 'error';
      }
    });
    const auditTimer = window.setInterval(() => {
      container.dataset.styleLoaded = String(map.isStyleLoaded());
      container.dataset.mapZoom = map.getZoom().toFixed(2);
      const currentCenter = map.getCenter();
      container.dataset.mapCenter = `${currentCenter.lng.toFixed(6)},${currentCenter.lat.toFixed(6)}`;
    }, 500);
    mapRef.current = map;
    let retryTimer: number | undefined;
    const retrySatellite = () => {
      window.clearTimeout(retryTimer);
      // Give Android WebView / the browser a moment to restore its network
      // stack. Starting requests in the same tick as the `online` event can
      // preserve the previous failed connection and leave Satellite stale.
      retryTimer = window.setTimeout(() => {
        if (desiredBasemapRef.current === 'satellite' && mapReadyRef.current) {
          applyBasemap(map, 'satellite', container);
          appliedBasemapRef.current = 'satellite';
        }
      }, 1200);
    };
    const useOfflineSatellite = () => {
      window.clearTimeout(retryTimer);
      if (
        desiredBasemapRef.current === 'satellite' &&
        mapReadyRef.current &&
        container.dataset.satelliteProvider === 'online-esri-world-imagery'
      ) {
        applyBasemap(map, 'satellite', container, 'local');
        appliedBasemapRef.current = 'satellite';
      }
    };
    window.addEventListener('online', retrySatellite);
    window.addEventListener('offline', useOfflineSatellite);
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      window.removeEventListener('online', retrySatellite);
      window.removeEventListener('offline', useOfflineSatellite);
      window.clearTimeout(retryTimer);
      window.clearInterval(auditTimer);
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    desiredBasemapRef.current = basemap;
    const map = mapRef.current;
    if (map === null || !mapReadyRef.current || appliedBasemapRef.current === basemap) return;
    const container = containerRef.current;
    applyBasemap(map, basemap, container);
    appliedBasemapRef.current = basemap;
  }, [basemap]);

  useEffect(() => {
    mapRef.current?.jumpTo({ center: [center.longitude, center.latitude], zoom });
  }, [center.latitude, center.longitude, zoom]);

  const tileSource = basemap === 'satellite'
    ? 'online-detail-with-local-satellite-fallback'
    : 'local-vector-pmtiles';
  return <div className="offline-vector-map" ref={containerRef} data-basemap={basemap} data-tile-source={tileSource} aria-hidden="true" />;
}
