import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PromptFile } from './promptFile.js';

/** A fake file system with one file whose text the test can change, or make unreadable. */
function fakeFile(initial: string | null) {
  const file = { text: initial };
  const readFile = (path: string) => {
    if (file.text === null) throw new Error(`ENOENT: no such file, open '${path}'`);
    return file.text;
  };
  return { file, readFile };
}

describe('PromptFile', () => {
  it("puts the bot's name wherever the file says {{name}}", () => {
    const { readFile } = fakeFile('You are {{name}}. {{name}} is a god.');
    assert.equal(new PromptFile('keith.md', 'Keith', readFile).get(), 'You are Keith. Keith is a god.');
  });

  it('leaves out <!-- comments -->, so the file can hold notes for whoever edits it', () => {
    const { readFile } = fakeFile('<!-- Tip: keep it short. -->\nYou are {{name}}.\n<!--\nmore notes\n-->');
    assert.equal(new PromptFile('keith.md', 'Keith', readFile).get(), 'You are Keith.');
  });

  it('picks up edits to the file without a restart', () => {
    const { file, readFile } = fakeFile('Be nice.');
    const prompt = new PromptFile('keith.md', 'Keith', readFile);
    assert.equal(prompt.get(), 'Be nice.');
    file.text = 'Be ominous.';
    assert.equal(prompt.get(), 'Be ominous.');
  });

  it('keeps using the last good prompt if the file becomes unreadable later (e.g. mid-save)', () => {
    const { file, readFile } = fakeFile('Be ominous.');
    const prompt = new PromptFile('keith.md', 'Keith', readFile);
    prompt.get();
    file.text = null;
    assert.equal(prompt.get(), 'Be ominous.');
    file.text = '   ';
    assert.equal(prompt.get(), 'Be ominous.', 'an empty file counts as unreadable too');
  });

  it('fails at startup with an error that names the file, when there is no prompt to fall back on', () => {
    const { readFile } = fakeFile(null);
    assert.throws(() => new PromptFile('prompts/missing.md', 'Keith', readFile), /prompts\/missing\.md/);
  });
});
