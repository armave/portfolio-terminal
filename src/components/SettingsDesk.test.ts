undefined

describe('automatic update settings', () => {
  it('documents role-specific refresh cadence and immediate resume behavior', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');

    expect(source).toContain("DEFAULT_GUEST_REFRESH_INTERVAL_MS");
    expect(source).toContain("DEFAULT_ADMIN_REFRESH_INTERVAL_MS");
    expect(source).toContain("refreshNow: true");
    expect(source).toContain("Your assigned holdings and LOTS history refresh every 60 seconds.");
    expect(source).toContain("Broker balances, positions, trades and orders refresh every 60 seconds.");
    expect(source).toContain("Automatic updates are paused. Manual Sync remains available.");
  });
});
