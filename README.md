# Portfolio Terminal

Portfolio Terminal is a browser-based personal tracker and scenario calculator for margin and non-margin stock holdings. It models a configurable broker margin interest schedule, commission formulas, debt balances, and risk thresholds to provide portfolio estimates and simulate hypothetical exit strategies.

It is **not** a broker connection, order-entry system, source of official account data, or investment advice. It does not place or route trades. Verify holdings, quotes, fees, margin requirements, and risk calculations with your broker before acting.

---

## Features

* **Margin Position Tracking:** Records purchase tranches, position quantities, entry averages, target prices, and partial or full sales.


* **Cash Cushion & Non-Margin Holdings:** Tracks cash balance and equity holdings separately from leveraged margin positions.


* **Broker Financial Engine:** Models daily margin interest compounding, rollover timings, trade commissions (flat, per-share, or value percentage), account equity, break-even targets, and stop-out risk.


* **Dynamic Projections:** Calculates projected End of Week (EOW) or Next Trading Day (NTD) timelines, carrying fees, and debt accruals.

* **Valuation Data Quality:** Flags incomplete or provisional account-equity and margin-risk estimates; expandable per-holding details show quote source, freshness, provider observation time, and client receipt time when available. Scenario reports include matching quality warnings and provenance.


* **Closed Trade Audit:** Retains closed margin trade history with net realized gains, holding durations, and commission costs.


* **Multi-Provider Market Data:** Streams live prices, premarket indicators, and analyst targets via Finnhub, Twelve Data, Alpha Vantage, RapidAPI Yahoo Finance, and Stooq.

* **TradeNet WebSocket Account Refresh:** Active orders and USD balances/positions use authenticated short-lived WebSocket snapshots as their primary source, with the existing REST endpoints retained as automatic fallbacks. The tested `markets` event provides exchange-level status/schedule metadata, not security quote prices; the `getStockQuotesJson` quote path remains REST/provider-backed until a separate quote (`q`) stream is verified.

* **Freedom Broker Account Reconciliation:** When the authenticated read-only Freedom TradeNet account API returns a valid snapshot, the app prioritizes the broker's USD balance, aggregate share quantities, and available broker-reported prices. App-owned trade lots and cost basis remain separate; quantity mismatches are surfaced instead of silently rewriting lots.


* **Conversational Trading Console:** Evaluates natural-language portfolio entries and exit scenario modeling using Google Gemini with an explicit confirmation safeguard.


* **Account Roles & Cloud Sync:** Uses Worker-backed accounts with `admin` and `guest` roles, password-hashed credentials, role-specific session lifetimes, and server-enforced read-only guest access. Portfolio state remains encrypted before cloud synchronization.



All calculations, broker formulas, and valuations are estimates intended for tracking and planning purposes.

---

## Getting Started

### Hosted Application

