import { afterEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import { pushCloudState, syncCloudState } from './api';

describe('cloud state sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not mutate the live state when excluding local-only fields from cloud backup', async () => {
    const state = {
      activeView: 'AAPL',
      balance: 1250,
      gatewaySecret: 'local-only-secret',
      marginBalance: 500
    };
    const originalState = { ...state };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushCloudState(state, {
      secret: 'cloud-encryption-secret',
      showToast: vi.fn()
    });

    expect(result).toBe(true);
    expect(state).toEqual(originalState);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    const decrypted = CryptoJS.AES.decrypt(
      payload.encryptedPayload,
      'cloud-encryption-secret'
    ).toString(CryptoJS.enc.Utf8);
    expect(JSON.parse(decrypted)).toEqual({
      activeView: 'AAPL',
      balance: 1250
    });
  });
  it('returns false when a failed cloud pull falls back to a truthy local state', async () => {
    const localState = { activeView: 'AAPL', balance: 1250 };
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await syncCloudState('pull', {
      state: localState,
      secret: 'cloud-encryption-secret',
      showToast: vi.fn(),
      logTerminal: vi.fn()
    });

    expect(result).toBe(false);
  });
});
