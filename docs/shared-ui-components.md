# Shared UI components and ownership

These components standardize presentation across desks without introducing a second owner for application state, financial data, synchronization, or notification lifecycle.

## OperationActivityIndicator

- **Component:** `src/components/OperationActivityIndicator.tsx`
- **Current callers:** `CloudSyncIndicator` and `ClosedHistoryDesk`
- Renders an already-active operation as a compact or inline spinner with an optional visible label and accessible status announcement.
- The caller supplies the visibility state. Cloud sync continues to own the header state; the Trades foreground broker request continues to own its request-scoped state.
- The component does not start requests, coalesce operations, subscribe to sync stores, or determine whether work has completed.
- Workspace activity callers share a 700 ms appearance delay and 650 ms minimum visible duration through `useDelayedActivityVisibility`. The lower-level hook default remains 400 ms for other callers.

## DataQualityNotice

- **Component:** `src/components/DataQualityNotice.tsx`
- **Current caller:** the aggregate risk/valuation quality panel in `SummaryMetricsGrid`
- Renders a caller-classified quality state: current, provisional, incomplete, unavailable, stale, cached, error, or conflict.
- The owning feature determines the status from its validated domain result and supplies localized title/status copy.
- The component does not inspect quote timestamps, infer freshness, calculate reliability, change a valuation, or replace unknown values with zero.
- Existing ticker-level drilldowns and explanations remain owned by the feature.

## ToastViewport

- **Component:** `src/components/ToastViewport.tsx`
- **Current caller:** the application shell in `src/App.tsx`
- Renders typed app notifications consistently at desktop and mobile widths, preserving error alerts and polite status announcements.
- `src/ui/notificationStore.ts` remains the owner of notification IDs, retention limits, automatic dismissal, and exit timers. The viewport does not schedule or mutate notifications.

## Adoption and extension rules

1. Prefer these components when a desk needs the same operation-feedback, data-quality, or notification presentation.
2. Keep user-facing strings in the existing English/Russian localization dictionary; pass translated copy to the component.
3. Keep state and business decisions in their existing owners. Do not make a visual component responsible for network activity, retries, account identity, broker freshness policy, or financial calculations.
4. Preserve semantic distinctions between cloud synchronization, broker execution refresh, cashflow reconciliation, and local calculations.
5. Add focused component tests and update both locale dictionaries/parity tests whenever new user-facing copy is introduced.
