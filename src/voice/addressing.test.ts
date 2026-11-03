import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldAnswer } from './addressing.js';

describe('shouldAnswer', () => {
  it('answers anything in "everyone" mode', () => {
    assert.equal(shouldAnswer('what are we playing tonight', 'everyone', 'Keith'), true);
  });

  it('answers a sentence with the name in it in "name" mode', () => {
    assert.equal(shouldAnswer("Hey Keith, what's up?", 'name', 'Keith'), true);
  });

  it('ignores a sentence without the name in "name" mode', () => {
    assert.equal(shouldAnswer('what are we playing tonight', 'name', 'Keith'), false);
  });

  it('finds the name whatever the case or punctuation around it', () => {
    assert.equal(shouldAnswer('KEITH!', 'name', 'Keith'), true);
    assert.equal(shouldAnswer('ok keith.', 'name', 'Keith'), true);
    assert.equal(shouldAnswer('what is keith’s opinion', 'name', 'Keith'), true); // curly apostrophe
    assert.equal(shouldAnswer("Keith's turn", 'name', 'Keith'), true);
  });

  it('counts a one-letter misspelling as the name, since Whisper writes "Keeith" or "Keth" now and then', () => {
    assert.equal(shouldAnswer('Okay, Keeith.', 'name', 'Keith'), true);
    assert.equal(shouldAnswer('hey keth are you there', 'name', 'Keith'), true);
  });

  it('does not stretch short names that way: "Bo" is not "Bob"', () => {
    assert.equal(shouldAnswer('hey bo', 'name', 'Bob'), false);
  });

  it('does not count the name hidden inside another word', () => {
    assert.equal(shouldAnswer('my Keithley multimeter', 'name', 'Keith'), false);
  });

  it('uses whatever name Keith has been given (BOT_NAME)', () => {
    assert.equal(shouldAnswer('hey Bob', 'name', 'Bob'), true);
    assert.equal(shouldAnswer('hey Keith', 'name', 'Bob'), false);
  });
});
