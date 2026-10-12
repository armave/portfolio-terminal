// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
// @ts-ignore
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function findRootWithIndexHtml(startPath: string): string {
  let current = path.resolve(startPath);
  try {
    if (path.extname(startPath) || (fs.existsSync(current) && fs.statSync(current).isFile())) {
      current = path.dirname(current);
    }
    while (current) {
      if (fs.existsSync(path.join(current, 'index.html'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // Fall back to current directory
  }
  return path.resolve('.');
}

function normalizeRootPlugin(): Plugin {
  return {
    name: 'normalize-root-arg',
    config(config) {
      const rootDir = findRootWithIndexHtml(config.root || '.');
      config.root = rootDir;
      return {
        root: rootDir,
        build: {
          rollupOptions: {
            input: path.resolve(rootDir, 'index.html')
          }
        }
      };
    },
    configResolved(resolvedConfig) {
      const rootDir = findRootWithIndexHtml(resolvedConfig.root || '.');
      (resolvedConfig as any).root = rootDir;
      if (resolvedConfig.build?.rollupOptions) {
        resolvedConfig.build.rollupOptions.input = path.resolve(rootDir, 'index.html');
      }
    }
  };
}

export default defineConfig({
  base: '/portfolio-terminal/',
  appType: 'spa',
  plugins: [
    react(),
    normalizeRootPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Portfolio Terminal',
        short_name: 'PortfolioTerm',
        description: 'Personal stock portfolio tracker and margin scenario calculator',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/portfolio-terminal/',
        scope: '/portfolio-terminal/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true
      }
    })
  ],
  build: {
    target: 'es2022',
    emptyOutDir: true
  }
});
