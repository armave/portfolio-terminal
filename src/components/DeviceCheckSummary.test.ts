import { describe, expect, it } from 'vitest';
import {
  checkLocalStorageAvailability,
  getBrowserLabel,
  getCloudStorageLabel,
  getDeviceHealth,
  getDeviceTypeLabel,
  getOperatingSystemLabel,
  getPortfolioSyncLabel
} from './DeviceCheckSummary';

describe('Device Check summary diagnostics', () => {
  it.each([
    ['Mozilla/5.0 Chrome/126.0 Safari/537.36', 'Chrome'],
    ['Mozilla/5.0 Edg/126.0 Chrome/126.0 Safari/537.36', 'Microsoft Edge'],
    ['Mozilla/5.0 Firefox/126.0', 'Firefox'],
    ['Mozilla/5.0 Version/17.0 Safari/605.1', 'Safari'],
    ['unknown browser agent', 'Unknown browser']
  ])('identifies browser for %s', (userAgent, expected) => {
    expect(getBrowserLabel(userAgent)).toBe(expected);
  });

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, 'Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'MacIntel', 0, 'macOS'],
    ['Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 0, 'Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 0, 'iOS / iPadOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5, 'iOS / iPadOS']
  ])('identifies operating system for %s', (ua, platform, touches, expected) => {
    expect(getOperatingSystemLabel(ua, platform, touches)).toBe(expected);
  });

  it('classifies common mobile and tablet user agents', () => {
    expect(getDeviceTypeLabel('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile')).toBe('Mobile');
    expect(getDeviceTypeLabel('Mozilla/5.0 (Linux; Android 14; Pixel Tablet)')).toBe('Tablet');
    expect(getDeviceTypeLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('Tablet');
    expect(getDeviceTypeLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Desktop');
  });

  it('checks local storage without leaving the temporary test value behind', () => {
    const data = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => data.set(key, value),
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => { data.delete(key); }
    };
    expect(checkLocalStorageAvailability(storage)).toBe(true);
    expect(data.size).toBe(0);
  });

  it('reports unavailable storage when writes throw', () => {
    const storage = {
      setItem: () => { throw new Error('Storage blocked'); },
      getItem: () => null,
      removeItem: () => undefined
    };
    expect(checkLocalStorageAvailability(storage)).toBe(false);
  });

  it('keeps cloud storage state separate from portfolio sync state', () => {
    expect(getCloudStorageLabel({ status: 'synced', text: 'UPDATED' })).toBe('Available');
    expect(getCloudStorageLabel({ status: 'idle', text: 'ADD SECRET' })).toBe('Setup required');
    expect(getCloudStorageLabel({ status: 'error', text: 'FAIL' })).toBe('Unavailable');
    expect(getPortfolioSyncLabel({ status: 'synced', text: 'Synced' })).toBe('Synced');
    expect(getPortfolioSyncLabel({ status: 'error', text: 'Sync failed' })).toBe('Failed');
  });

  it('summarizes device readiness without treating offline as local storage failure', () => {
    expect(getDeviceHealth({
      online: true, localStorageAvailable: true, secureContext: true
    }, { status: 'synced', text: 'UPDATED' }, { status: 'synced', text: 'Synced' })).toBe('ready');
    expect(getDeviceHealth({
      online: false, localStorageAvailable: true, secureContext: true
    }, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('offline');
    expect(getDeviceHealth({
      online: true, localStorageAvailable: false, secureContext: true
    }, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('attention');
    expect(getDeviceHealth({
      online: true, localStorageAvailable: true, secureContext: false
    }, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('attention');
    expect(getDeviceHealth({
      online: true, localStorageAvailable: true, secureContext: true
    }, { status: 'synced', text: 'UPDATED' }, { status: 'error', text: 'Sync failed' })).toBe('attention');
  });
});
