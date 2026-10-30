// Feature tests: one message in, one reply out, with a fake model, a fake Discord channel and a
// recording voice. Everything between them is the real code.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessage } from '../llm/client.js';
import { hideThinking } from '../llm/thinking.js';
import { SpeechQueue } from '../voice/speechQueue.js';
import { HistoryStore } from './history.js';
import { createResponder, type ChatRequest } from './respond.js';
import type { PostedMessage, ReplyTarget } from './streamingReply.js';

const SYSTEM_PROMPT = 'You are Keith.';

function request(text: string, speaker = 'Alice'): ChatRequest {
  return { guildId: 'guild-1', channelId: 'channel-1', speaker, text };
}

/** A user message in Discord. `replies` gets the final content of each message Keith posts. */
function fakeUserMessage() {
  const replies: string[] = [];
  const post = (content: string): PostedMessage => {
    const index = replies.push(content) - 1;
    return {
      edit: async (newContent) => void (replies[index] = newContent),
      reply: async (replyContent) => post(replyContent),
    };
  };
  const message: ReplyTarget = { reply: async (content) => post(content) };
  return { message, replies };
}

/**
 * A model that streams each reply as the given raw chunks, and records every prompt it got.
 * Like the real streamReply in llm/client.ts, it goes through hideThinking.
 */
function fakeModel(...replies: string[][]) {
  const prompts: ChatMessage[][] = [];
  async function* rawChunks(chunks: string[]) {
    yield* chunks;
  }
  return {
    prompts,
    streamReply(messages: ChatMessage[]) {
      prompts.push(structuredClone(messages));
      return hideThinking(rawChunks(replies[prompts.length - 1] ?? []));
    },
  };
}

/** A voice that records what it would synthesize instead of speaking. */
function fakeVoice() {
  const spoken: string[] = [];
  const queue = new SpeechQueue({
    synthesize: async (text) => {
      spoken.push(text);
      return 'unused.wav';
    },
    play: async () => {},
    stopPlaying: () => {},
    deleteFile: async () => {},
  });
  return { queue, spoken };
}

describe('replying to a message', () => {
  it('posts the model reply and remembers both sides of the conversation', async () => {
    const history = new HistoryStore(20);
    const model = fakeModel(['Hey ', 'Alice!']);
    const respond = createResponder({ systemPrompt: SYSTEM_PROMPT, history, ...model, speechFor: () => undefined });
    const { message, replies } = fakeUserMessage();

    await respond(request('hi keith'), message);

    assert.deepEqual(replies, ['Hey Alice!']);
    assert.deepEqual(model.prompts[0], [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'Alice: hi keith' },
    ]);
    assert.deepEqual(history.get('channel-1'), [
      { role: 'user', content: 'Alice: hi keith' },
      { role: 'assistant', content: 'Hey Alice!' },
    ]);
  });

  it('includes earlier messages from the same channel in the prompt', async () => {
    const history = new HistoryStore(20);
    const model = fakeModel(['First answer.'], ['Second answer.']);
    const respond = createResponder({ systemPrompt: SYSTEM_PROMPT, history, ...model, speechFor: () => undefined });

    await respond(request('first question'), fakeUserMessage().message);
    await respond(request('second question', 'Bob'), fakeUserMessage().message);

    assert.deepEqual(model.prompts[1]!.slice(1), [
      { role: 'user', content: 'Alice: first question' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Bob: second question' },
    ]);
  });

  it('answers two messages in the same channel one after the other, never interleaved', async () => {
    const history = new HistoryStore(20);
    const model = fakeModel(['One.'], ['Two.']);
    const respond = createResponder({ systemPrompt: SYSTEM_PROMPT, history, ...model, speechFor: () => undefined });

    // Both arrive before the first reply is done.
    await Promise.all([
      respond(request('a'), fakeUserMessage().message),
      respond(request('b'), fakeUserMessage().message),
    ]);

    // The second prompt already contains the first exchange.
    assert.equal(model.prompts[1]!.length, 4);
    assert.deepEqual(
      history.get('channel-1').map((m) => m.content),
      ['Alice: a', 'One.', 'Alice: b', 'Two.'],
    );
  });

  it('posts "..." when the model returns nothing visible', async () => {
    const respond = createResponder({
      systemPrompt: SYSTEM_PROMPT,
      history: new HistoryStore(20),
      ...fakeModel([]),
      speechFor: () => undefined,
    });
    const { message, replies } = fakeUserMessage();
    await respond(request('hello?'), message);
    assert.deepEqual(replies, ['...']);
  });

  it('shows the error and forgets the exchange when the model cannot be reached', async (t) => {
    t.mock.method(console, 'error', () => {});
    const history = new HistoryStore(20);
    const respond = createResponder({
      systemPrompt: SYSTEM_PROMPT,
      history,
      // eslint-disable-next-line require-yield
      async *streamReply() {
        throw new Error('connect ECONNREFUSED');
      },
      speechFor: () => undefined,
    });
    const { message, replies } = fakeUserMessage();

    await respond(request('hello?'), message);

    assert.deepEqual(replies, ["(Couldn't reach the model: connect ECONNREFUSED)"]);
    assert.deepEqual(history.get('channel-1'), [], 'a half exchange would confuse the next prompt');
  });
});

describe('speaking the reply in voice', () => {
  it('speaks the reply sentence by sentence when Keith is in voice for this channel', async () => {
    const voice = fakeVoice();
    const respond = createResponder({
      systemPrompt: SYSTEM_PROMPT,
      history: new HistoryStore(20),
      ...fakeModel(['<think>be nice</think>', 'Good morning to you! ', 'How did you sleep?']),
      speechFor: () => voice.queue.startReply(),
    });

    await respond(request('morning'), fakeUserMessage().message);

    assert.deepEqual(voice.spoken, ['Good morning to you!', 'How did you sleep?']);
  });

  it('does not speak when Keith is not in voice for this channel', async () => {
    const respond = createResponder({
      systemPrompt: SYSTEM_PROMPT,
      history: new HistoryStore(20),
      ...fakeModel(['Silent reply.']),
      speechFor: () => undefined,
    });
    const { message, replies } = fakeUserMessage();
    await respond(request('psst'), message);
    assert.deepEqual(replies, ['Silent reply.']);
  });
});
