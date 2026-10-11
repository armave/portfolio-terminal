import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function normalizeRootPlugin(): Plugin {
  return {
    name: 'normalize-root-arg',
    config(config) {
      if (config.root) {
        try {
          const resolved = path.resolve(config.root);
          if (path.extname(config.root) || (fs.existsSync(resolved) && fs.statSync(resolved).isFile())) {
            return {
              root: path.dirname(resolved)
            };
          }
        } catch {
          // Fall back to default config if stat fails
        }
      }
    }
  };
}

export default defineConfig({
  base: '/portfolio-terminal/',
  appType: 'spa',
  plugins: [normalizeRootPlugin()],
  build: {
    target: 'es2022'
  }
});
