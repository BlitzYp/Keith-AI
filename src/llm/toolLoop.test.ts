import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessage } from './client.js';
import {
  ToolCallAssembler,
  runWithTools,
  type RoundEvent,
  type ToolDefinition,
  type Tools,
} from './toolLoop.js';

const NOW_PLAYING: ToolDefinition = {
  type: 'function',
  function: { name: 'now_playing', description: 'What is playing', parameters: { type: 'object', properties: {} } },
};

/** A fake model: each round streams the given events, and the messages/tools it got are kept. */
function fakeModel(...rounds: RoundEvent[][]) {
  const calls: { messages: ChatMessage[]; tools: ToolDefinition[] }[] = [];
  async function* streamRound(messages: ChatMessage[], tools: ToolDefinition[]) {
    calls.push({ messages: structuredClone(messages), tools });
    yield* rounds[calls.length - 1] ?? [];
  }
  return { streamRound, calls };
}

/** Tools that answer from a table, and remember what they were asked. */
function fakeTools(answers: Record<string, string | Error>): Tools & { ran: { name: string; args: unknown }[] } {
  const ran: { name: string; args: unknown }[] = [];
  return {
    ran,
    definitions: [NOW_PLAYING],
    run: async (name, args) => {
      ran.push({ name, args });
      const answer = answers[name];
      if (answer instanceof Error) throw answer;
      return answer ?? 'unknown tool';
    },
  };
}

const text = (t: string): RoundEvent => ({ type: 'text', text: t });
const toolCall = (name: string, args = '{}', id = 'call-1'): RoundEvent => ({
  type: 'toolCall',
  call: { id, name, arguments: args },
});

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let all = '';
  for await (const chunk of chunks) all += chunk;
  return all;
}

const QUESTION: ChatMessage[] = [{ role: 'user', content: 'Alice: what song is this?' }];

describe('runWithTools', () => {
  it('just streams the text when the model answers straight away', async () => {
    const model = fakeModel([text('Hello '), text('there.')]);
    assert.equal(await collect(runWithTools(QUESTION, fakeTools({}), model.streamRound)), 'Hello there.');
    assert.equal(model.calls.length, 1);
  });

  it('runs a tool the model asks for, gives it the result, and streams the answer that follows', async () => {
    const model = fakeModel([toolCall('now_playing')], [text('It is Daft Punk.')]);
    const tools = fakeTools({ now_playing: 'Playing: One More Time by Daft Punk' });

    const reply = await collect(runWithTools(QUESTION, tools, model.streamRound));

    assert.equal(reply, 'It is Daft Punk.');
    assert.deepEqual(tools.ran, [{ name: 'now_playing', args: {} }]);
    // The second round sees the model's tool request and the result, after the question.
    assert.deepEqual(model.calls[1]?.messages.slice(1), [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'now_playing', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'Playing: One More Time by Daft Punk' },
    ]);
  });

  it('passes the tool its arguments, read from JSON', async () => {
    const model = fakeModel([toolCall('play_song', '{"query":"daft punk"}')], [text('Queued.')]);
    const tools = fakeTools({ play_song: 'Queued daft punk' });
    await collect(runWithTools(QUESTION, tools, model.streamRound));
    assert.deepEqual(tools.ran, [{ name: 'play_song', args: { query: 'daft punk' } }]);
  });

  it('tells the model when a tool fails, instead of failing the whole reply', async () => {
    const model = fakeModel([toolCall('now_playing')], [text('Brick is asleep.')]);
    const tools = fakeTools({ now_playing: new Error('Brick is not running') });

    assert.equal(await collect(runWithTools(QUESTION, tools, model.streamRound)), 'Brick is asleep.');
    assert.match(String(model.calls[1]?.messages.at(-1)?.content), /failed: Brick is not running/);
  });

  it('does not run a tool whose arguments are not valid JSON, and says so to the model', async () => {
    const model = fakeModel([toolCall('play_song', '{"query": ')], [text('Oops.')]);
    const tools = fakeTools({ play_song: 'Queued' });
    await collect(runWithTools(QUESTION, tools, model.streamRound));
    assert.deepEqual(tools.ran, []);
    assert.match(String(model.calls[1]?.messages.at(-1)?.content), /not valid JSON/);
  });

  it('keeps the reply growing across rounds, with a space between the parts', async () => {
    const model = fakeModel([text('One moment.'), toolCall('now_playing')], [text('It is Daft Punk.')]);
    const reply = await collect(runWithTools(QUESTION, fakeTools({ now_playing: 'x' }), model.streamRound));
    assert.equal(reply, 'One moment. It is Daft Punk.');
  });

  it('stops offering tools after a few rounds, so the model has to answer', async () => {
    const model = fakeModel([toolCall('now_playing')], [toolCall('now_playing')], [text('Fine. Daft Punk.')]);
    const reply = await collect(runWithTools(QUESTION, fakeTools({ now_playing: 'x' }), model.streamRound, 3));

    assert.equal(reply, 'Fine. Daft Punk.');
    assert.equal(model.calls.length, 3);
    assert.deepEqual(model.calls[2]?.tools, [], 'the last round gets no tools');
  });

  it('works without any tools (music not set up): one round, no tools sent', async () => {
    const model = fakeModel([text('Hi.')]);
    assert.equal(await collect(runWithTools(QUESTION, undefined, model.streamRound)), 'Hi.');
    assert.deepEqual(model.calls[0]?.tools, []);
  });
});

describe('ToolCallAssembler', () => {
  // OpenAI-style streams send a tool call in pieces: id and name first, the arguments in bits.
  it('puts a tool call back together from its streamed pieces', () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: 'call-1', function: { name: 'play_song', arguments: '{"que' } });
    assembler.add({ index: 0, function: { arguments: 'ry":"daft' } });
    assembler.add({ index: 0, function: { arguments: ' punk"}' } });
    assert.deepEqual(assembler.calls(), [{ id: 'call-1', name: 'play_song', arguments: '{"query":"daft punk"}' }]);
  });

  it('keeps several tool calls apart by their index', () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: 'a', function: { name: 'now_playing', arguments: '' } });
    assembler.add({ index: 1, id: 'b', function: { name: 'skip', arguments: '{}' } });
    assert.deepEqual(
      assembler.calls().map((call) => call.name),
      ['now_playing', 'skip'],
    );
  });

  it('treats missing arguments as no arguments', () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: 'a', function: { name: 'skip' } });
    assert.equal(assembler.calls()[0]?.arguments, '{}');
  });
});
