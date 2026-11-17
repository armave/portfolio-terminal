import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const vendorV2 = resolve(root, 'vendor/picomatch-v2');
const vendorV4 = resolve(root, 'vendor/picomatch-v4');
const requireV2 = createRequire(resolve(vendorV2, 'package.json'));
const requireV4 = createRequire(resolve(vendorV4, 'package.json'));
const picomatch2 = requireV2('./index.js');
const picomatch4 = requireV4('./index.js');

const dependencyRequire = (relativePackagePath: string) =>
  createRequire(resolve(root, relativePackagePath, 'package.json'));

describe('patched picomatch dependency resolution', () => {
  it('routes current v4 tooling to the source-attributed v4 backport', () => {
    for (const parent of [
      'node_modules/vite',
      'node_modules/vitest',
      'node_modules/tinyglobby',
      'node_modules/@rollup/pluginutils'
    ]) {
      const resolved = dependencyRequire(parent).resolve('picomatch');
      expect(realpathSync(resolved)).toBe(realpathSync(resolve(vendorV4, 'index.js')));
    }
  });

  it('routes the legacy Prefresh pluginutils copy to the source-attributed v2 backport', () => {
    const resolved = dependencyRequire(
      'node_modules/@prefresh/vite/node_modules/@rollup/pluginutils'
    ).resolve('picomatch');
    expect(realpathSync(resolved)).toBe(realpathSync(resolve(vendorV2, 'index.js')));
  });
});

describe('single-branch repeated-extglob ReDoS regressions', () => {
  const candidates = [
    ['v2', picomatch2, vendorV2],
    ['v4', picomatch4, vendorV4]
  ] as const;

  for (const [major, matcher, vendorDir] of candidates) {
    it(`keeps ${major} repeated-star extglobs from compiling nested unbounded quantifiers`, () => {
      const patterns = ['+(*)', '+(*a)', '*(*a)', '+(a*)', '+(a*b)', '*(*.js)'];
      for (const pattern of patterns) {
        const source = matcher.makeRe(pattern).source;
        expect(source.includes(')+') || source.includes(')*'), pattern).toBe(false);
      }
    });

    it(`bounds malicious non-matching inputs in an isolated ${major} process`, () => {
      const entry = resolve(vendorDir, 'index.js');
      const code = [
        "const assert = require('node:assert/strict');",
        `const matcher = require(${JSON.stringify(entry)});`,
        "const input = 'a'.repeat(50) + 'b';",
        "for (const pattern of ['+(*a)', '*(*a)', '+(*a)c', 'x+(*a)']) {",
        "  assert.equal(matcher.isMatch(input, pattern), false, pattern);",
        "}"
      ].join('\\n');
      expect(() => execFileSync(process.execPath, ['-e', code], { timeout: 2500 })).not.toThrow();
    });

    it(`preserves common matching behavior and uses safe capture fallback in ${major}`, () => {
      expect(matcher.isMatch('abc', '+(*)')).toBe(true);
      expect(matcher.isMatch('aaa', '+(*a)')).toBe(true);
      expect(matcher.isMatch('a.a', '+(*a)')).toBe(true);
      expect(matcher.isMatch('ab', '+(*a)')).toBe(false);
      expect(matcher.isMatch('axbayb', '+(a*b)')).toBe(true);
      expect(matcher.isMatch('foo.js', '*(*.js)')).toBe(true);
      expect(matcher.isMatch('foo.ts', '*(*.js)')).toBe(false);

      const literalFallback = matcher.makeRe('+(*a)', { capture: true });
      expect(literalFallback.exec('+(*a)')).not.toBeNull();
      expect(matcher.isMatch('aaa', '+(*a)', { capture: true })).toBe(false);
    });
  }
});
