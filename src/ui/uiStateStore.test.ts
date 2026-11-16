import { afterEach, describe, expect, it } from 'vitest';
import {
  setBreakevenText,
  subscribeBreakevenText,
  setCloudStatusState,
  subscribeCloudStatus,
  setCloudSyncStatus,
  subscribeCloudSyncStatus,
  setAnalystConsensus,
  subscribeAnalystConsensus,
  setBoardTitle,
  subscribeBoardTitle,
  type AnalystConsensusState,
  type CloudStatus,
  type BoardTitleState
} from './uiStateStore';

const HIDDEN_STATE: AnalystConsensusState = {
  text: '',
  title: '',
  className: 'hidden'
};

afterEach(() => {
  setAnalystConsensus(HIDDEN_STATE);
});

describe('runtime presentation store subscriptions', () => {
  afterEach(() => {
    setBreakevenText('Breakeven: 0 days');
    setCloudStatusState({ status: 'idle', text: 'OFFLINE' });
    setCloudSyncStatus({ status: 'idle', text: '', lastSyncedAt: null });
    setBoardTitle({ title: 'COMBINED PORTFOLIO', showDailyMove: false });
  });

  it('delivers current snapshots and stops updates after cleanup', () => {
    setBreakevenText('Breakeven: 12 days');
    const currentCloudStatus: CloudStatus = { status: 'online', text: 'CONNECTED' };
    const currentCloudSyncStatus: CloudStatus = { status: 'syncing', text: 'UPLOADING' };
    const currentBoardTitle: BoardTitleState = { title: 'AAPL', showDailyMove: true };
    setCloudStatusState(currentCloudStatus);
    setCloudSyncStatus(currentCloudSyncStatus);
    setBoardTitle(currentBoardTitle);

    const receivedBreakevenText: string[] = [];
    const receivedCloudStatus: CloudStatus[] = [];
    const receivedCloudSyncStatus: CloudStatus[] = [];
    const receivedBoardTitle: BoardTitleState[] = [];

    const unsubscribe = [
      subscribeBreakevenText((value) => receivedBreakevenText.push(value)),
      subscribeCloudStatus((value) => receivedCloudStatus.push(value)),
      subscribeCloudSyncStatus((value) => receivedCloudSyncStatus.push(value)),
      subscribeBoardTitle((value) => receivedBoardTitle.push(value))
    ];

    expect(receivedBreakevenText).toEqual(['Breakeven: 12 days']);
    expect(receivedCloudStatus).toEqual([currentCloudStatus]);
    expect(receivedCloudSyncStatus).toEqual([currentCloudSyncStatus]);
    expect(receivedBoardTitle).toEqual([currentBoardTitle]);

    setBreakevenText('Breakeven: 14 days');
    setCloudStatusState({ status: 'offline', text: 'OFFLINE' });
    setCloudSyncStatus({ status: 'error', text: 'SYNC FAILED' });
    setBoardTitle({ title: 'MSFT', showDailyMove: false });

    expect(receivedBreakevenText).toEqual(['Breakeven: 12 days', 'Breakeven: 14 days']);
    expect(receivedCloudStatus).toEqual([
      currentCloudStatus,
      { status: 'offline', text: 'OFFLINE' }
    ]);
    expect(receivedCloudSyncStatus).toEqual([
      currentCloudSyncStatus,
      { status: 'error', text: 'SYNC FAILED' }
    ]);
    expect(receivedBoardTitle).toEqual([
      currentBoardTitle,
      { title: 'MSFT', showDailyMove: false }
    ]);

    unsubscribe.forEach((cleanup) => cleanup());
    setBreakevenText('Breakeven: 15 days');
    setCloudStatusState({ status: 'online', text: 'CONNECTED AGAIN' });
    setCloudSyncStatus({ status: 'idle', text: 'SYNCED' });
    setBoardTitle({ title: 'NVDA', showDailyMove: true });

    expect(receivedBreakevenText).toHaveLength(2);
    expect(receivedCloudStatus).toHaveLength(2);
    expect(receivedCloudSyncStatus).toHaveLength(2);
    expect(receivedBoardTitle).toHaveLength(2);
  });

  it('publishes separate Margin PT and return fields, then clears them when switching to Combined', () => {
    const updates: BoardTitleState[] = [];
    const unsubscribe = subscribeBoardTitle((value) => updates.push(value));
    setBoardTitle({
      title: 'GOOGL',
      showDailyMove: false,
      shareCount: 68,
      dailyMovePercent: -0.62,
      marginPtValue: '$335.00',
      marginPtReturnText: '+10.15%',
      marginPtTitle: 'Margin PT $335.00'
    });
    setBoardTitle({
      title: 'COMBINED PORTFOLIO (2 Positions)',
      showDailyMove: true,
      shareCount: undefined,
      dailyMovePercent: undefined,
      marginPtValue: '',
      marginPtReturnText: '',
      marginPtTitle: ''
    });
    expect(updates[updates.length - 2]).toMatchObject({
      title: 'GOOGL',
      shareCount: 68,
      dailyMovePercent: -0.62,
      marginPtValue: '$335.00',
      marginPtReturnText: '+10.15%'
    });
    expect(updates[updates.length - 1]).toMatchObject({
      title: 'COMBINED PORTFOLIO (2 Positions)',
      shareCount: undefined,
      dailyMovePercent: undefined,
      marginPtValue: '',
      marginPtReturnText: ''
    });
    unsubscribe();
  });
});

