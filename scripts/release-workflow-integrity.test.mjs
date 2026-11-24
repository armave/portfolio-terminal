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

  it('stages the exact validated Pages artifact before the separate deployment job', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml');
    const stageStart = workflow.indexOf('  pages-stage:');
    const deployStart = workflow.indexOf('  pages-deploy:');
    expect(stageStart).toBeGreaterThan(-1);
    expect(deployStart).toBeGreaterThan(stageStart);

    const stage = workflow.slice(stageStart, deployStart);
    const checkout = stage.indexOf('name: Check out exact source commit for release gates');
    const download = stage.indexOf('Download the production build artifact from this exact CI run');
    const gate = stage.indexOf('Require successful security validation for this exact main commit');
    const upload = stage.indexOf('Upload the validated Pages artifact for this workflow run');
    expect(checkout).toBeGreaterThan(-1);
    expect(checkout).toBeLessThan(download);
    expect(download).toBeLessThan(gate);
    expect(gate).toBeLessThan(upload);
    expect(stage).toContain('ref: ${{ github.sha }}');
    expect(stage).toContain('bash .github/scripts/require-main-push-security-success.sh');
    expect(stage).toContain('uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9');
    expect(stage).toContain('path: dist/');
    expect(stage).not.toContain('name: github-pages-');

    const deploy = workflow.slice(deployStart);
    expect(deploy).toContain('needs:\n      - pages-stage');
    expect(deploy).toContain('uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346');
    expect(deploy).not.toContain('artifact_name:');
  });

  it('keeps Worker deployment behind the same-commit security gate', () => {
    const worker = readRepoFile('.github/workflows/deploy-worker.yml');
    const workerGate = worker.indexOf('Require successful security validation for this exact main commit');
    const workerDeploy = worker.indexOf('Deploy Worker with pinned Wrangler');
    expect(workerGate).toBeGreaterThan(-1);
    expect(workerGate).toBeLessThan(workerDeploy);
    expect(worker).toContain('bash .github/scripts/require-main-push-security-success.sh');
    expect(worker).toContain('actions: read');
  });
});
