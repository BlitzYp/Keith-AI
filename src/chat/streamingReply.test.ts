import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StreamingReply, splitForDiscord, type PostedMessage, type ReplyTarget } from './streamingReply.js';

/**
 * Stands in for a Discord message. Every message posted under it is recorded in `posts`, in
 * order, with its latest content, and every call is logged so tests can count edits.
 */
function fakeChannel() {
  const posts: { content: string }[] = [];
  const log: string[] = [];

  const post = (content: string): PostedMessage => {
    const record = { content };
    posts.push(record);
    log.push(`post #${posts.length}`);
    const index = posts.length;
    return {
      edit: async (newContent) => {
        record.content = newContent;
        log.push(`edit #${index}`);
      },
      reply: async (replyContent) => post(replyContent),
    };
  };

  const userMessage: ReplyTarget = { reply: async (content) => post(content) };
  return { userMessage, posts, log };
}

describe('splitForDiscord', () => {
  it('keeps text that fits in one message as it is', () => {
    assert.deepEqual(splitForDiscord('short reply', 20), ['short reply']);
  });

  it('breaks at a newline near the limit', () => {
    assert.deepEqual(splitForDiscord('first line here\nsecond', 20), ['first line here', 'second']);
  });

  it('breaks at a space when there is no newline near the limit', () => {
    assert.deepEqual(splitForDiscord('one two three four five', 10), ['one two', 'three four', 'five']);
  });

  it('cuts mid-word only when a word is longer than half a message', () => {
    // No space or newline in the second half of the 10 characters, so it cuts at exactly 10.
    assert.deepEqual(splitForDiscord('abcdefghijklmno', 10), ['abcdefghij', 'klmno']);
  });
});

describe('StreamingReply', () => {
  it('posts the first text straight away, then shows the final text when finished', async () => {
    const { userMessage, posts } = fakeChannel();
    const reply = new StreamingReply(userMessage);
    reply.update('Hel');
    reply.update('Hello there');
    await reply.finish();
    assert.deepEqual(posts, [{ content: 'Hello there' }]);
  });

  it('edits at most about once a second while the reply streams in', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { userMessage, log } = fakeChannel();
    const reply = new StreamingReply(userMessage);

    reply.update('One');
    t.mock.timers.tick(0); // the first post isn't throttled
    await settle();
    reply.update('One two');
    reply.update('One two three');
    t.mock.timers.tick(999);
    await settle();
    assert.deepEqual(log, ['post #1'], 'no edit before a second has passed');

    t.mock.timers.tick(1);
    await settle();
    assert.deepEqual(log, ['post #1', 'edit #1'], 'one edit with the latest text, not one per update');
  });

  it('continues in a reply to its own message when the text passes the length limit', async () => {
    const { userMessage, posts } = fakeChannel();
    const reply = new StreamingReply(userMessage, { maxLength: 10 });
    reply.update('one two three four five');
    await reply.finish();
    assert.deepEqual(posts, [{ content: 'one two' }, { content: 'three four' }, { content: 'five' }]);
  });

  it('does not post anything for whitespace-only text', async () => {
    const { userMessage, posts } = fakeChannel();
    const reply = new StreamingReply(userMessage);
    reply.update('   ');
    await reply.finish();
    assert.deepEqual(posts, []);
  });
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
