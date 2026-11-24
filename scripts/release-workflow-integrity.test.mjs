import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRepoFile = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('change-aware CI execution', () => {
  it('keeps documentation-only changes away from application jobs but retains secret scanning', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');
    const security = readRepoFile('.github/workflows/security.yml');
    expect(ci).toContain("needs.detect-changes.outputs.run_quality == 'true'");
    expect(ci).toContain("needs.detect-changes.outputs.run_browser == 'true'");
    expect(security).toContain('name: New-commit secret scan');
    expect(security).toContain("if: ${{ github.event_name == 'pull_request' || github.event_name == 'push' }}");
  });

  it('keeps financial regression automatically covered by the single full Vitest run', () => {
    const financial = readRepoFile('.github/workflows/financial-regression.yml');
    const local = readRepoFile('scripts/ci-local.mjs');
    expect(financial).toContain('workflow_dispatch:');
    expect(financial).not.toContain('pull_request:');
    expect(financial).not.toContain('push:');
    expect(local).toContain("npm('run', 'test:coverage')");
    expect(local).not.toContain("npm('test')");
  });

  it('defaults change detection to full validation and preserves release deployment gates', () => {
    const classifier = readRepoFile('scripts/ci-change-classifier.mjs');
    const detector = readRepoFile('scripts/ci-change-detection.mjs');
    expect(classifier).toContain("classification: 'conservative-full'");
    expect(classifier).toContain('runBrowser: true');
    expect(detector).toContain('forceFullValidation = true');
    expect(detector).toContain('result.length !== expectedCount');
  });
});

describe('production deployment security gates', () => {
  it('accepts only a successful security workflow run for the exact main push commit', () => {
    const script = readRepoFile('.github/scripts/require-main-push-security-success.sh');
    expect(script).toContain('.head_sha == $sha');
    expect(script).toContain('.head_branch == "main"');
    expect(script).toContain('.head_repository.full_name == $repository');
    expect(script).toContain('.event == "push"');
    expect(script).toContain('.conclusion');
    expect(script).toContain('"success"');
    expect(script).toContain('within 15 minutes');
  });

  it('places the same-commit security gate before Pages and Worker production writes', () => {
    const pages = readRepoFile('.github/workflows/ci.yml');
    const pagesGate = pages.indexOf('Require successful security validation for this exact main commit');
    const pagesPublish = pages.indexOf('Upload the exact validated Pages artifact');
    expect(pagesGate).toBeGreaterThan(-1);
    expect(pagesGate).toBeLessThan(pagesPublish);
    expect(pages).toContain('bash .github/scripts/require-main-push-security-success.sh');
    expect(pages).toContain('actions: read');

    const worker = readRepoFile('.github/workflows/deploy-worker.yml');
    const workerGate = worker.indexOf('Require successful security validation for this exact main commit');
    const workerDeploy = worker.indexOf('Deploy Worker with pinned Wrangler');
    expect(workerGate).toBeGreaterThan(-1);
    expect(workerGate).toBeLessThan(workerDeploy);
    expect(worker).toContain('bash .github/scripts/require-main-push-security-success.sh');
    expect(worker).toContain('actions: read');
  });
});
