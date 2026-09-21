import { useEffect, useMemo, useRef } from 'react';
import { Map as MapLibreMap, addProtocol, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, type Source } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoPoint } from '../core/types';

let protocolRegistered = false;
let offlineArchivePromise: Promise<PMTiles> | null = null;
setWorkerUrl(mapWorkerUrl);

function getOfflineArchive(): Promise<PMTiles> {
  if (offlineArchivePromise !== null) return offlineArchivePromise;
  const archiveUrl = new URL('map-data/monchegorsk-v5.pmtiles', document.baseURI).href;
  offlineArchivePromise = fetch(archiveUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Автономная карта не загружена: HTTP ${response.status}`);
    const archive = await response.arrayBuffer();
    const source: Source = {
      getKey: () => archiveUrl,
      getBytes: async (offset, length) => ({ data: archive.slice(offset, offset + length) }),
    };
    return new PMTiles(source);
  });
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

export function OfflineBasemap({ center, zoom }: Readonly<{ center: GeoPoint; zoom: number }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const initialViewRef = useRef({ center, zoom });
  const style = useMemo<StyleSpecification>(() => ({
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
    // Deliberately self-contained: no glyphs, sprites, fonts or network URLs.
    // The compact style also remains compatible with every PMTiles build used
    // by the desktop, PWA and Android packages.
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
  }), []);

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
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.on('load', () => { container.dataset.mapReady = 'true'; container.dataset.mapStatus = 'loaded'; });
    map.on('styledata', () => { container.dataset.styleEvent = 'true'; });
    map.on('idle', () => { container.dataset.mapIdle = 'true'; container.dataset.mapStatus = 'idle'; });
    map.on('sourcedata', (event) => {
      if (event.isSourceLoaded) container.dataset.sourceReady = 'true';
    });
    map.on('error', (event) => {
      container.dataset.mapError = event.error.message;
      container.dataset.mapStatus = 'error';
    });
    map.setStyle(style);
    const auditTimer = window.setInterval(() => {
      container.dataset.styleLoaded = String(map.isStyleLoaded());
      container.dataset.mapZoom = map.getZoom().toFixed(2);
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
  }, [style]);

  useEffect(() => {
    mapRef.current?.jumpTo({ center: [center.longitude, center.latitude], zoom });
  }, [center.latitude, center.longitude, zoom]);

  return <div className="offline-vector-map" ref={containerRef} aria-hidden="true" />;
}
