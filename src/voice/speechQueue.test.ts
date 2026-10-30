import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { SpeechQueue } from './speechQueue.js';

/**
 * A SpeechQueue with fake synthesis and playback. Synthesis of "x" makes the file "x.wav" but only
 * when the test calls `finishSynthesis("x")`, so tests control the order things complete in.
 */
function fakeQueue() {
  const log: string[] = [];
  const pendingSynthesis = new Map<string, { resolve: (file: string) => void; reject: (err: Error) => void }>();
  let finishPlaying: (() => void) | null = null;

  const queue = new SpeechQueue({
    synthesize: (text) =>
      new Promise((resolve, reject) => {
        log.push(`synthesize ${text}`);
        pendingSynthesis.set(text, { resolve, reject });
      }),
    play: (file) =>
      new Promise((resolve) => {
        log.push(`play ${file}`);
        finishPlaying = resolve;
      }),
    stopPlaying: () => {
      log.push('stop playing');
      finishPlaying?.();
    },
    deleteFile: async (file) => {
      log.push(`delete ${file}`);
    },
  });

  return {
    queue,
    log,
    finishSynthesis: async (text: string) => {
      pendingSynthesis.get(text)!.resolve(`${text}.wav`);
      await settle();
    },
    failSynthesis: async (text: string) => {
      pendingSynthesis.get(text)!.reject(new Error('piper broke'));
      await settle();
    },
    finishPlaying: async () => {
      finishPlaying!();
      finishPlaying = null;
      await settle();
    },
  };
}

/** Lets the queue's promise chain run until it is waiting on something again. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const quietConsoleErrors = (t: TestContext) => t.mock.method(console, 'error', () => {});

describe('SpeechQueue', () => {
  it('starts synthesizing every sentence right away, but plays them one at a time in order', async () => {
    const { queue, log, finishSynthesis, finishPlaying } = fakeQueue();
    queue.speak('one');
    queue.speak('two');
    assert.deepEqual(log, ['synthesize one', 'synthesize two']);

    // "two" is ready first, but must wait for "one".
    await finishSynthesis('two');
    assert.deepEqual(log, ['synthesize one', 'synthesize two']);

    await finishSynthesis('one');
    assert.deepEqual(log.slice(2), ['play one.wav']);

    await finishPlaying();
    assert.deepEqual(log.slice(3), ['delete one.wav', 'play two.wav']);

    await finishPlaying();
    assert.deepEqual(log.slice(5), ['delete two.wav']);
  });

  it('cleans text for speech before synthesizing, and skips text with nothing to say', async () => {
    const { queue, log } = fakeQueue();
    queue.speak('**Hello** <@123>');
    queue.speak('** **');
    assert.deepEqual(log, ['synthesize Hello']);
  });

  it('stop() cuts off the current sentence and drops the rest, deleting every file', async () => {
    const { queue, log, finishSynthesis } = fakeQueue();
    queue.speak('one');
    queue.speak('two');
    await finishSynthesis('one'); // playing "one"; "two" is still being synthesized

    queue.stop();
    await settle();
    await finishSynthesis('two'); // finishes after stop(): never played, but still deleted

    assert.deepEqual(log.slice(2), ['play one.wav', 'stop playing', 'delete one.wav', 'delete two.wav']);
  });

  it('speaks normally again after stop()', async () => {
    const { queue, log, finishSynthesis } = fakeQueue();
    queue.stop();
    queue.speak('again');
    await finishSynthesis('again');
    assert.deepEqual(log, ['stop playing', 'synthesize again', 'play again.wav']);
  });

  it('skips a sentence that failed to synthesize and plays the next one', async (t) => {
    quietConsoleErrors(t);
    const { queue, log, finishSynthesis, failSynthesis } = fakeQueue();
    queue.speak('broken');
    queue.speak('fine');
    await failSynthesis('broken');
    await finishSynthesis('fine');
    assert.deepEqual(log.slice(2), ['play fine.wav']);
  });
});

describe('SpeechQueue.startReply', () => {
  it('speaks a streaming reply sentence by sentence', async () => {
    const { queue, log } = fakeQueue();
    const reply = queue.startReply();
    reply.update('This is the first sentence. And');
    reply.update('This is the first sentence. And this is the second one.');
    reply.finish();
    assert.deepEqual(log, [
      'synthesize This is the first sentence.',
      'synthesize And this is the second one.',
    ]);
  });

  it('goes quiet for the rest of the reply once stop() is called', async () => {
    const { queue, log } = fakeQueue();
    const reply = queue.startReply();
    reply.update('This is the first sentence. ');
    queue.stop(); // someone ran /shutup while the reply was still being written
    reply.update('This is the first sentence. This one should never be heard. ');
    reply.finish();
    assert.deepEqual(log, ['synthesize This is the first sentence.', 'stop playing']);
  });

  it('does not affect a reply started after stop()', async () => {
    const { queue, log } = fakeQueue();
    queue.stop();
    const reply = queue.startReply();
    reply.update('A brand new reply here.');
    reply.finish();
    assert.deepEqual(log, ['stop playing', 'synthesize A brand new reply here.']);
  });
});
