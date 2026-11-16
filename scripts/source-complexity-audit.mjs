import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_LINE_LIMIT = 750;
const FUNCTION_LINE_LIMIT = 100;
const FUNCTION_COMPLEXITY_LIMIT = 15;

// ScriptKind numeric values are retained by the TypeScript compiler API even when its runtime bundle omits the enum object.
const SCRIPT_KIND = Object.freeze({ JS: 1, JSX: 2, TS: 3, TSX: 4 });
const SCRIPT_TARGET_LATEST = 99;
const SOURCE_ROOTS = ['src', 'app.ts', 'worker.js', 'state-store.js'];
const IGNORED_FILE = /(?:\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|\.d\.ts|\/i18n-ru\.ts)$/;

async function collectSourceFiles(entry) {
  const absolute = path.join(root, entry);
  let stat;
  try {
    stat = await (await import('node:fs/promises')).stat(absolute);
  } catch {
    return [];
  }
  if (stat.isFile()) return /\.[cm]?[jt]sx?$/.test(entry) && !IGNORED_FILE.test(entry) ? [entry] : [];

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

function functionName(node, sourceFile) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText(sourceFile);
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isMethodDeclaration(node)) return node.name.getText(sourceFile);
  return '<anonymous>';
}

function measureFunctionComplexity(node) {
  let complexity = 1;
  const visit = current => {
    if (current !== node && isFunctionLike(current)) return;
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isCatchClause(current) ||
      (ts.isCaseClause(current) && current.expression !== undefined)
    ) complexity += 1;

    if (ts.isBinaryExpression(current) && ['&&', '||', '??'].includes(current.operatorToken.getText())) {
      complexity += 1;
    }

    ts.forEachChild(current, visit);
  };
  visit(node);
  return complexity;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node);
}

async function main() {
  const files = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat().sort();
  const largeFiles = [];
  const complexFunctions = [];
  let totalLines = 0;

  for (const relativePath of files) {
    const content = await readFile(path.join(root, relativePath), 'utf8');
    const extension = path.extname(relativePath).toLowerCase();
    const scriptKind = extension === '.tsx' ? SCRIPT_KIND.TSX
      : extension === '.jsx' ? SCRIPT_KIND.JSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs' ? SCRIPT_KIND.JS
          : SCRIPT_KIND.TS;
    const sourceFile = ts.createSourceFile(relativePath, content, SCRIPT_TARGET_LATEST, true, scriptKind);
    const lineCount = sourceFile.getLineAndCharacterOfPosition(content.length).line + 1;
    totalLines += lineCount;
    if (lineCount > FILE_LINE_LIMIT) largeFiles.push({ file: relativePath, lines: lineCount });

    const visit = node => {
      if (isFunctionLike(node) && node.body) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
        const lines = end - start + 1;
        const complexity = measureFunctionComplexity(node);
        if (lines > FUNCTION_LINE_LIMIT || complexity >= FUNCTION_COMPLEXITY_LIMIT) {
          complexFunctions.push({
            file: relativePath,
            name: functionName(node, sourceFile),
            startLine: start,
            lines,
            complexity
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  console.log('Portfolio Terminal source complexity report');
  console.log('Informational baseline only; this command does not block on existing hotspots.');
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
    console.log(`\nFunctions over ${FUNCTION_LINE_LIMIT} lines or complexity ${FUNCTION_COMPLEXITY_LIMIT}+ (${complexFunctions.length}):`);
    for (const item of complexFunctions.sort((a, b) =>
      b.complexity - a.complexity || b.lines - a.lines
    ).slice(0, 40)) {
      console.log(`  ${String(item.complexity).padStart(3)} complexity / ${String(item.lines).padStart(4)} lines  ${item.file}:${item.startLine}  ${item.name}`);
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
