import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_LINE_LIMIT = 750;
const FUNCTION_LINE_LIMIT = 100;
const FUNCTION_COMPLEXITY_LIMIT = 15;
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

    if (ts.isBinaryExpression(current) && (
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    )) complexity += 1;

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
    const scriptKind = extension === '.tsx' ? ts.ScriptKind.TSX
      : extension === '.jsx' ? ts.ScriptKind.JSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs' ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, scriptKind);
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
