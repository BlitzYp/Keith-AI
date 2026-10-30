import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hideThinking } from './thinking.js';

/** Feeds `chunks` through hideThinking and collects every "reply so far" it yields. */
async function replySoFarAfterEachChunk(chunks: string[]): Promise<string[]> {
  async function* stream() {
    yield* chunks;
  }
  const seen: string[] = [];
  for await (const replySoFar of hideThinking(stream())) seen.push(replySoFar);
  return seen;
}

describe('hideThinking', () => {
  it('passes a normal reply through, growing with each chunk', async () => {
    assert.deepEqual(await replySoFarAfterEachChunk(['Hello', ' there', '!']), [
      'Hello',
      'Hello there',
      'Hello there!',
    ]);
  });

  it('hides a <think> block at the start, even while it is still open', async () => {
    assert.deepEqual(await replySoFarAfterEachChunk(['<think>let me', ' ponder</think>', 'Sure thing.']), [
      // Nothing visible while thinking, so nothing is yielded until the real reply starts.
      'Sure thing.',
    ]);
  });

  it('never shows a tag split across chunks, even for a moment', async () => {
    // Models stream "<", "thi", "nk>" as separate chunks. Showing "<thi" and then removing it would
    // make the Discord message flicker and confuse the speech, which only ever adds text.
    const seen = await replySoFarAfterEachChunk(['Hi friend. <', 'thi', 'nk>hmm</think>', ' Bye now.']);
    assert.deepEqual(seen, ['Hi friend. ', 'Hi friend.  Bye now.']);
    for (const replySoFar of seen) assert.ok(!replySoFar.includes('<'), `leaked a tag: ${replySoFar}`);
  });

  it('shows a "<" at the very end once the reply is over, since it was not a tag after all', async () => {
    assert.deepEqual(await replySoFarAfterEachChunk(['I ', 'love you <']), ['I ', 'I love you ', 'I love you <']);
  });

  it('only ever grows the reply, so the speech can follow it by appending', async () => {
    const seen = await replySoFarAfterEachChunk([
      '<think>plan</think>First part. ',
      'Mid <thi',
      'nk>aside</think>',
      'second part!',
    ]);
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i]!.startsWith(seen[i - 1]!), `"${seen[i]}" does not extend "${seen[i - 1]}"`);
    }
    assert.equal(seen.at(-1), 'First part. Mid second part!');
  });
});
