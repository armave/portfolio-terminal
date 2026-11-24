const DOCUMENTATION_ROOTS = ['docs/'];
const DOCUMENTATION_FILES = new Set(['README.md', 'CONVENTIONS.md']);
const DEPENDENCY_FILES = new Set([
  'package.json', 'package-lock.json', '.nvmrc', '.npmrc', '.github/dependabot.yml'
]);
const ROOT_APPLICATION_FILES = new Set([
  'app.ts', 'worker.js', 'state-store.js', 'style.css', 'startup-critical.css',
  'index.html', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json',
  'wrangler.jsonc', 'postcss.config.js', 'tailwind.config.js', 'knip.json',
  '.oxlintrc.json'
]);
const CI_INFRASTRUCTURE_FILES = new Set([
  'scripts/ci-local.mjs',
  'scripts/ci-change-detection.mjs',
  'scripts/ci-change-classifier.mjs',
  'scripts/ci-change-classifier.test.mjs',
  'scripts/release-workflow-integrity.test.mjs'
]);

function isDocumentationPath(path) {
  if (path.startsWith('.github/')) return false;
  return DOCUMENTATION_FILES.has(path) ||
    DOCUMENTATION_ROOTS.some(root => path.startsWith(root)) ||
    /\.(?:md|mdx)$/i.test(path);
}
function isWorkflowPath(path) {
  return path.startsWith('.github/workflows/') ||
    path.startsWith('.github/scripts/') ||
    CI_INFRASTRUCTURE_FILES.has(path);
}
function isDependencyPath(path) {
  return DEPENDENCY_FILES.has(path);
}
function isKnownApplicationPath(path) {
  return path.startsWith('src/') || path.startsWith('public/') ||
    path.startsWith('vendor/') || ROOT_APPLICATION_FILES.has(path) ||
    /\.(?:[cm]?[jt]sx?|css|html|jsonc?)$/i.test(path);
}
function isCodePath(path) {
  return /\.(?:[cm]?[jt]sx?)$/i.test(path);
}

/** Unknown paths and incomplete change sets always request full validation. */
export function classifyChangedFiles(input, { forceFullValidation = false } = {}) {
  const files = [...new Set(
    (Array.isArray(input) ? input : [])
      .filter(path => typeof path === 'string')
      .map(path => path.replaceAll('\\', '/').replace(/^\.\//, '').trim())
      .filter(Boolean)
  )].sort();

  if (forceFullValidation || files.length === 0) {
    return {
      classification: 'conservative-full',
      reason: forceFullValidation ? 'Change metadata unavailable or full validation requested' : 'No changed files were identified',
      changedFileCount: files.length,
      runQuality: true, runBrowser: true, runCodeql: true, runWorkflowSecurity: true
    };
  }

  const documentationFiles = files.filter(isDocumentationPath);
  const workflowFiles = files.filter(isWorkflowPath);
  const dependencyFiles = files.filter(isDependencyPath);
  const applicationFiles = files.filter(path =>
    !isDocumentationPath(path) && !isWorkflowPath(path) &&
    !isDependencyPath(path) && isKnownApplicationPath(path)
  );
  const recognized = new Set([
    ...documentationFiles, ...workflowFiles, ...dependencyFiles, ...applicationFiles
  ]);
  const unknownFiles = files.filter(path => !recognized.has(path));
  const docsOnly = documentationFiles.length === files.length;
  const workflowOnly = !docsOnly && workflowFiles.length > 0 &&
    workflowFiles.length + documentationFiles.length === files.length;

  if (unknownFiles.length > 0) {
    return {
      classification: 'conservative-full',
      reason: 'Unclassified paths require the complete validation suite',
      changedFileCount: files.length,
      runQuality: true, runBrowser: true, runCodeql: true, runWorkflowSecurity: true
    };
  }
  if (docsOnly) {
    return {
      classification: 'documentation-only',
      reason: 'Only documentation files changed',
      changedFileCount: files.length,
      runQuality: false, runBrowser: false, runCodeql: false, runWorkflowSecurity: false
    };
  }
  if (workflowOnly) {
    return {
      classification: 'workflow-only',
      reason: 'Workflow or CI infrastructure changed without application or dependency changes',
      changedFileCount: files.length,
      runQuality: true,
      // The primary CI entry workflow must validate its own build/artifact/browser graph.
      runBrowser: files.includes('.github/workflows/ci.yml'),
      runCodeql: files.some(isCodePath),
      runWorkflowSecurity: true
    };
  }

  const codeChanges = files.some(isCodePath);
  const classification = applicationFiles.length > 0 && dependencyFiles.length > 0
    ? 'application-and-dependencies'
    : applicationFiles.length > 0 ? 'application' : 'dependencies';
  return {
    classification,
    reason: 'Application or dependency changes require full application validation',
    changedFileCount: files.length,
    runQuality: true, runBrowser: true,
    runCodeql: codeChanges, runWorkflowSecurity: workflowFiles.length > 0
  };
}
