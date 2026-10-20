// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
// @ts-ignore
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import preact from '@preact/preset-vite';

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

function startupCriticalCssPlugin(): Plugin {
  return {
    name: 'startup-critical-css',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const rootDir = findRootWithIndexHtml('.');
        const cssPath = path.resolve(rootDir, 'startup-critical.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        const marker = '<!-- STARTUP_CRITICAL_CSS -->';
        if (!html.includes(marker)) {
          throw new Error('Missing STARTUP_CRITICAL_CSS marker in index.html');
        }
        return html.replace(marker, `<style id="startup-critical-styles">\\n${css}\\n</style>`);
      }
    }
  };
}

export default defineConfig({
  base: '/portfolio-terminal/',
  appType: 'spa',
  plugins: [
    preact(),
    normalizeRootPlugin(),
    startupCriticalCssPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['ico.svg'],
      manifest: {
        name: 'Portfolio Terminal',
        short_name: 'Portfolio',
        description: 'Personal stock portfolio tracker and margin scenario calculator',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/portfolio-terminal/',
        scope: '/portfolio-terminal/',
        icons: [
          {
            src: 'ico.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'ico.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
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
  server: {
    watch: {
      usePolling: true,
      interval: 100
    }
  },
  build: {
    target: 'es2022',
    emptyOutDir: true
  }
});
