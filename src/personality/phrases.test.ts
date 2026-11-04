import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IDLE_PHRASES } from './phrases.js';

describe('IDLE_PHRASES', () => {
  it('has enough lines that they rarely repeat', () => {
    assert.ok(IDLE_PHRASES.length >= 30, `only ${IDLE_PHRASES.length}`);
  });

  it('has no line twice', () => {
    assert.equal(new Set(IDLE_PHRASES).size, IDLE_PHRASES.length);
  });

  it('keeps every line short enough to blurt out (under 160 characters)', () => {
    for (const phrase of IDLE_PHRASES) assert.ok(phrase.length < 160, phrase);
  });
});
