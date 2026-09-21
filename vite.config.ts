import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  server: {
    watch: { ignored: ['**/.edge-check/**', '**/artifacts/**', '**/release/**'] },
    proxy: {
      '/map-tiles/osm': {
        target: 'https://tile.openstreetmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/map-tiles\/osm/u, '')
      },
      '/map-tiles/esri': {
        target: 'https://server.arcgisonline.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/map-tiles\/esri/u, '/ArcGIS/rest/services/World_Imagery/MapServer/tile')
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ХИМКОНТУР',
        short_name: 'ХИМКОНТУР',
        description: 'Автономная система расчета зон химического заражения',
        theme_color: '#08717e',
        background_color: '#f8f7f3',
        display: 'standalone',
        start_url: './',
        scope: './',
        orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,tsv,traineddata,pmtiles}'],
        // The autonomous Monchegorsk map is deliberately bundled as one
        // PMTiles archive. It must be precached for the installed PWA and the
        // Android WebView, otherwise the UI loads offline but the map does not.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*$/u,
            handler: 'CacheFirst',
            options: { cacheName: 'himkontur-osm-tiles', expiration: { maxEntries: 900, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [0, 200] } }
          },
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*$/u,
            handler: 'CacheFirst',
            options: { cacheName: 'himkontur-esri-tiles', expiration: { maxEntries: 700, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [0, 200] } }
          }
        ]
      }
    })
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