Access the production build on [GitHub Pages](https://armave.github.io/portfolio-terminal/). Portfolio state and broker preferences remain browser-side; authenticated cloud requests are handled by the Cloudflare Worker and Durable Object. Account session tokens are stored encrypted on the device using the browser's non-extractable IndexedDB key. Other provider API keys may be stored in browser storage, so use a trusted device and browser profile.

### Accounts and roles

On the first visit after this upgrade, create the initial administrator account using the configured Worker Gateway Secret. The one-time bootstrap credential also initializes the shared portfolio encryption key, which the Durable Object retains for authenticated accounts; subsequent sign-ins use the account name and password. Passwords must be 6–128 characters and are stored server-side as salted PBKDF2-SHA-256 hashes. Guest and administrator session tokens expire 30 days after issuance. Session tokens are stored hashed by the Durable Object. Logging out, changing a password, or deleting an account still revokes the relevant sessions.

Administrators can create, rename, change the role of, reset the password for, and delete accounts in **Settings → User management**. New accounts default to **guest**. Administrator accounts share the single owner workspace. Guests can read only the account-scoped projections published for them by an administrator; they cannot read the owner's workspace, closed history, or workspace encryption key, and cannot write to their projection. Guest accounts are read-only views, not independent portfolios. At least one administrator must remain, and an administrator cannot delete their own signed-in account. Each account also has an **English (en)** or **Russian (ru)** interface language preference. New accounts default to English; administrators can set a user's language in User management, and every user can change their own language in Settings.

Administrator accounts share the owner's workspace across devices. Guest accounts cannot read the shared workspace, closed history, or workspace encryption key. Instead, each guest can read only the server-filtered, encrypted tranche projection and assignment history published for that guest account by an administrator. Guest projections are account-scoped, but they are not full independent multi-tenant portfolios. A guest's local, offline edits do not update the cloud projection.

### Local Development

**Prerequisites:** Node.js (v18+) and npm.

```sh
# Clone repository
git clone https://github.com/armave/portfolio-terminal.git
cd portfolio-terminal

# Install dependencies
npm ci

# Start local dev server
npm run dev

```

Open the local development URL displayed by Vite (default: `http://localhost:5173/`).

To compile a production build:

```sh
npm run build

```

---

## Standard Workflow

1. **Configure Broker Rules:** Open **Broker assumptions & quote symbols**. Configure your annual margin borrowing rate, day-count convention (360 vs. 365), daily rollover cutoff (Armenia Time), maintenance equity ratio, stop-out threshold, and commission minimums/rates.


2. **Set Cash Balance & Holdings:** Enter your signed cash balance in the Cash panel (positive denotes available cash; negative denotes broker debt). Log holdings either via inline table rows or the Trading Console.


3. **Monitor Active Positions:** Use ticker tabs to inspect tranches, unrealized profit/loss, daily carry costs, and breakeven horizons.


4. **Automatic Portfolio Sync:** Each signed-in admin or guest has a mandatory 15s, 30s, or 60s refresh cadence in Settings. The selected interval refreshes that role's important data; **Sync portfolio** remains available for immediate manual sync.


5. **Run Scenarios in Terminal:** Use plain-language prompts in the Trading Console to simulate staged exits, compare multiple price targets across dates, or log trades.


6. **Backup State:** Export a JSON snapshot periodically, or configure GitHub Gist sync for cross-device continuity.



---

## Trading Console

The console supports deterministic commands and natural-language queries. When viewing an active holding, command suggestions contextually adapt to that ticker.

### Direct / Utility Commands (No API Key Required)

```text
quote AAPL
pull
quote symbol 7203 finnhub=TSE:7203 stooq=7203.jp
quote symbol 7203 finnhub=default stooq=default

```

### Natural Language Examples (Requires Gemini Key)

```text
bought 10 AAPL for 180, pt 205
sell 4 AAPL for 195
sold all AAPL for 195
add cash stock 5 MSFT
remove cash stock MSFT
balance 5000
balance -5000
set AAPL target to 210
compare selling AAPL today for 195 vs 14 days later for 200
sell 5 AAPL today for 195 and 5 in 7 days for 205

```

*Note:* All AI-interpreted portfolio mutations require user confirmation before committing state. Margin sales exceeding open tranche quantities are blocked.

---

## Freedom Broker data priority

Freedom TradeNet account data is the preferred source for the broker-reported USD balance, aggregate account positions, and market prices included in the account snapshot when valid data is available. The app keeps its own trade lots, targets, commissions, and cost basis separate so a broker snapshot cannot silently rewrite local accounting. Broker aggregate quantities are reconciled against locally tracked margin quantities to derive cash holdings. If quantities do not reconcile, the app reports the discrepancy and preserves the affected local cash quantity rather than guessing.

If Freedom account data is unavailable or the Gateway Secret has not been configured, locally saved portfolio data remains available and the app surfaces a warning. A previously loaded broker snapshot is marked stale after a failed refresh; it must not be presented as a current broker balance. Quote freshness is marked unknown when the broker snapshot does not provide a verifiable market observation timestamp.

### TradeNet authenticated WebSocket active-orders snapshots

The Worker provides an administrator-only, read-only active-orders snapshot at `?action=freedom-orders-stream`. It uses Worker-only `FREEDOM_LOGIN` and `FREEDOM_PASSWORD` secrets, obtains a short-lived TradeNet SID, opens the production WebSocket through Cloudflare, and subscribes to `orders`. The sanitized order list is returned to the app's existing active-order normalizer after both production-session events arrive. It is requested on the normal 60-second active-order refresh cadence; this is a request-driven snapshot, not a permanently open browser socket. The existing REST `freedom-orders` endpoint remains the fallback if the WebSocket snapshot fails. The Worker never returns account identifiers, credentials, arbitrary broker payload fields, or the SID; the diagnostic preview omits order IDs. The SID is not persisted, and the socket closes after the required events arrive or the eight-second observation window ends.

The Worker exposes a compact public US-equities market status through `?action=freedom-market-status` for both administrators and guests. It returns one canonical state only (preferring the combined FIX market, then falling back to Nasdaq and NYSE); it does not return the 37-market list or any private account data. The raw `?action=freedom-event-stream` schema diagnostic remains administrator-only.

The active account refresh now uses `?action=freedom-portfolio-snapshot` as its primary source for sanitized, loaded USD balances and positions from the authenticated `portfolio` event; REST `freedom-positions` (`getPositionJson`) is the automatic fallback. Both use the same portfolio normalizer. The admin Settings comparison remains available to reconcile the WebSocket and REST values with a 0.01 numeric tolerance without changing saved holdings or portfolio state.

The signed REST market-data endpoints continue to use `FREEDOM_PUBLIC_KEY` and `FREEDOM_PRIVATE_KEY`. `GATEWAY_SECRET` remains the Worker gateway/bootstrap secret. This diagnostic does not restore Market Depth or affect portfolio data.

If TradeNet requires an additional SMS or verification challenge during password login, the diagnostic login will fail safely; interactive challenge handling is not implemented.

## Market Data & API Keys

Provider keys are optional. Without API keys, the calculator, scenario engine, backup system, and manual tracking remain functional.

Keys are configured directly in the terminal toolbar:

| Provider | Purpose | Fallback Order & Details |
| --- | --- | --- |
| **Finnhub**<br> | Primary live quotes, corporate news, analyst price targets

 | 1st in quote priority; primary source for analyst consensus

 |
| **Twelve Data**<br> | Secondary live quote feed

 | 2nd in quote priority

 |
| **Alpha Vantage**<br> | Market quotes, company overview, earnings, and target fallback

 | 3rd in quote priority; 2nd for analyst price targets

 |
| **Yahoo Finance (RapidAPI)**<br> | Premarket quotes and price target fallback (`apidojo-yahoo-finance-v1`)

 | Preferred premarket check; 4th in regular quotes; 3rd for analyst targets

 |
| **Stooq**<br> | End-of-day / delayed fallback quote source

 | 5th in quote priority

 |
| **Google Gemini**<br> | Natural language parsing and scenario simulations in the console

 | Kept in `sessionStorage`<br> |

### Key Storage & Gist Encryption

* Market provider keys reside in browser `localStorage`.


* When GitHub Gist sync is active, provider keys are synced as an auxiliary file encrypted with AES-256-GCM (key derived from your Gemini key via PBKDF2-SHA-256).


* Neither the Gemini key nor your GitHub Personal Access Token is saved in the Gist payload.



---

## Architecture & Codebase

The app uses **Preact, TypeScript, Vite, Tailwind CSS, and Vitest**. The browser entry point is `src/main.ts`, which loads the root `app.ts` runtime; the Cloudflare Worker is deployed separately from `worker.js` and `state-store.js`.

```text
portfolio-terminal/
├── src/
│   ├── components/        # Preact presentation components
│   ├── domain/            # Portfolio math, calendars, quote normalization
│   ├── features/
│   │   ├── ai/            # Gemini client, intent handling, prompts
│   │   ├── quotes/        # Market insight and sentiment helpers
│   │   └── terminal/      # Command dispatch and scenario evaluation
│   ├── services/          # Provider APIs, polling, persistence, backup
│   ├── store/             # Canonical portfolio state and mutations
│   ├── types/             # Shared portfolio and broker types
│   ├── ui/                # Board rendering and notifications
│   ├── utils/             # Formatting and relative-time helpers
│   ├── App.tsx            # Main Preact application
│   └── main.ts            # Browser entry point
├── app.ts                 # Runtime orchestration and event wiring
├── worker.js              # Cloudflare Worker API boundary
├── state-store.js         # Durable Object cloud-state storage
├── worker.test.js         # Worker and Durable Object tests
├── docs/                  # Architecture, audit, and provider notes
├── style.css              # Application styles
├── startup-critical.css   # Inlined first-paint styles
├── vite.config.ts         # Build, PWA, and CSS injection
└── package.json            # Validation and build scripts
```

Keep the financial domain independent of UI and network concerns. Treat `PortfolioState.positions` as canonical, and retain root-level runtime/Worker files until their call sites, deployment paths, and tests have been migrated deliberately.

## Quality & Testing

The project uses **Vitest** for test execution and TypeScript for static type validation. Worker and Durable Object tests cover guest/admin data boundaries, guest projection ownership, session revocation, and optimistic concurrent-write conflicts.

```sh
# Run automated tests
npm test

# Verify TypeScript types without building
npm run typecheck

# Check for unused exports and dead code
npm run validate:dead-code

# Run full production build
npm run build

```

Deployment to GitHub Pages is handled via `.github/workflows/deploy.yml` upon pushing commits to `main`. The deployment workflow runs tests, dead-code validation, and the production build before publishing.

## Deployment origin and ownership model

The app supports multiple named accounts, but it does not provide a separate editable portfolio per account. Administrator accounts access the same owner workspace. Guest accounts receive only their own server-filtered projection and assignment history; they cannot retrieve the owner workspace, closed history, or its encryption key. This is a shared owner workspace with guest projections, not general tenant-isolated storage. The Gateway Secret is required for the initial administrator bootstrap and initializes the shared workspace-encryption key. Only authenticated administrators can retrieve that key over HTTPS. Keep administrator account access restricted.

The Worker restricts browser requests to `https://armave.github.io` and local Vite development origins by default. For a trusted custom deployment, configure the Cloudflare Worker variable `ALLOWED_ORIGINS` as a comma-separated list of exact origins (scheme and host, with port when applicable). The origin policy is defense in depth; each protected request also requires a valid account session.

## Gateway and cloud-sync safety notes

The Cloudflare Worker accepts account sessions for protected quote/news, Gemini, and cloud-state actions. The Gateway Secret is checked by the one-time initial admin bootstrap endpoint and initializes the shared portfolio encryption key, which the Durable Object retains across later Gateway Secret rotations. Only administrator sessions can retrieve that key or access the owner workspace and closed history. Guest sessions can read only their own published projection and cannot write to it. General Worker POST request bodies are bounded to 20 MB; `/api/auth/*` JSON request bodies have a separate 8 KB limit. Cloud-state payload writes are independently bounded to 20 MB by the Durable Object. Ticker batches are limited to 10 symbols, Gemini prompts to 12,000 characters, and Gemini model selection is allowlisted. Upstream requests have bounded timeouts. Cloud-state writes require an `If-Match` revision and a non-empty encrypted payload; stale writes return HTTP 409 rather than overwriting newer state. On a conflict, export local changes before pulling the latest shared state.

For recovery, keep a current JSON export in a trusted location before major changes. Import validates the file before replacing local state, shows a portfolio preview and confirmation, and rejects files over 20 MB; export and test-restore a backup periodically rather than relying on cloud sync as your only copy. Cloud sync is a separate copy and rejects stale writes; export local changes, pull the latest state, reconcile changes, and then sync rather than repeatedly retrying a conflicted write. The account session token is device-profile bound: clearing browser site data or losing the browser's IndexedDB key requires signing in again. The app cannot restore a lost session token from encrypted ciphertext alone.
