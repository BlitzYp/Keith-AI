import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SentenceSplitter, cleanForSpeech } from './text.js';

describe('cleanForSpeech', () => {
  it('drops markdown formatting characters', () => {
    assert.equal(cleanForSpeech('**bold** _italic_ ~~gone~~ > quoted'), 'bold italic gone quoted');
  });

  it('replaces code blocks instead of reading code aloud', () => {
    assert.equal(cleanForSpeech('Try this: ```js\nconsole.log(1)\n``` ok?'), 'Try this: (code omitted) ok?');
  });

  it('keeps the text of inline code', () => {
    assert.equal(cleanForSpeech('Run `npm test` now'), 'Run npm test now');
  });

  it('says "a link" instead of reading out URLs', () => {
    assert.equal(cleanForSpeech('See https://example.com/a?b=c for more'), 'See a link for more');
  });

  it('reads a custom emoji by its name and drops raw mentions', () => {
    assert.equal(cleanForSpeech('Nice <:pog:123456> <@987654>'), 'Nice pog');
  });

  it('turns text that is only formatting into an empty string', () => {
    assert.equal(cleanForSpeech('** __ **'), '');
  });
});

describe('SentenceSplitter', () => {
  it('emits a sentence as soon as it ends, keeping the unfinished rest', () => {
    const splitter = new SentenceSplitter();
    assert.deepEqual(splitter.push('This is the first sentence. And the sec'), ['This is the first sentence.']);
    assert.deepEqual(splitter.push('ond one is here! Third'), ['And the second one is here!']);
    assert.equal(splitter.flush(), 'Third');
  });

  it('merges very short sentences forward so TTS does not speak "Hi." on its own', () => {
    // "Hi." is under 12 characters, so it waits and joins the next sentence.
    const splitter = new SentenceSplitter();
    assert.deepEqual(splitter.push('Hi. '), []);
    assert.deepEqual(splitter.push('How are you doing today? '), ['Hi. How are you doing today?']);
  });

  it('always splits at a newline, even after a short line', () => {
    const splitter = new SentenceSplitter();
    assert.deepEqual(splitter.push('Ok\nNext line'), ['Ok']);
    assert.equal(splitter.flush(), 'Next line');
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    const splitter = new SentenceSplitter();
    assert.deepEqual(splitter.push('He said "that is enough." Then left'), ['He said "that is enough."']);
  });

  it('returns null from flush when nothing is left', () => {
    const splitter = new SentenceSplitter();
    splitter.push('A whole sentence here. ');
    assert.equal(splitter.flush(), null);
  });
});
