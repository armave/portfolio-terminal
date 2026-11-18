# Portfolio planning settings

## Authorization and scope

The current application roles are **admin** and **guest**. Portfolio planning settings are workspace-wide and editable only by an authenticated admin. The Settings UI checks the admin capability, and the application event handler independently calls `requireAdmin` before mutating state or requesting cloud synchronization. Guests remain read-only and cannot edit these settings.

The application does not currently implement separate portfolio-owner, manager, investor, or trader roles. Those roles belong to the proposed future tenancy model and are not assumed by this implementation.

Settings are stored in `PortfolioState.portfolioSettings`, separate from canonical `PortfolioState.positions`, and use the existing encrypted portfolio synchronization path. Explicit per-position targets and explicit tranche classifications take precedence over the defaults below.

## Configurable policies and existing defaults

| Setting | Existing default | Effect |
|---|---:|---|
| Minimum post-sale account balance | −$450 USD | Minimum hypothetical signed account balance after selling open positions at their configured PTs, net of sell commissions. The portfolio carry horizon is the first day daily margin accrual takes the post-sale balance below this floor; it is independent of net-P&L breakeven. This is an app planning floor, not a broker buying-power or liquidation limit. |
| Buy More minimum equity | 20% | App-side projected equity-ratio floor. |
| Buy More maintenance reserve | 10 percentage points | Added to the configured broker maintenance equity ratio; the greater of this result and the minimum-equity floor is used. This is not a broker-reported requirement. |
| Account equity health reference | 40% | Reference for the account-equity gauge and Elevated/Healthy classification, after broker stop-out and maintenance boundaries. |
| New margin-position target uplift | 5% | Applied only when a newly classified margin position has no existing target price. |
| Default funding for new broker positions | Margin | Used only when no explicit saved tranche or ticker classification exists; Cash is also selectable. |

The settings are typed and normalized in `src/domain/portfolioSettings.ts`. Numeric inputs are bounded; missing or malformed optional values fall back to the established defaults. Settings normalization does not modify position lots, cost basis, journal events, or financial accounting records.

## Internal controls that remain fixed

Quote and FX freshness limits, future-clock skew, request timeouts, retry/backoff and provider cooldown policy, authentication/session limits, request and prompt size caps, algorithm search horizons, concurrency limits, and financial calculation tolerances remain internal reliability, security, or financial-integrity controls. They are not ordinary user settings.

Broker borrow rate, day-count basis, maintenance ratio, stop-out ratio, rollover time, and commissions remain in the separate **Broker & Trading Model** section. App-side planning guardrails must not be described as broker-reported facts.

## Validation

Regression tests cover retained defaults, bounded normalization, custom breakeven floors, margin-health reference classification, funding-default overrides, role permissions, and Russian translations. Changes to financial formulas, currencies, source provenance, or ownership semantics require a separate documented review.
