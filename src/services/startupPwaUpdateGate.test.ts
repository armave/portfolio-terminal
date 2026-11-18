import { describe, expect, it, vi } from 'vitest';
import { createStartupPwaUpdateGate } from './startupPwaUpdateGate';

describe('startup PWA update gate', () => {
  it('automatically applies an update discovered during initial startup', () => {
    const gate = createStartupPwaUpdateGate();
    const applyUpdate = vi.fn();

    expect(gate.applyDuringStartup(applyUpdate)).toBe(true);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not apply an update more than once during one startup', () => {
    const gate = createStartupPwaUpdateGate();
    const applyUpdate = vi.fn();

    expect(gate.applyDuringStartup(applyUpdate)).toBe(true);
    expect(gate.applyDuringStartup(applyUpdate)).toBe(false);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('defers updates discovered after startup for automatic application next launch', () => {
    const gate = createStartupPwaUpdateGate();
    const applyUpdate = vi.fn();
    gate.closeStartupWindow();

    expect(gate.applyDuringStartup(applyUpdate)).toBe(false);
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
