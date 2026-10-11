import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import { compile } from 'tailwindcss';

function collectCandidates(dir, candidates) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectCandidates(fullPath, candidates);
      } else if (/\.(html|js|ts|jsx|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const classAttrRegex = /(?:class|className)\s*=\s*["'`]([^"'`]+)["'`]/g;
        let match;
        while ((match = classAttrRegex.exec(content)) !== null) {
          const classNames = match[1].split(/\s+/);
          for (const name of classNames) {
            if (name) candidates.add(name);
          }
        }
        const tokens = content.match(/[!a-zA-Z0-9_\-\/\[\]\:\#\.\%]+/g);
        if (tokens) {
          for (let token of tokens) {
            token = token.replace(/^[.:,]+|[.:,]+$/g, '');
            if (token) candidates.add(token);
          }
        }
      }
    }
  } catch {
    // Ignore unreadable paths
  }
}

function tailwindV4Plugin() {
  return {
    postcssPlugin: 'tailwindcss-v4-inline',
    async Once(root, { result }) {
      const from = result.opts.from || path.resolve('style.css');
      const base = path.dirname(from);
      const css = root.toString();

      const compiler = await compile(css, {
        base,
        onDependency(dep) {
          result.messages.push({
            type: 'dependency',
            plugin: 'tailwindcss',
            file: dep,
            parent: from,
          });
        },
      });

      const candidates = new Set();
      collectCandidates(process.cwd(), candidates);

      const compiled = compiler.build(Array.from(candidates));
      const parsed = postcss.parse(compiled, { from });
      root.removeAll();
      root.append(parsed.nodes);
    },
  };
}
tailwindV4Plugin.postcss = true;

export default {
  plugins: [
    tailwindV4Plugin(),
    autoprefixer(),
  ],
};
