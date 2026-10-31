import { afterEach, describe, expect, it } from 'vitest';
import {
  setAnalystConsensus,
  subscribeAnalystConsensus,
  type AnalystConsensusState
} from './uiStateStore';

const HIDDEN_STATE: AnalystConsensusState = {
  text: '',
  title: '',
  className: 'hidden'
};

afterEach(() => {
  setAnalystConsensus(HIDDEN_STATE);
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
