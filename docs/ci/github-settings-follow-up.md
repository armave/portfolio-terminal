# GitHub repository settings — manual administrator steps

The GitHub connection used for this work can inspect repository rulesets but does not expose repository-administration writes. The committed workflow files therefore do not claim to have changed these settings.

## Observed repository configuration snapshot — 2026-11-17

Read-only inspection of the repository Rulesets API returned one active repository ruleset:

| Setting | Observed value |
|---|---|
| Ruleset | `main-protection` (active) |
| Target | `~DEFAULT_BRANCH` (currently `main`) |
| Rules | Deletion, non-fast-forward, pull-request, and update restrictions |
| Required approving reviews | `0` |
| Code-owner review | Disabled |
| Approval of most recent push | Disabled |
| Review-thread resolution | Not required |
| Required status checks | No required-status-check rule is configured |
| Bypass | A `RepositoryRole` actor (ID `5`) has `always` bypass; confirm the role mapping and intended exception in the live ruleset UI |

No repository ruleset targeting `refs/heads/dev` was returned. This is a repository-level ruleset snapshot, not proof that no organization-level rules or classic branch-protection settings apply. The classic branch-protection endpoint and environment-settings endpoint were not readable through this GitHub connection, so their state remains unverified.

**Implication:** the active `main-protection` ruleset does not currently enforce the quality/security checks described below, and it permits a repository-role bypass. Do not report #561 as complete until an administrator confirms the effective rules, adds the required checks/review policy, creates the `dev` ruleset, and verifies the `cloudflare-production` environment controls.

This PR records observed configuration only. It does not change repository settings or deployment permissions.

## Branch rulesets

Use **Settings → Rules → Rulesets**.

1. Edit the existing `main-protection` ruleset. Preserve deletion/non-fast-forward/PR rules, but add the required check contexts from `github-rulesets/main-protection.json`, including the **Coverage baseline and thresholds** job.
2. Configure a deliberate, minimal bypass policy. Review the currently observed `RepositoryRole` bypass actor and change it only with administrator approval.
3. Create and activate a `dev-protection` ruleset for `refs/heads/dev` using `github-rulesets/dev-protection.json`.
4. In the UI, select the exact status-check contexts GitHub reports. Depending on the UI, check names can be displayed with a workflow prefix; prefer the live check picker over blindly pasting a differently formatted context.
5. Do **not** make **Financial Integrity Regression** globally required. It is path-filtered and does not run for unrelated PRs, so a global requirement could leave unrelated PRs blocked waiting for a check that is intentionally absent.
6. Keep scheduled/manual-only audits out of required PR checks. They are not PR validation jobs.

The example JSON files are reference payloads. Review them against the live ruleset schema and current check names before importing.

## Cloudflare production environment

Use **Settings → Environments → cloudflare-production**:

- Restrict deployment branches to `main` only.
- Add the intended required reviewer(s) for production deployment approval.
- Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as environment secrets (not repository-wide secrets), with the minimum deployment permissions needed.
- Keep the Worker workflow's own `refs/heads/main` guard, Wrangler dry-run, and non-canceling deployment concurrency enabled.

Environment reviewers and branch restrictions are repository settings and cannot be activated by committed YAML alone.
