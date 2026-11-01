import { describe, expect, it } from 'vitest';
import { isTerminalLogAtBottom, TERMINAL_LOG_FOLLOW_THRESHOLD_PX } from './TerminalLog';

describe('isTerminalLogAtBottom', () => {
  it('recognizes when the reader is at the latest entry', () => {
    expect(isTerminalLogAtBottom({ scrollTop: 500, scrollHeight: 700, clientHeight: 200 })).toBe(true);
    expect(isTerminalLogAtBottom({ scrollTop: 476, scrollHeight: 700, clientHeight: 200 })).toBe(true);
  });

  it('does not follow new output while the reader is reviewing older entries', () => {
    expect(isTerminalLogAtBottom({ scrollTop: 420, scrollHeight: 700, clientHeight: 200 })).toBe(false);
  });

  it('uses a small default tolerance for fractional scroll positions', () => {
    expect(TERMINAL_LOG_FOLLOW_THRESHOLD_PX).toBe(24);
    expect(isTerminalLogAtBottom({ scrollTop: 475.5, scrollHeight: 700, clientHeight: 200 })).toBe(true);
  });

  it('handles overscroll and invalid negative tolerances safely', () => {
    expect(isTerminalLogAtBottom({ scrollTop: 520, scrollHeight: 700, clientHeight: 200 })).toBe(true);
    expect(isTerminalLogAtBottom({ scrollTop: 475, scrollHeight: 700, clientHeight: 200 }, -10)).toBe(false);
  });
});
