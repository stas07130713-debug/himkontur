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
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json,tsv,traineddata}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 }
    })
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
