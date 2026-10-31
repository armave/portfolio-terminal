import { afterEach, describe, expect, it } from 'vitest';
import {
  setAiStatus,
  subscribeAiStatus,
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
    setAiStatus('READY');
    setBreakevenText('Combined Breakeven: 0 days');
    setCloudStatusState({ status: 'idle', text: 'OFFLINE' });
    setCloudSyncStatus({ status: 'idle', text: '' });
    setBoardTitle({ title: 'COMBINED PORTFOLIO', showDailyMove: false });
  });

  it('delivers current snapshots and stops updates after cleanup', () => {
    setAiStatus('ANALYZING');
    setBreakevenText('Combined Breakeven: 12 days');
    const currentCloudStatus: CloudStatus = { status: 'online', text: 'CONNECTED' };
    const currentCloudSyncStatus: CloudStatus = { status: 'syncing', text: 'UPLOADING' };
    const currentBoardTitle: BoardTitleState = { title: 'AAPL', showDailyMove: true };
    setCloudStatusState(currentCloudStatus);
    setCloudSyncStatus(currentCloudSyncStatus);
    setBoardTitle(currentBoardTitle);

    const receivedAiStatus: string[] = [];
    const receivedBreakevenText: string[] = [];
    const receivedCloudStatus: CloudStatus[] = [];
    const receivedCloudSyncStatus: CloudStatus[] = [];
    const receivedBoardTitle: BoardTitleState[] = [];

    const unsubscribe = [
      subscribeAiStatus((value) => receivedAiStatus.push(value)),
      subscribeBreakevenText((value) => receivedBreakevenText.push(value)),
      subscribeCloudStatus((value) => receivedCloudStatus.push(value)),
      subscribeCloudSyncStatus((value) => receivedCloudSyncStatus.push(value)),
      subscribeBoardTitle((value) => receivedBoardTitle.push(value))
    ];

    expect(receivedAiStatus).toEqual(['ANALYZING']);
    expect(receivedBreakevenText).toEqual(['Combined Breakeven: 12 days']);
    expect(receivedCloudStatus).toEqual([currentCloudStatus]);
    expect(receivedCloudSyncStatus).toEqual([currentCloudSyncStatus]);
    expect(receivedBoardTitle).toEqual([currentBoardTitle]);

    setAiStatus('READY');
    setBreakevenText('Combined Breakeven: 14 days');
    setCloudStatusState({ status: 'offline', text: 'OFFLINE' });
    setCloudSyncStatus({ status: 'error', text: 'SYNC FAILED' });
    setBoardTitle({ title: 'MSFT', showDailyMove: false });

    expect(receivedAiStatus).toEqual(['ANALYZING', 'READY']);
    expect(receivedBreakevenText).toEqual(['Combined Breakeven: 12 days', 'Combined Breakeven: 14 days']);
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
    setAiStatus('LOADING');
    setBreakevenText('Combined Breakeven: 15 days');
    setCloudStatusState({ status: 'online', text: 'CONNECTED AGAIN' });
    setCloudSyncStatus({ status: 'idle', text: 'SYNCED' });
    setBoardTitle({ title: 'NVDA', showDailyMove: true });

    expect(receivedAiStatus).toHaveLength(2);
    expect(receivedBreakevenText).toHaveLength(2);
    expect(receivedCloudStatus).toHaveLength(2);
    expect(receivedCloudSyncStatus).toHaveLength(2);
    expect(receivedBoardTitle).toHaveLength(2);
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
