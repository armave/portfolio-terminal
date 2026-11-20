# Settings information architecture and safety UX

## Scope

The Settings desk organizes preferences and administration without changing portfolio accounting, market-data adapters, broker synchronization, authentication policy, encrypted storage, or financial formulas. Existing server-side authorization remains authoritative; client-side visibility is presentation only.

## Information architecture

1. Account & Preferences — signed-in account identity and interface language.
2. Data & Synchronization — role-specific quote refresh preference, current cloud/assigned-data status, last confirmed synchronization time, and manual refresh.
3. Backup & Recovery — administrator-only JSON export/import and explicit cloud conflict recovery.
4. Access Management — administrator account and guest-projection management.
5. Portfolio Planning — application-side guardrails and new-position defaults.
6. Broker & Trading Model — financing/rollover, margin thresholds, and commission assumptions.
7. Diagnostics & Security — device health, app updates, and administrator-only advanced maintenance.
8. Methodology & Help — read-only explanations of calculations and data limitations.

The section navigation is sticky, responsive, role-aware, and marks the currently visible section. Keyboard focus remains visible and reduced-motion preferences are respected.

## Synchronization status semantics

- Cloud/assigned-data status and its last-confirmed timestamp are sourced from the existing cloud synchronization state store. A successful timestamp is retained across later failures.
- The quote interval selection controls market-quote refresh cadence and administrator workspace checkpoints; it is not a global timer for every source.
- Administrators: broker REST catch-up and history/cashflow refresh paths operate independently of the selected quote interval. Healthy TradeNet account streams deliver event-driven updates; REST account/execution/order snapshots remain fallback or recovery paths.
- Guests: assigned-stock quotes follow the selected interval; the server-scoped assigned holdings and LOTS projection refresh independently every 60 seconds.
- Manual-sync source rows report the outcome of the most recent manual request held in the current Settings component. They are not a live connectivity monitor and must not be interpreted as ongoing source health.

Keep the cadence text aligned with ROLE_SYNC_POLICY.md; update both this document and the policy only when scheduler behavior changes.

## Recovery and destructive actions

- Routine synchronization and manual refresh remain in Data & Synchronization.
- Backup export/import, explicit cloud replacement, and conflict recovery appear in Backup & Recovery.
- Pulling the latest shared cloud snapshot remains available from Backup & Recovery and continues to require explicit confirmation in the application runtime. The recovery UI instructs administrators to export before replacement and does not claim to merge financial records.
- Reset is isolated in a collapsed Danger zone. The existing runtime confirmation and requireAdmin boundary remain in place. Reset clears local and cloud portfolio/history state, not broker-held TradeNet records.
- Do not create a second cloud-pull action for the same event or provide a client-only shortcut around authorization.

## Financial settings presentation

Portfolio planning guardrails are visually grouped separately from new-position defaults. Broker assumptions are grouped into financing/rollover, margin-risk thresholds, and trading commissions. Existing input IDs, typed event payloads, normalization, validation, persistence scope, and saved-value semantics remain unchanged.

Copy must continue to distinguish application planning guardrails from broker-reported requirements. Existing position targets/classifications and accounting records remain authoritative.

## Validation expectations

- src/components/SettingsDesk.test.ts covers cadence wording, role-aware navigation, conflict recovery, unsaved user edits, and financial-settings grouping.
- src/ui/fluidWorkspaceStyles.test.ts covers responsive sticky navigation, status panels, and Settings layout styles.
- src/services/i18n.test.ts verifies the new English keys have Russian translations; the dictionary-wide parity test also checks non-empty values and interpolation placeholders.
- Browser validation should cover admin and guest Settings at desktop and mobile widths, sticky nav/anchor offsets, keyboard operation, manual sync partial failure, conflict recovery, role-change confirmation, backup import preview, and the existing reset confirmation.

No financial, broker, cloud-persistence, or Worker behavior is changed by this UX work.
