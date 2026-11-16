import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_LINE_LIMIT = 750;
const FUNCTION_LINE_LIMIT = 100;
const FUNCTION_MARKER_LIMIT = 15;
const SOURCE_ROOTS = ['src', 'app.ts', 'worker.js', 'state-store.js'];
const IGNORED_FILE = /(?:\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|\.d\.ts|\/i18n-ru\.ts)$/;

// This is a lexical advisory, not a compiler or a proof of dead code.
// Mask comments and literals before counting braces so most source formatting
// and inline strings do not distort function boundaries.
const NON_CODE_PATTERN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g;

async function collectSourceFiles(entry) {
  const absolute = path.join(root, entry);
  let entryStat;
  try {
    entryStat = await stat(absolute);
  } catch {
    return [];
  }

  if (entryStat.isFile()) {
    return /\.[cm]?[jt]sx?$/.test(entry) && !IGNORED_FILE.test(entry) ? [entry] : [];
  }

  const children = await readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(children
    .filter(child => child.isDirectory() && !['node_modules', 'dist', 'coverage', '.git'].includes(child.name))
    .map(child => collectSourceFiles(path.join(entry, child.name))));
  const files = children
    .filter(child => child.isFile() && /\.[cm]?[jt]sx?$/.test(child.name))
    .map(child => path.join(entry, child.name))
    .filter(file => !IGNORED_FILE.test(file));
  return files.concat(nested.flat());
}

function maskNonCode(source) {
  return source.replace(NON_CODE_PATTERN, value => value.replace(/[^\n]/g, ' '));
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findFunctionCandidates(source, maskedSource, relativePath) {
  const candidates = [];
  const patterns = [
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*(?::\s*[\w$<>\[\]|&?.,\s]+)?\s*\{/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g
  ];

  for (const pattern of patterns) {
    for (const match of maskedSource.matchAll(pattern)) {
      const matchIndex = match.index ?? 0;
      const openBrace = matchIndex + match[0].lastIndexOf('{');
      const closeBrace = findMatchingBrace(maskedSource, openBrace);
      if (closeBrace < 0) continue;

      const startLine = source.slice(0, matchIndex).split('\n').length;
      const lineCount = source.slice(matchIndex, closeBrace + 1).split('\n').length;
      const body = maskedSource.slice(openBrace, closeBrace + 1);
      const branchCount = (body.match(/\b(?:if|for|while|do|catch|case)\b/g) || []).length;
      const booleanCount = (body.match(/&&|\|\||\?\?/g) || []).length;
      const markerCount = 1 + branchCount + booleanCount;

      if (lineCount > FUNCTION_LINE_LIMIT || markerCount >= FUNCTION_MARKER_LIMIT) {
        candidates.push({
          file: relativePath,
          name: match[1] || '<anonymous>',
          startLine,
          lines: lineCount,
          markerCount
        });
      }
    }
  }
  return candidates;
}

async function main() {
  const files = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat().sort();
  const largeFiles = [];
  const complexFunctions = [];
  let totalLines = 0;

  for (const relativePath of files) {
    const content = await readFile(path.join(root, relativePath), 'utf8');
    const lineCount = content.split('\n').length;
    totalLines += lineCount;
    if (lineCount > FILE_LINE_LIMIT) largeFiles.push({ file: relativePath, lines: lineCount });

    const masked = maskNonCode(content);
    complexFunctions.push(...findFunctionCandidates(content, masked, relativePath));
  }

  console.log('Portfolio Terminal source complexity report');
  console.log('Informational lexical heuristic; this command does not block on existing hotspots or prove code is unused.');
  console.log(`Scanned ${files.length} source files / ${totalLines.toLocaleString('en-US')} lines.`);

  if (largeFiles.length) {
    console.log(`\nFiles over ${FILE_LINE_LIMIT} lines (${largeFiles.length}):`);
    for (const item of largeFiles.sort((a, b) => b.lines - a.lines)) {
      console.log(`  ${String(item.lines).padStart(5)}  ${item.file}`);
    }
  } else {
    console.log('\nNo files exceed the line-count advisory.');
  }

  const cssPath = path.join(root, 'style.css');
  const css = await readFile(cssPath, 'utf8');
  const repeatedSelectors = new Map();
  const selectorPattern = /(?:^|})\s*([^@{}][^{}]*)\s*\{/gm;
  for (const match of css.matchAll(selectorPattern)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector === 'from' || selector === 'to') continue;
    repeatedSelectors.set(selector, (repeatedSelectors.get(selector) ?? 0) + 1);
  }
  const duplicates = [...repeatedSelectors.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
  console.log(`\nRepeated CSS selectors in style.css (${duplicates.length} selector groups):`);
  for (const [selector, count] of duplicates.slice(0, 30)) {
    console.log(`  ${String(count).padStart(3)}  ${selector}`);
  }
  if (duplicates.length > 30) console.log(`  ... ${duplicates.length - 30} additional selector groups omitted`);

  if (complexFunctions.length) {
    console.log(`\nFunctions over ${FUNCTION_LINE_LIMIT} lines or control-flow marker count ${FUNCTION_MARKER_LIMIT}+ (${complexFunctions.length}):`);
    for (const item of complexFunctions.sort((a, b) =>
      b.markerCount - a.markerCount || b.lines - a.lines
    ).slice(0, 40)) {
      console.log(`  ${String(item.markerCount).padStart(3)} control-flow markers / ${String(item.lines).padStart(4)} lines  ${item.file}:${item.startLine}  ${item.name}`);
    }
    if (complexFunctions.length > 40) console.log(`  ... ${complexFunctions.length - 40} additional functions omitted`);
  } else {
    console.log('\nNo functions exceed the complexity advisory.');
  }
}

main().catch(error => {
  console.error('Source complexity audit failed:', error);
  process.exitCode = 1;
});
