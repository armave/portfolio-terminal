import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

describe('Preact application runtime', () => {
  it('uses Preact as the only direct UI runtime and JSX import source', () => {
    const packageJson = JSON.parse(readSource('../../package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const directDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    const tsconfig = JSON.parse(readSource('../../tsconfig.json')) as {
      compilerOptions?: { jsx?: string; jsxImportSource?: string };
    };
    const viteConfig = readSource('../../vite.config.ts');

    expect(directDependencies).toHaveProperty('preact');
    expect(directDependencies).not.toHaveProperty('react');
    expect(directDependencies).not.toHaveProperty('react-dom');
    expect(directDependencies).not.toHaveProperty('@types/react');
    expect(tsconfig.compilerOptions).toMatchObject({
      jsx: 'react-jsx',
      jsxImportSource: 'preact'
    });
    expect(viteConfig).toContain("import preact from '@preact/preset-vite';");
  });

  it('mounts the application through one Preact root', () => {
    const main = readSource('../main.ts');

    expect(main).toContain("import { h, render } from 'preact';");
    expect(main.match(/\brender\s*\(/g)).toHaveLength(1);
    expect(main).not.toMatch(/from\s+['"]react(?:-dom(?:\/client)?)?['"]/);
  });
});
