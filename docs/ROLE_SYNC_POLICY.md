# Role-based portfolio synchronization

Automatic synchronization is mandatory for authenticated accounts. Settings stores a separate interval per role; supported values are 15, 30, and 60 seconds. The defaults are 60 seconds for administrators and 15 seconds for guests. A legacy saved `Off` value is normalized to the matching role default, and the Settings selector no longer offers an Off option.

## Administrator account

- Live market quotes and the shared portfolio cloud checkpoint follow the selected interval. The default is 60 seconds.
- The private TradeNet portfolio and orders streams are the primary source for broker balances, positions, executed trades, and active orders.
- The stream is considered healthy only after both the portfolio and orders channels have delivered validated snapshots for the current administrator session.
- While the stream is healthy, recurring REST snapshots are suppressed to avoid duplicate reads. If the stream has not become healthy, the app requests account/balance/position, executed-trade, and active-order snapshots during each 60-second supplemental cycle. A previously healthy stream that disconnects gets one recovery catch-up, even if it reconnects before the next cycle.
- The shared encrypted portfolio snapshot is pushed after each selected quote-refresh cycle. Normal store changes also retain the existing local persistence and cloud-write behavior.
- Manual Sync in the workspace header or Settings refreshes broker account data, executed trades, active orders, quotes, and the shared cloud snapshot.

## Guest account

- Assigned ticker quotes follow the selected interval. The default is 15 seconds.
- The server-scoped assigned-holdings projection and LOTS ledger refresh every 60 seconds. After the snapshot is applied, quotes are refreshed for the newly assigned tickers.
- Manual Sync in the workspace header or Settings fetches the current guest-owned holdings/LOTS snapshot and then refreshes quotes for those holdings.
- Guests never write to or pull the administrator's shared portfolio record. Their holdings and assignment history remain scoped to their authenticated guest account.

## Visibility and account isolation

The scheduler pauses while the document is hidden and performs a fresh role-scoped refresh when the app becomes visible again. Changing account role replaces the previous role's timers. Session guards prevent late broker or guest responses from being applied to a different account. Automatic and manual operations use the same role-specific source boundaries.
