/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from the domain root locally; GitHub Pages serves a project site under
// /<repo>/, so the Pages workflow sets BASE_PATH=/hot-proxies/ at build time.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['names.json', 'icons/*.png'],
      manifest: {
        name: 'Hot Proxies', short_name: 'Hot Proxies', description: 'Black-and-white MTG proxies for thermal printers',
        theme_color: '#0a1625', background_color: '#f5f3e8', display: 'standalone', start_url: base, scope: base,
        icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ttf,json,png,svg}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
