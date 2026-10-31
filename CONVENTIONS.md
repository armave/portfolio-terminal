# Refactoring & Code Conventions

These conventions describe the current Preact, TypeScript, and Cloudflare Worker architecture.

1. **Language:** Keep source comments, documentation, commit messages, and developer-facing explanations in English. User-facing application copy must use the localization system in `src/services/i18n.ts` when it is part of the supported interface.

2. **UI ownership and state:** Preact components own the UI they render. `src/store/portfolioStore.ts` is the canonical owner of portfolio state; `positions` is authoritative and `holdings` is a compatibility projection. Components should subscribe through the store hooks and issue typed actions/events. Do not maintain redundant prop/state mirrors or mutate sibling-owned DOM. Use refs and effects for browser APIs that act on an element owned by the component (focus, measurement, scrolling, and similar lifecycle work).

3. **Application and service boundaries:** Keep application orchestration in `app.ts` and `src/App.tsx`, provider/network access in `src/services/`, and presentation in `src/components/`. Route market-data proxy requests through the API service (`proxyFetch(action, params, options)`) so authentication headers, request coalescing, error handling, and session-aware caching remain centralized. Components and domain modules must not call provider endpoints directly.

4. **Domain logic:** Keep financial and other business calculations deterministic and independent of UI, storage, and network APIs. Reuse pure functions from `src/domain/`; do not duplicate commission, interest, rollover, FIFO, valuation, fee-allocation, or risk formulas in components or runtime orchestration. Changes to financial semantics require focused regression tests and an explicit explanation of the compatibility impact.

5. **Persistence and compatibility:** Use `src/services/storage.ts` for portfolio persistence, backups, broker assumptions, and device credential storage. Keep cloud revisions and device-only navigation preferences within their existing owning service/store boundaries; they are not portfolio state and must not contain credentials. Preserve legacy snapshot compatibility, encrypted cloud-history behavior, revision checks, and rollback guarantees. Never silently replace missing or malformed data with an empty portfolio when doing so could discard recoverable user data.

6. **Typed communication:** Use the typed in-process channels in `src/ui/uiEventBus.ts` and `src/services/brokerEventBus.ts` for component/runtime requests and broker updates. Add or change event payloads in the channel's type map and cover delivery, multiple subscribers, and unsubscribe behavior in tests. Do not reintroduce ad-hoc `window` custom events or global mutable caches.

7. **Worker and security boundaries:** Keep Worker routes and Durable Object storage in `worker.js` and `state-store.js`. Validate method, authentication, action, input shape, and payload bounds at the server boundary. CORS/origin allowlisting is defense in depth, not authentication. Never expose gateway credentials, broker session identifiers, raw sensitive provider payloads, or secrets to browser logs or UI. Client-side changes should not weaken server-enforced authorization.

8. **UI and accessibility:** Use semantic Preact markup and the existing Tailwind/CSS design system. Keep tables readable on desktop and keyboard-scrollable on narrow screens; provide accessible names, column headers, visible focus, useful loading/error/empty states, and touch-sized actions. Respect reduced-motion preferences. Keep English/Russian static copy in the localization dictionary and test important dynamic translations.

9. **Scope and cleanup:** Inspect all connected callers, producers, consumers, tests, styles, and documentation before deleting or replacing a legacy path. Remove code only after proving it is unused or a no-op. Do not delete active runtime/Worker files because they are large or older, and do not add a framework or dependency without a concrete need. Never leave placeholders, truncated code, unused compatibility branches, or incomplete implementations.

10. **Branch integration:** Start client-side refactors from the latest `main`. Review branch divergence before rebasing or cherry-picking; replay only changes whose intent is still valid, resolve conflicts semantically, and do not force-update unrelated in-flight branches. Keep client-side work in a reviewable pull request. Publish Worker/server-side changes through the designated `main` workflow.

11. **Validation:** Run the repository's full merge gate on the final change set:
    - `npm ci`
    - `npm run typecheck`
    - `npm test`
    - `npm run validate:dead-code`
    - `npm audit --omit=dev --audit-level=high`
    - `npm run build`

    Inspect the final diff for unintended financial, persisted-data, broker, security, and deployment changes. Report unavailable checks honestly; never claim a test or build passed without evidence. Resolve failures at their source rather than weakening assertions or skipping checks.
