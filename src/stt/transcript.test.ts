import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTranscript, withoutEchoedPrompt } from './transcript.js';

describe('withoutEchoedPrompt', () => {
  // Whisper is given a prompt ("Hey Keith.") so it spells the name right. On near-silence it
  // sometimes just writes the prompt back, which in name mode would look like someone calling Keith.
  it('turns a transcript that only repeats the prompt into nothing', () => {
    assert.equal(withoutEchoedPrompt(' Hey Keith. ', 'Hey Keith.'), '');
    assert.equal(withoutEchoedPrompt('hey keith', 'Hey Keith.'), '', 'case and punctuation aside');
  });

  it('keeps a real sentence that starts like the prompt', () => {
    assert.equal(withoutEchoedPrompt('Hey Keith, what time is it?', 'Hey Keith.'), 'Hey Keith, what time is it?');
  });

  it('keeps everything when there is no prompt', () => {
    assert.equal(withoutEchoedPrompt('Hey Keith.', undefined), 'Hey Keith.');
  });
});

describe('cleanTranscript', () => {
  it('trims the spaces Whisper leaves around its text', () => {
    assert.equal(cleanTranscript('  Hey Keith, how are you?  '), 'Hey Keith, how are you?');
  });

  it('drops sound descriptions like [BLANK_AUDIO], (music) and *coughs*', () => {
    assert.equal(cleanTranscript('[BLANK_AUDIO]'), '');
    assert.equal(cleanTranscript('(upbeat music)'), '');
    assert.equal(cleanTranscript('*coughs*'), '');
  });

  it('keeps the words around a sound description', () => {
    assert.equal(cleanTranscript('[Music] What time is it?'), 'What time is it?');
  });

  it("drops the phrases Whisper makes up from noise (it learned them from video subtitles)", () => {
    assert.equal(cleanTranscript('Thanks for watching!'), '');
    assert.equal(cleanTranscript(' you'), '');
    assert.equal(cleanTranscript('Thank you.'), '');
    assert.equal(cleanTranscript('Subtitles by the Amara.org community'), '');
  });

  it('keeps real sentences that only contain those words', () => {
    assert.equal(cleanTranscript('Thank you for the help, Keith.'), 'Thank you for the help, Keith.');
  });

  it('treats punctuation on its own as nothing said', () => {
    assert.equal(cleanTranscript(' ... '), '');
  });
});
