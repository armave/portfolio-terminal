# PR 4 — Quality follow-up: lifecycle, accessibility, responsive UX, and repository audit

**Base:** `main` at `7629584a2049d8789078ae16b2d7d411f943c6ee`  
**Branch:** `refine/quality-followups-2026-11-04`  
**Scope:** one frontend/client PR following merged PRs #303, #304, and #305.

## Implementation checklist

- [x] Bind Closed History fee-allocation recalculation to both account-session validity and the owning effect lifetime.
- [x] Pass the composite lifetime guard into the cloud-history write queue so a disposed effect cannot start or complete a stale cloud write.
- [x] Extend the Closed History regression test to assert the side-effect guard as well as the final completion guard.
- [x] Add a deterministic News response to the production-browser smoke harness.
- [x] Exercise the News dialog in Chromium: accessible control names, initial focus, inert/aria-hidden background, Escape close, focus restoration, responsive bounds, and 44px action targets.
- [x] Exercise administrator Balance, Trades, Settings, and guest LOTS/Settings surfaces at 320, 360, 390, 768, 1024, and 1440 CSS pixels.
- [x] Raise Market Insights news/action controls to 44px minimum height and add visible keyboard focus treatment to News dialog actions.
- [x] Add Russian coverage for News dialog labels, external article links, dynamic accessible article headlines, and the untitled-article fallback.
- [x] Keep all financial formulas, persisted formats, account roles, API transports, cloud revision/encryption protocols, and Worker routes unchanged.
- [x] Exact-head GitHub CI — [run 41780619794](https://github.com/armave/portfolio-terminal/actions/runs/41780619794) passed on `e0a6e9cc16751475e321689bfae730891cff5015`.

## Lifecycle correction

Before this follow-up, the Closed History fee-allocation effect only checked its local `active` flag in the promise completion handler. The asynchronous processing function could still proceed to local history persistence and enqueue a cloud-history update after the effect that launched it had been disposed.

The processing operation now receives an `isOperationActive` predicate. It combines that predicate with the account-session guard and checks it before calculations are committed, before persistence, during error handling, and at the serialized cloud-history write boundary. The manual cashflow-refresh path retains its prior behavior by using the default active predicate.

## Accessibility and responsive verification

The browser smoke suite now checks real mounted surfaces instead of treating initial app mount as comprehensive responsive validation. It checks the active administrator and guest surfaces at narrow phone, phone, tablet, and desktop widths; opens the News dialog using a deterministic mocked provider response; verifies focus containment and restoration; checks the application root is isolated from assistive technology while the dialog is open; and verifies action touch dimensions.

The UI changes are limited to the Market Insights controls and News dialog. Existing shared focus management, lazy loading, reduced-motion policy, and styling architecture are retained.

## Localization

All static News dialog/control labels were already present in the Russian dictionary. This PR adds regression assertions for those entries and a dynamic translation rule for the article button's accessible name. Provider-supplied headlines remain unchanged inside the translated label.

## Audit notes and explicitly deferred work

- **Best-effort localStorage rollback:** browsers do not provide a native multi-key localStorage transaction. A stronger single-record or IndexedDB design requires a separately planned schema/migration and recovery strategy. This PR does not change persistence format or claim atomic storage guarantees.
- **Cloudflare Worker:** the current Worker boundary was reviewed for CORS/method/body checks, route-qualified auth edge rate limiting, trusted Cloudflare client IP handling, role enforcement, one-use WebSocket tickets, request/response sanitization, Durable Object revision checks, and associated auth/Worker tests. No concrete Worker source defect was established in this scoped pass, so no Worker source or Wrangler configuration is included in this frontend PR. The dedicated Worker deployment workflow remains separate and was not triggered by these changes; this is not a live account/binding/deployment certification.
- **Dependency advisories:** the full development tree still reports four low-severity advisories in the `deepmerge` chain at the repository's high-severity audit threshold; the production-only audit reports zero. No forced breaking Vite PWA downgrade is introduced.
- **Branch hygiene:** the repository exposed 152 remote branches during the audit, many with unique unmerged commits. No branch is deleted as part of this code PR. Retirement requires a separate compare/backup/review of each topic branch against `main`; blanket deletion would risk losing unreconciled work.
- **Full manual accessibility certification:** automated browser checks now cover the active high-use paths listed above. Screen-reader certification, physical-device touch testing, and a complete desk-by-desk manual review remain human review items and are not claimed as completed by CI.

## Validation

Exact-head GitHub Actions: [Pull Request CI run 41780619794](https://github.com/armave/portfolio-terminal/actions/runs/41780619794) — **success** on `e0a6e9cc16751475e321689bfae730891cff5015`.

- [x] Dependency installation and TypeScript typecheck.
- [x] Full Vitest suite — **117 test files / 1,396 tests passed**.
- [x] Production build and entry-bundle budget — **435,460 / 500,000 bytes raw; 134,795 / 165,000 bytes gzip**.
- [x] Chromium production-browser smoke — responsive admin/guest desks, actual News dialog interaction, accessible names, focus/background isolation and restoration, 44px dialog actions, broker partial failure, cloud revision conflict, backup export/import/reset, guest assignment publication, account switching, and guest-only workspace hydration.
- [x] Dead-code validation.
- [x] Full dependency audit at the configured high-severity threshold. It exits successfully with **four low-severity development-tree advisories** in the `deepmerge` dependency chain.
- [x] Production dependency audit — **zero vulnerabilities**.

The production-browser smoke passed after the test fixture was expanded with a second broker ticker classified as Margin using the actual Balance-desk UI. The cash-funded AAPL operation remained available for the guest-assignment journey.

Validation is provided by GitHub Actions on the exact PR head; no local test execution is claimed.
