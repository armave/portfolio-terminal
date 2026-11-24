import { describe, expect, it } from 'vitest';
import { classifyChangedFiles } from './ci-change-classifier.mjs';

describe('CI changed-file classification', () => {
  it('skips application checks only when every changed file is documentation', () => {
    expect(classifyChangedFiles([
      'README.md', 'docs/README.md', 'docs/reliability-release-gates.md'
    ])).toMatchObject({
      classification: 'documentation-only', runQuality: false, runBrowser: false,
      runCodeql: false, runWorkflowSecurity: false
    });
  });
  it('runs CodeQL for root-level Worker and authentication test files', () => {
    expect(classifyChangedFiles(['worker.test.js'])).toMatchObject({
      classification: 'application', runQuality: true, runBrowser: true,
      runCodeql: true
    });
  });
  it('runs full application validation and CodeQL for financial-domain changes', () => {
    expect(classifyChangedFiles([
      'src/domain/portfolioTransactions.ts', 'src/domain/portfolioTransactions.test.ts'
    ])).toMatchObject({
      classification: 'application', runQuality: true, runBrowser: true,
      runCodeql: true, runWorkflowSecurity: false
    });
  });
  it('runs browser validation and dependency audits for lockfile changes', () => {
    expect(classifyChangedFiles(['package-lock.json'])).toMatchObject({
      classification: 'dependencies', runQuality: true, runBrowser: true,
      runCodeql: false, runWorkflowSecurity: false
    });
  });
  it('runs workflow validation and unit tests without rebuilding for workflow-only changes', () => {
    expect(classifyChangedFiles([
      '.github/workflows/financial-regression.yml', 'docs/reliability-release-gates.md'
    ])).toMatchObject({
      classification: 'workflow-only', runQuality: true, runBrowser: false,
      runCodeql: false, runWorkflowSecurity: true
    });
  });
  it('runs production build and browser validation when the primary CI workflow changes', () => {
    expect(classifyChangedFiles(['.github/workflows/ci.yml'])).toMatchObject({
      classification: 'workflow-only',
      runQuality: true,
      runBrowser: true,
      runCodeql: false,
      runWorkflowSecurity: true
    });
  });
  it('keeps CI tooling changes under workflow lint, CodeQL and unit tests', () => {
    expect(classifyChangedFiles(['scripts/ci-change-detection.mjs'])).toMatchObject({
      classification: 'workflow-only', runQuality: true, runBrowser: false,
      runCodeql: true, runWorkflowSecurity: true
    });
  });
  it('defaults to the complete suite for unrecognized paths', () => {
    expect(classifyChangedFiles(['.editorconfig'])).toMatchObject({
      classification: 'conservative-full', runQuality: true, runBrowser: true,
      runCodeql: true, runWorkflowSecurity: true
    });
  });
  it('defaults to the complete suite when metadata is missing or uncertain', () => {
    expect(classifyChangedFiles([])).toMatchObject({
      classification: 'conservative-full', runQuality: true, runBrowser: true,
      runCodeql: true, runWorkflowSecurity: true
    });
    expect(classifyChangedFiles(['README.md'], { forceFullValidation: true })).toMatchObject({
      classification: 'conservative-full', runQuality: true, runBrowser: true,
      runCodeql: true, runWorkflowSecurity: true
    });
  });
  it('normalizes duplicate and relative paths before classifying', () => {
    expect(classifyChangedFiles([
      './src/domain/portfolio.ts', 'src/domain/portfolio.ts'
    ])).toMatchObject({
      classification: 'application', changedFileCount: 1, runQuality: true, runBrowser: true
    });
  });
});