describe('analyst consensus store subscriptions', () => {
  it('delivers a target that was published before the component subscribed', () => {
    const published: AnalystConsensusState = {
      text: 'Yahoo · $215.00 · +12.50%',
      title: 'Target from Yahoo: $215.00 versus current price $191.10.',
      className: 'rounded border border-emerald-800 bg-emerald-950/40 text-emerald-300'
    };
    setAnalystConsensus(published);

    const received: AnalystConsensusState[] = [];
    const unsubscribe = subscribeAnalystConsensus((state) => received.push(state));

    expect(received).toEqual([published]);

    unsubscribe();
  });

  it('notifies subscribers when structured analyst target values change', () => {
    const received: AnalystConsensusState[] = [];
    const unsubscribe = subscribeAnalystConsensus((state) => received.push(state));
    const published: AnalystConsensusState = {
      text: 'Analyst target · Yahoo · $400.00 · +36.09%',
      title: 'Target from Yahoo.',
      className: 'loaded',
      label: 'Analyst (Yahoo)',
      value: '$400.00',
      upsideText: '+36.09%',
      upsideTone: 'positive'
    };
    setAnalystConsensus(published);
    setAnalystConsensus({
      ...published,
      text: 'Analyst target · Yahoo · $405.00 · +37.80%',
      value: '$405.00',
      upsideText: '+37.80%'
    });
    expect(received[received.length - 1]).toMatchObject({
      label: 'Analyst (Yahoo)',
      value: '$405.00',
      upsideText: '+37.80%',
      upsideTone: 'positive'
    });
    unsubscribe();
  });

  it('continues delivering updates while subscribed and stops after cleanup', () => {
    const received: AnalystConsensusState[] = [];
    const unsubscribe = subscribeAnalystConsensus((state) => received.push(state));
    const firstUpdate: AnalystConsensusState = {
      text: 'Checking analyst target…',
      title: '',
      className: 'loading'
    };
    const secondUpdate: AnalystConsensusState = {
      text: 'Yahoo · $220.00 · +15.00%',
      title: 'Target from Yahoo.',
      className: 'loaded'
    };

    setAnalystConsensus(firstUpdate);
    unsubscribe();
    setAnalystConsensus(secondUpdate);

    expect(received).toEqual([HIDDEN_STATE, firstUpdate]);
  });
});


describe('cloud sync last-success timestamp', () => {
  afterEach(() => {
    setCloudSyncStatus({ status: 'idle', text: '', lastSyncedAt: null });
  });

  it('records the time of a confirmed sync and retains it after a later failure', () => {
    const before = Date.now();
    setCloudSyncStatus({ status: 'synced', text: 'Synced' });
    const synced: CloudStatus[] = [];
    const unsubscribe = subscribeCloudSyncStatus((value) => synced.push(value));
    expect(synced[0].lastSyncedAt).toBeGreaterThanOrEqual(before);

    const lastSyncedAt = synced[0].lastSyncedAt;
    setCloudSyncStatus({ status: 'error', text: 'Sync failed' });
    expect(synced[1]).toMatchObject({ status: 'error', lastSyncedAt });

    setCloudSyncStatus({ status: 'conflict', text: 'Cloud sync conflict — recovery required' });
    expect(synced[2]).toMatchObject({ status: 'conflict', lastSyncedAt });

    unsubscribe();
  });

  it('allows an explicit reset of the previous successful timestamp', () => {
    setCloudSyncStatus({ status: 'synced', text: 'Synced', lastSyncedAt: 123 });
    setCloudSyncStatus({ status: 'idle', text: '', lastSyncedAt: null });
    const received: CloudStatus[] = [];
    const unsubscribe = subscribeCloudSyncStatus((value) => received.push(value));
    expect(received[0].lastSyncedAt).toBeNull();
    unsubscribe();
  });
});
