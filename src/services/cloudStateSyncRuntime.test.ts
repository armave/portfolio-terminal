import { describe, expect, it } from 'vitest';
import { createCloudStateSyncRuntime } from './cloudStateSyncRuntime';

describe('cloud state compact serialization', () => {
  it('preserves the immutable source sale-event link when compacting closed trades', async () => {
    let encryptedPlaintext = '';
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async (plaintext) => {
        encryptedPlaintext = plaintext;
        return 'aesgcm:v2:test-ciphertext:test-nonce';
      },
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: () => 2,
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(1)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => new Response(
        JSON.stringify({ success: true, revision: 2 }),
        { status: 200, headers: { ETag: '"2"' } }
      )
    });

    const result = await runtime.pushCloudState({
      gatewaySecret: 'must-not-sync',
      closedTrades: [{
        id: 'closed-1',
        transactionEventId: 'sale-event-42',
        ticker: 'AAPL',
        shares: 2,
        avgBuyPrice: 100,
        sellPrice: 120,
        grossProfit: 40,
        commissions: 1.2,
        netProfit: 38.8,
        raw: { providerPayload: 'must-not-sync' }
      }]
    }, { secret: 'test-secret' });

    expect(result).toBe(true);
    const serialized = JSON.parse(encryptedPlaintext);
    expect(serialized.closedTrades).toHaveLength(1);
    expect(serialized.closedTrades[0]).toMatchObject({
      id: 'closed-1',
      transactionEventId: 'sale-event-42',
      ticker: 'AAPL',
      shares: 2,
      avgBuyPrice: 100,
      sellPrice: 120,
      commissions: 1.2,
      grossProfit: 40,
      netProfit: 38.8
    });
    expect(serialized).not.toHaveProperty('gatewaySecret');
    expect(serialized.closedTrades[0]).not.toHaveProperty('raw');
  });
});


describe('cloud state sync options', () => {
  it('prefers an explicit state and falls back to the latest state getter', async () => {
    const encryptedStates: string[] = [];
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'active-secret',
      encryptCloudPayload: async (plaintext) => {
        encryptedStates.push(plaintext);
        return 'aesgcm:v2:test-ciphertext:test-nonce';
      },
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: () => 2,
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(1)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => new Response(
        JSON.stringify({ success: true, revision: 2 }),
        { status: 200, headers: { ETag: '"2"' } }
      )
    });

    let getterCalls = 0;
    const explicitState = { activeView: 'AAPL', balance: 100 };
    const explicitResult = await runtime.syncCloudState('push', {
      state: explicitState,
      getState: () => {
        getterCalls += 1;
        return { activeView: 'SHOULD_NOT_BE_USED', balance: 999 };
      },
      secret: 'explicit-state-secret'
    });

    expect(explicitResult).toBe(true);
    expect(getterCalls).toBe(0);
    expect(JSON.parse(encryptedStates[0])).toMatchObject(explicitState);

    const getterState = { activeView: 'MSFT', balance: -200 };
    const getterResult = await runtime.syncCloudState('push', {
      getState: () => {
        getterCalls += 1;
        return getterState;
      },
      secret: 'getter-state-secret'
    });

    expect(getterResult).toBe(true);
    expect(getterCalls).toBe(1);
    expect(JSON.parse(encryptedStates[1])).toMatchObject(getterState);
  });
});
