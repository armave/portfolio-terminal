import { appendFileSync, readFileSync } from 'node:fs';
import { classifyChangedFiles } from './ci-change-classifier.mjs';

const eventName = process.env.GITHUB_EVENT_NAME || '';
const eventPath = process.env.GITHUB_EVENT_PATH;
const repository = process.env.GITHUB_REPOSITORY;
const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const token = process.env.GITHUB_TOKEN;
const outputPath = process.env.GITHUB_OUTPUT;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (!eventPath || !outputPath || !repository) {
  throw new Error('GitHub Actions event, repository, and output context are required.');
}
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
let files = [];
let forceFullValidation = false;
let reason = '';

async function pullRequestFiles() {
  const pullNumber = event.pull_request?.number;
  const expectedCount = event.pull_request?.changed_files;
  if (!Number.isInteger(pullNumber) || !Number.isInteger(expectedCount) ||
      expectedCount < 1 || expectedCount > 300 || !token) {
    throw new Error('Pull request change metadata is incomplete or exceeds the safe pagination limit.');
  }
  const result = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await fetch(
      `${apiUrl}/repos/${repository}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (!response.ok) throw new Error(`GitHub changed-file API returned HTTP ${response.status}.`);
    const pageFiles = await response.json();
    if (!Array.isArray(pageFiles)) throw new Error('GitHub returned an invalid pull request file list.');
    result.push(...pageFiles.map(file => file.filename).filter(name => typeof name === 'string'));
    if (pageFiles.length < 100) break;
  }
  if (result.length !== expectedCount) {
    throw new Error('The changed-file list was incomplete; full validation is required.');
  }
  return result;
}

try {
  if (eventName === 'pull_request') {
    files = await pullRequestFiles();
    reason = 'Complete pull request file list retrieved from GitHub';
  } else if (eventName === 'push') {
    const before = event.before;
    const commits = event.commits;
    const expectedCommits = event.size;
    if (typeof before !== 'string' || /^0+$/.test(before) ||
        !Array.isArray(commits) || commits.length === 0 ||
        !Number.isInteger(expectedCommits) || commits.length !== expectedCommits) {
      throw new Error('Push metadata is incomplete; full validation is required.');
    }
    files = commits.flatMap(commit => [
      ...(Array.isArray(commit.added) ? commit.added : []),
      ...(Array.isArray(commit.modified) ? commit.modified : []),
      ...(Array.isArray(commit.removed) ? commit.removed : [])
    ]);
    if (files.length === 0) throw new Error('No changed paths were present in the push payload.');
    reason = 'Complete changed-path metadata retrieved from the push event';
  } else {
    forceFullValidation = true;
    reason = 'Manual, scheduled, or unsupported event; run the complete validation suite';
  }
} catch (error) {
  forceFullValidation = true;
  reason = error instanceof Error
    ? `Change detection fallback: ${error.message}`
    : 'Change detection fallback: incomplete change metadata';
}

const result = classifyChangedFiles(files, { forceFullValidation });
if (forceFullValidation) result.reason = reason || result.reason;
const outputs = {
  classification: result.classification,
  reason: result.reason.replace(/[\r\n]/g, ' '),
  changed_file_count: String(result.changedFileCount),
  run_quality: String(result.runQuality),
  run_browser: String(result.runBrowser),
  run_codeql: String(result.runCodeql),
  run_workflow_security: String(result.runWorkflowSecurity)
};
appendFileSync(outputPath, Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');

const summary = [
  '## CI change classification', '',
  '| Field | Value |', '|---|---|',
  `| Classification | ${outputs.classification} |`,
  `| Changed files | ${outputs.changed_file_count} |`,
  `| Reason | ${outputs.reason} |`,
  `| Quality and full Vitest suite | ${outputs.run_quality} |`,
  `| Production build and browser journeys | ${outputs.run_browser} |`,
  `| CodeQL | ${outputs.run_codeql} |`,
  `| Workflow lint and zizmor | ${outputs.run_workflow_security} |`,
  '| New-commit secret scan | always on PR/push |'
].join('\n') + '\n';
if (summaryPath) appendFileSync(summaryPath, summary);
console.log(summary);
