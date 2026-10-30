/**
 * Some local models (Qwen3, DeepSeek-R1 style) write their reasoning inside <think>...</think>
 * before answering. This hides it, so it never reaches the chat or the voice.
 *
 * Takes the model's raw chunks and yields the visible reply so far, each time it changes.
 * The reply only ever grows (each value starts with the previous one), which lets the speech
 * follow along by speaking just the new part.
 */
export async function* hideThinking(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let raw = '';
  let shown = '';

  for await (const chunk of chunks) {
    raw += chunk;
    // A trailing "<thi" could still become "<think>", so it waits for the next chunk.
    const visible = withoutPartialTag(withoutThinking(raw));
    if (visible !== shown) {
      shown = visible;
      yield visible;
    }
  }

  // The reply is over, so a trailing "<" was just text after all.
  const final = withoutThinking(raw);
  if (final !== shown) yield final;
}

function withoutThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '') // finished thoughts
    .replace(/<think>[\s\S]*$/, '') // a thought still being written
    .trimStart();
}

/** Drops a trailing "<", "<t", ... "<think" that may be the start of a tag. */
function withoutPartialTag(text: string): string {
  return text.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/, '');
}
