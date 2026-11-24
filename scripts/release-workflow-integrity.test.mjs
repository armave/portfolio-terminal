import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRepoFile = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

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

    const pagesJob = pages.slice(pages.indexOf('  pages-deploy:'));
    const pagesCheckout = pagesJob.indexOf('name: Check out exact source commit for release gates');
    const pagesDownload = pagesJob.indexOf('Download the production build artifact from this exact CI run');
    const pagesSecurityGate = pagesJob.indexOf('Require successful security validation for this exact main commit');
    expect(pagesCheckout).toBeGreaterThan(-1);
    expect(pagesCheckout).toBeLessThan(pagesDownload);
    expect(pagesDownload).toBeLessThan(pagesSecurityGate);
    expect(pagesJob.slice(pagesCheckout, pagesDownload)).toContain('ref: ${{ github.sha }}');

    const worker = readRepoFile('.github/workflows/deploy-worker.yml');
    const workerGate = worker.indexOf('Require successful security validation for this exact main commit');
    const workerDeploy = worker.indexOf('Deploy Worker with pinned Wrangler');
    expect(workerGate).toBeGreaterThan(-1);
    expect(workerGate).toBeLessThan(workerDeploy);
    expect(worker).toContain('bash .github/scripts/require-main-push-security-success.sh');
    expect(worker).toContain('actions: read');
  });
});
