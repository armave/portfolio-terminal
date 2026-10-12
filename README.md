# Portfolio Terminal

Portfolio Terminal is a browser-based personal tracker and scenario calculator for margin and non-margin stock holdings. It models a configurable broker margin interest schedule, commission formulas, debt balances, and risk thresholds to provide portfolio estimates and simulate hypothetical exit strategies.

It is **not** a broker connection, order-entry system, source of official account data, or investment advice. It does not place or route trades. Verify holdings, quotes, fees, margin requirements, and risk calculations with your broker before acting.

---

## Features

* **Margin Position Tracking:** Records purchase tranches, position quantities, entry averages, target prices, and partial or full sales.


* **Cash Cushion & Non-Margin Holdings:** Tracks cash balance and equity holdings separately from leveraged margin positions.


* **Broker Financial Engine:** Models daily margin interest compounding, rollover timings, trade commissions (flat, per-share, or value percentage), account equity, break-even targets, and stop-out risk.


* **Dynamic Projections:** Calculates projected End of Week (EOW) or Next Trading Day (NTD) timelines, carrying fees, and debt accruals.


* **Closed Trade Audit:** Retains closed margin trade history with net realized gains, holding durations, and commission costs.


* **Multi-Provider Market Data:** Streams live prices, premarket indicators, and analyst targets via Finnhub, Twelve Data, Alpha Vantage, RapidAPI Yahoo Finance, and Stooq.


* **Conversational Trading Console:** Evaluates natural-language portfolio entries and exit scenario modeling using Google Gemini with an explicit confirmation safeguard.


* **Zero-Backend Persistence & Cloud Sync:** Saves state locally in browser storage with optional AES-256-GCM encrypted GitHub Gist synchronization and JSON export/import.



All calculations, broker formulas, and valuations are estimates intended for tracking and planning purposes.

---

## Getting Started

### Hosted Application

Access the production build on [GitHub Pages](https://armave.github.io/portfolio-terminal/). The application executes entirely client-side in the browser, storing data in `localStorage`.

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


4. **Fetch Live Market Data:** Click **Quotes** to pull fresh market data, or configure automatic refresh intervals (15s, 30s, 60s).


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

The frontend is built on **React 18**, **TypeScript**, **Tailwind CSS**, and **Vite**. Pure domain business logic is decoupled from UI rendering.

```text
portfolio-terminal/
├── src/
│   ├── components/            # React UI components (Dashboard, Tables, Modals, Console)
│   ├── contexts/              # Application-wide React contexts (NotificationContext)
│   ├── domain/                # Pure financial engines and trading calendars
│   │   ├── portfolio.ts       # Margin interest, breakeven math, P&L, risk equations
│   │   └── tradingCalendar.ts # NYSE/NASDAQ holiday schedules, EOW/NTD date math
│   ├── features/              # Modular integrations and AI services
│   │   ├── ai/                # Gemini client, intent classification, prompt builders
│   │   └── quotes/            # Finnhub, Twelve Data, Alpha Vantage, RapidAPI connectors
│   ├── services/              # Storage engine, JSON import/export, encrypted Gist sync
│   ├── store/                 # Global state management (PortfolioContext)
│   ├── main.tsx               # Application root mount and providers
│   └── utils.tsx              # Formatting, currency, and date helpers
├── style.css                  # Tailwind CSS root styles
├── vite.config.ts             # Vite bundler configuration
└── vitest.config.ts           # Vitest configuration

```

---

## Quality & Testing

The project uses **Vitest** for test execution and TypeScript for static type validation.

```sh
# Run automated tests
npm test

# Run tests once without watch mode
npm run test:run

# Verify TypeScript types without building
npm run typecheck

# Run full production build
npm run build

```

Deployment to GitHub Pages is handled via `.github/workflows/deploy.yml` upon pushing commits to `main`.