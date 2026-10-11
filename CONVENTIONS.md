# Refactoring & Code Conventions

1. Language & Output: Always provide explanations, code comments, and git commit messages strictly in English. Never use any other language.
2. State Isolation: Maintain `state` as the single source of truth. Mutate state cleanly, then trigger the corresponding render function. Never manipulate the DOM directly inside network calls or event handlers.
3. Proxy Fetching: All calls to the Cloudflare Worker proxy MUST route through `proxyFetch(action, params, options)` with the `X-App-Auth` header.
4. Domain Logic Reuse: Never duplicate financial or math formulas in UI or controller scripts. Always import pure domain functions from `src/domain/` (e.g., `portfolio.ts`, `tradingCalendar.ts`).
5. Storage & Persistence: Route all persistence and cache handling strictly through `src/services/storage.js` with defensive JSON parsing. Do not call raw `localStorage` elsewhere.
6. Vanilla DOM & Semantic Layout: Preserve existing Vanilla JS architecture, element IDs, and CSS class bindings. Ensure responsive table wrappers use `.table-scroll-wrapper` with horizontal scroll on small viewports, and constrain desktop table widths to readable boundaries (max 960px).
7. No Placeholders: Never truncate code with `// ...`, omit imports, or leave incomplete implementations.
8. Autonomous Multi-File Scope: Proactively identify, inspect, and modify all connected files (UI, domain logic, tests, CSS) in a single turn. Do not stop to ask for confirmation or defer related updates.
9. Automated Self-Healing & Defensiveness: When tests or builds fail, inspect the exact assertion error or stack trace and resolve the root issue immediately. Never bypass tests by deleting assertions, hardcoding expected values, or stubbing domain logic.
10. Integrity & Verification: Ensure all existing Vitest suites (`npm test`) and production builds (`npx vite build`) pass with zero errors after every modification before finalizing a commit.