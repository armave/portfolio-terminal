import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionGuard } from './commandExecutionGuard';

describe('terminal command execution guard', () => {
  it('ignores normalized duplicate submissions while the first command is pending', async () => {
    const guard = new CommandExecutionGuard();
    let release!: (value: string) => void;
    const execute = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));

    const first = guard.run(' bought 2 AAPL for 100 ', execute);
    await Promise.resolve();

    const duplicateExecute = vi.fn(() => 'must not run');
    const duplicate = await guard.run('BOUGHT   2 AAPL FOR 100', duplicateExecute);

    expect(duplicate).toEqual({ status: 'duplicate' });
    expect(execute).toHaveBeenCalledOnce();
    expect(duplicateExecute).not.toHaveBeenCalled();

    release('committed');
    await expect(first).resolves.toEqual({ status: 'executed', value: 'committed' });
  });

  it('allows a command to run again after the prior execution completes', async () => {
    const guard = new CommandExecutionGuard();
    const execute = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    await expect(guard.run('sold all AAPL for 120', execute))
      .resolves.toEqual({ status: 'executed', value: 'first' });
    await expect(guard.run('sold all AAPL for 120', execute))
      .resolves.toEqual({ status: 'executed', value: 'second' });

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('releases a command key when execution fails', async () => {
    const guard = new CommandExecutionGuard();
    const failure = new Error('persistence failed');

    await expect(guard.run('bought 1 AAPL for 100', () => { throw failure; }))
      .rejects.toBe(failure);
    await expect(guard.run('bought 1 AAPL for 100', () => 'retry'))
      .resolves.toEqual({ status: 'executed', value: 'retry' });
  });

  it('does not block a different command while one command is pending', async () => {
    const guard = new CommandExecutionGuard();
    let release!: () => void;
    const first = guard.run('bought 1 AAPL for 100', () => new Promise<void>((resolve) => { release = resolve; }));

    await expect(guard.run('bought 1 MSFT for 200', () => 'independent'))
      .resolves.toEqual({ status: 'executed', value: 'independent' });

    release();
    await expect(first).resolves.toEqual({ status: 'executed', value: undefined });
  });
});
