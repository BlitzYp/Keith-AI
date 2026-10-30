import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelLock } from './channelLock.js';

/** A task that logs when it starts and ends, and only ends when the test says so. */
function controllableTask(name: string, log: string[]) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const run = async () => {
    log.push(`start ${name}`);
    await done;
    log.push(`end ${name}`);
  };
  return { run, finish };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ChannelLock', () => {
  it('runs tasks for the same channel one at a time, in the order they arrived', async () => {
    const lock = new ChannelLock();
    const log: string[] = [];
    const first = controllableTask('first', log);
    const second = controllableTask('second', log);

    const both = Promise.all([lock.run('channel', first.run), lock.run('channel', second.run)]);
    await settle();
    assert.deepEqual(log, ['start first'], 'second waits for first');

    first.finish();
    second.finish();
    await both;
    assert.deepEqual(log, ['start first', 'end first', 'start second', 'end second']);
  });

  it('runs tasks for different channels at the same time', async () => {
    const lock = new ChannelLock();
    const log: string[] = [];
    const a = controllableTask('a', log);
    const b = controllableTask('b', log);

    const both = Promise.all([lock.run('channel-a', a.run), lock.run('channel-b', b.run)]);
    await settle();
    assert.deepEqual(log, ['start a', 'start b']);

    a.finish();
    b.finish();
    await both;
  });

  it('keeps going after a task fails, and still reports the failure to its caller', async () => {
    const lock = new ChannelLock();
    const failing = lock.run('channel', async () => {
      throw new Error('boom');
    });
    const next = lock.run('channel', async () => 'still runs');

    await assert.rejects(failing, /boom/);
    assert.equal(await next, 'still runs');
  });
});
