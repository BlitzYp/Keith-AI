import type { ChatMessage } from './messages.js';

/** A tool the model may call, described in OpenAI's format (name, what it does, its arguments). */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** A JSON Schema for the arguments. */
    parameters: Record<string, unknown>;
  };
}

/** The tools for one reply: what the model is told about, and how to run them. */
export interface Tools {
  definitions: ToolDefinition[];
  /** Runs a tool and returns a short text result for the model. May throw. */
  run(name: string, args: unknown): Promise<string>;
}

/** A complete tool call: which tool, with what arguments (still a JSON string). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** What one model round streams: bits of reply text, and finished tool calls. */
export type RoundEvent = { type: 'text'; text: string } | { type: 'toolCall'; call: ToolCall };

/** One request to the model: llm/client.ts does it for real, tests pass a fake. */
export type StreamRound = (messages: ChatMessage[], tools: ToolDefinition[]) => AsyncIterable<RoundEvent>;

/** How many times the model may ask for tools before it has to answer. */
const DEFAULT_MAX_ROUNDS = 3;

/**
 * Talks to the model until it gives an answer, running any tools it asks for along the way.
 *
 * Yields the reply's raw text chunks as they stream, like a plain request would, so the rest of
 * Keith (hideThinking, the streaming Discord message, the voice) doesn't know tools exist. Text
 * from every round is kept, so the reply only ever grows.
 *
 * The last round offers no tools, so a model that keeps asking for them has to answer.
 */
export async function* runWithTools(
  question: ChatMessage[],
  tools: Tools | undefined,
  streamRound: StreamRound,
  maxRounds = DEFAULT_MAX_ROUNDS,
): AsyncGenerator<string> {
  const messages = [...question];
  let textSoFar = '';

  for (let round = 1; round <= maxRounds; round++) {
    const isLastRound = round === maxRounds || !tools;
    const offered = isLastRound ? [] : tools.definitions;
    const calls: ToolCall[] = [];
    let separatorNeeded = textSoFar !== '' && !/\s$/.test(textSoFar);

    for await (const event of streamRound(messages, offered)) {
      if (event.type === 'toolCall') {
        calls.push(event.call);
        continue;
      }
      if (separatorNeeded && event.text) {
        // "One moment." + "It's Daft Punk." from the next round: keep them apart.
        yield ' ';
        textSoFar += ' ';
        separatorNeeded = false;
      }
      textSoFar += event.text;
      yield event.text;
    }

    if (calls.length === 0 || !tools) return;

    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of calls) {
      messages.push({ role: 'tool', tool_call_id: call.id, content: await runOne(tools, call) });
    }
  }
}

/** Runs one tool call and returns what to tell the model, whatever happens. */
async function runOne(tools: Tools, call: ToolCall): Promise<string> {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    return `The arguments for ${call.name} were not valid JSON, so it didn't run.`;
  }
  try {
    return await tools.run(call.name, args);
  } catch (err) {
    console.error(`[tools] ${call.name} failed:`, (err as Error).message);
    return `${call.name} failed: ${(err as Error).message}`;
  }
}

/** One piece of a streamed tool call, as OpenAI-compatible APIs send it. */
export interface ToolCallPiece {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Puts streamed tool calls back together. The first piece of a call carries its id and name,
 * and the arguments arrive in bits after it; `index` says which call a piece belongs to.
 */
export class ToolCallAssembler {
  private readonly byIndex = new Map<number, ToolCall>();

  add(piece: ToolCallPiece): void {
    const call = this.byIndex.get(piece.index) ?? { id: '', name: '', arguments: '' };
    if (piece.id) call.id = piece.id;
    if (piece.function?.name) call.name = piece.function.name;
    call.arguments += piece.function?.arguments ?? '';
    this.byIndex.set(piece.index, call);
  }

  /** The finished calls, in index order. A call with no arguments gets "{}". */
  calls(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({ ...call, arguments: call.arguments || '{}' }));
  }
}
