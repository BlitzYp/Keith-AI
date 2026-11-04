import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { Ducker } from './ducker.js';

/** A ducker with fake time, recording every "music down" (true) and "music up" (false). */
function setUp() {
  const sent: boolean[] = [];
  const ducker = new Ducker({ setDucked: (on) => sent.push(on), releaseAfterMs: 800, refreshEveryMs: 10_000 });
  return { ducker, sent };
}

describe('Ducker', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'] }));
  afterEach(() => mock.timers.reset());

  it('turns the music down as soon as Keith starts speaking', () => {
    const { ducker, sent } = setUp();
    ducker.speaking();
    assert.deepEqual(sent, [true]);
  });

  it("doesn't ask again for every sentence while the music is already down", () => {
    const { ducker, sent } = setUp();
    ducker.speaking();
    ducker.quiet();
    mock.timers.tick(200);
    ducker.speaking(); // the next sentence, 200 ms later
    assert.deepEqual(sent, [true]);
  });

  it('turns the music back up a moment after Keith stops', () => {
    const { ducker, sent } = setUp();
    ducker.speaking();
    ducker.quiet();
    mock.timers.tick(799);
    assert.deepEqual(sent, [true], 'not yet: another sentence may be coming');
    mock.timers.tick(1);
    assert.deepEqual(sent, [true, false]);
  });

  it('keeps the music down through the short gaps between sentences', () => {
    const { ducker, sent } = setUp();
    ducker.speaking();
    ducker.quiet();
    mock.timers.tick(500);
    ducker.speaking();
    mock.timers.tick(5000);
    assert.deepEqual(sent, [true], 'still speaking: no "music up" yet');
  });

  it('reminds the music bot during a long speech, since Brick lets the music back up after 20 s by himself', () => {
    const { ducker, sent } = setUp();
    ducker.speaking();
    mock.timers.tick(11_000);
    ducker.speaking(); // a sentence starting 11 s in
    assert.deepEqual(sent, [true, true]);
  });

  it('turns the music up at once when stopped (e.g. Keith left the channel)', () => {
    const { ducker, sent } = setUp();
    ducker.speaking();
    ducker.stop();
    mock.timers.tick(10_000);
    assert.deepEqual(sent, [true, false]);
  });

  it('does nothing when stopped while the music was not down', () => {
    const { ducker, sent } = setUp();
    ducker.stop();
    assert.deepEqual(sent, []);
  });
});
