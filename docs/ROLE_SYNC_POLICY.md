# Role-based portfolio synchronization

Automatic synchronization is mandatory for authenticated accounts. Settings stores a separate quote interval per role; supported values are 15, 30, and 60 seconds. The defaults are 60 seconds for administrators and 15 seconds for guests. A legacy saved `Off` value is normalized to that role's default. Settings no longer offers a disabled interval. Manual Sync is available in the workspace header and Settings for both roles.

## Administrator account

- Live market quotes and the encrypted shared portfolio snapshot follow the selected interval. The default is 60 seconds.
- The private TradeNet portfolio and orders streams are the primary source for broker balances, positions, executed trades, and active orders.
- The private stream is considered healthy only after both portfolio and orders channels have delivered validated snapshots for the current administrator session.
- While both channels are healthy, recurring REST snapshots are suppressed. If either stream has not delivered its first valid snapshot or is disconnected, account/balance/position, executed-trade, and active-order REST snapshots run on the 60-second supplemental cadence. A recovered stream receives one catch-up after a missed update window.
- **Closed History and Freedom cashflows are separate from the shared portfolio record.** They are fetched, merged by stable operation/trade IDs with existing local and encrypted cloud history, fee allocations are recalculated, and the local sidecar is persisted every 60 seconds. The encrypted `/api/history` record is checkpointed after merge. The shared portfolio record is checkpointed after that calculation so app-owned closed-trade totals are not left only on the device.
- Cashflow requests use a full baseline on first sync, then query from the latest persisted cashflow date with a one-day overlap. Existing rows are retained; incremental pages do not replace history.
- Manual Sync refreshes broker account data, executed trades, active orders, assigned portfolio quotes, Freedom cashflows and fee allocations, the separate encrypted Closed History record, and finally the shared portfolio snapshot. Completion is reported as partial when any source fails.

## Guest account

- Assigned ticker quotes follow the selected interval. The default is 15 seconds.
- The server-scoped assigned-holdings projection and LOTS ledger refresh every 60 seconds. After the snapshot is applied, quotes are refreshed for the newly assigned tickers.
- Manual Sync fetches only the authenticated guest's holdings/LOTS snapshot and then refreshes quotes for those holdings.
- Guests never request administrator broker balances, executions, orders, the admin Closed History record, or the administrator's shared portfolio cloud record. Their assigned holdings and history remain scoped to their authenticated guest account.

## Visibility and account isolation

The scheduler pauses while the document is hidden and performs a fresh role-scoped sync when the app becomes visible again. Changing account role replaces the previous role's timers. Session guards prevent late broker, cashflow, or guest responses from being applied to a different account. Automatic and manual operations use the same role-specific source boundaries.
