## Summary

Describe the user-visible or operational outcome and why this change is needed.

## Workstream

- Issue: #
- Parent roadmap: [Portfolio Terminal product roadmap](https://github.com/armave/portfolio-terminal/pull/347)
- Change type: [ ] frontend/client [ ] financial/domain [ ] Worker/server [ ] docs/CI [ ] dependencies

## Scope and impact

- [ ] Files changed are limited to the assigned workstream.
- [ ] Financial calculation or persisted-data behavior is unchanged.
- [ ] If financial behavior changes, formulas, precision, migration, backup compatibility, and independent reference fixtures are documented.
- [ ] If API/Worker behavior changes, request validation, authorization, compatibility, and deployment path are documented.
- [ ] No secrets, credentials, raw broker payloads, or private portfolio data are included in logs, fixtures, screenshots, or artifacts.

## Validation

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run validate:dead-code`
- [ ] `npm run audit:dependencies`
- [ ] `npm run audit:production`
- [ ] Relevant browser smoke / E2E workflow
- [ ] Relevant Worker / authorization tests

**Exact tested commit SHA:**

**CI workflow run(s):**

**Checks not run and reason:**

## Localization and accessibility

- [ ] English strings updated where needed.
- [ ] Russian strings updated where needed.
- [ ] Translation parity tests pass.
- [ ] Keyboard navigation, accessible names, focus behavior, and responsive layouts reviewed where UI changed.
- [ ] No user-facing changes; localization/accessibility are not applicable.

## Manual release checks

- [ ] Authenticated TradeNet check completed when broker/account paths changed.
- [ ] Real Market Depth open/reconnect/no-data/close check completed when depth/stream paths changed.
- [ ] Backup/import/recovery check completed when persistence or schema paths changed.
- [ ] Responsive/accessibility browser journey completed when UI behavior changed.
- [ ] Production/Worker deployment check completed when applicable.
- [ ] Manual checks are not applicable to this change (explain why below).

**Manual verification evidence / limitations:**

## Risk and rollback

- Known limitations or follow-up issues:
- Rollback or recovery considerations:
- Related PRs / paired Worker deployments:

## Completion checklist

- [ ] The PR links to its issue and parent roadmap.
- [ ] The issue/roadmap progress is updated with this PR and the validated commit.
- [ ] All required checks refer to the final candidate commit.
- [ ] I have not represented mocked browser tests as live broker or production verification.
