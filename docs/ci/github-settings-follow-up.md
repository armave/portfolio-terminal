# GitHub repository settings — manual administrator steps

The GitHub connection used for this work can inspect rulesets but does not expose repository-administration writes. The committed workflow files therefore do not claim to have changed these settings.

## Branch rulesets

Use **Settings → Rules → Rulesets**.

1. Edit the existing `main-protection` ruleset. Preserve its active state and deletion/non-fast-forward/PR rules. Add the required check contexts from `github-rulesets/main-protection.json`, including the new **Coverage baseline and thresholds** job.
2. Create and activate a `dev-protection` ruleset for `refs/heads/dev` using `github-rulesets/dev-protection.json`.
3. In the UI, select the exact status-check contexts GitHub reports. Depending on the UI, check names can be displayed with a workflow prefix; prefer the live check picker over blindly pasting a differently formatted context.
4. Do **not** make **Financial Integrity Regression** globally required. It is path-filtered and does not run for unrelated PRs, so a global requirement could leave unrelated PRs blocked waiting for a check that is intentionally absent.
5. Keep scheduled/manual-only audits out of required PR checks. They are not PR validation jobs.

The example JSON files are reference payloads. Review them against the live ruleset schema and current check names before importing.

## Cloudflare production environment

Use **Settings → Environments → cloudflare-production**:

- Restrict deployment branches to `main` only.
- Add the intended required reviewer(s) for production deployment approval.
- Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as environment secrets (not repository-wide secrets), with the minimum deployment permissions needed.
- Keep the Worker workflow's own `refs/heads/main` guard, Wrangler dry-run, and non-canceling deployment concurrency enabled.

Environment reviewers and branch restrictions are repository settings and cannot be activated by committed YAML alone.
