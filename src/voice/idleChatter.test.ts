import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { IdleChatter, type IdleChatterOptions } from './idleChatter.js';

const SECOND = 1000;

/** Chatter with fake time and a fixed "random" number, so each test knows exactly when it speaks. */
function setUp(overrides: Partial<IdleChatterOptions> = {}) {
  const said: string[] = [];
  const chatter = new IdleChatter({
    phrases: ['one', 'two', 'three'],
    say: (text) => said.push(text),
    minQuietMs: 60 * SECOND,
    maxQuietMs: 120 * SECOND,
    random: () => 0, // shortest wait, first phrase
    ...overrides,
  });
  return { chatter, said };
}

describe('IdleChatter', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('says nothing until it is started', () => {
    const { said } = setUp();
    mock.timers.tick(10 * 60 * SECOND);
    assert.deepEqual(said, []);
  });

  it('says a phrase once the channel has been quiet for a while', () => {
    const { chatter, said } = setUp();
    chatter.start();
    mock.timers.tick(59 * SECOND);
    assert.deepEqual(said, [], 'not yet');
    mock.timers.tick(1 * SECOND);
    assert.deepEqual(said, ['one']);
  });

  it('waits a random time between the shortest and longest wait', () => {
    // random() = 0.5 is halfway: 60 s + 0.5 × (120 s − 60 s) = 90 s.
    const { chatter, said } = setUp({ random: () => 0.5 });
    chatter.start();
    mock.timers.tick(89 * SECOND);
    assert.equal(said.length, 0);
    mock.timers.tick(1 * SECOND);
    assert.equal(said.length, 1);
  });

  it('starts waiting all over again whenever someone talks', () => {
    const { chatter, said } = setUp();
    chatter.start();
    mock.timers.tick(50 * SECOND);
    chatter.heardActivity(); // someone spoke: the quiet stretch starts again
    mock.timers.tick(50 * SECOND);
    assert.deepEqual(said, [], '100 s since start, but only 50 s of quiet');
    mock.timers.tick(10 * SECOND);
    assert.deepEqual(said, ['one']);
  });

  it('keeps going: another phrase after the next quiet stretch', () => {
    let next = 0;
    const randoms = [0, 0, 0, 0.5]; // wait, phrase, wait, phrase
    const { chatter, said } = setUp({ random: () => randoms[next++ % randoms.length]! });
    chatter.start();
    mock.timers.tick(60 * SECOND);
    mock.timers.tick(60 * SECOND);
    assert.equal(said.length, 2);
  });

  it('never says the same phrase twice in a row', () => {
    const { chatter, said } = setUp({ random: () => 0 }); // would pick 'one' every time
    chatter.start();
    for (let i = 0; i < 4; i++) mock.timers.tick(60 * SECOND);
    assert.equal(said.length, 4);
    for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1]);
  });

  it('goes quiet for good once stopped', () => {
    const { chatter, said } = setUp();
    chatter.start();
    chatter.stop();
    chatter.heardActivity(); // talking after stop() mustn't wake it up
    mock.timers.tick(10 * 60 * SECOND);
    assert.deepEqual(said, []);
  });

  it('can be started twice without speaking twice as often', () => {
    const { chatter, said } = setUp();
    chatter.start();
    chatter.start();
    mock.timers.tick(60 * SECOND);
    assert.equal(said.length, 1);
  });
});
