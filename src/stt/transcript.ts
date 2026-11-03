/**
 * Phrases Whisper tends to "hear" in silence or background noise. It learned them from video
 * subtitles, where they often close a clip. Matched against the whole transcript only, so a real
 * sentence that contains them ("Thank you for the help") still gets through. The cost: someone
 * saying just "Thank you." to Keith goes unanswered.
 */
const MADE_UP_PHRASES = [
  'you',
  'thank you',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'bye',
  'subtitles by the amaraorg community',
];

/**
 * Tidies a Whisper transcript, or returns '' when nobody really said anything.
 */
export function cleanTranscript(raw: string): string {
  const text = raw
    // Sound descriptions: [BLANK_AUDIO], [Music], (upbeat music), *coughs*
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = wordsOf(text);
  if (!words || MADE_UP_PHRASES.includes(words)) return '';
  return text;
}

/**
 * Whisper gets a prompt (STT_PROMPT, e.g. "Hey Keith.") so it spells Keith's name right. On
 * near-silence it sometimes writes the prompt straight back. In name mode that would look like
 * someone calling Keith, so a transcript that is only the prompt counts as nothing.
 */
export function withoutEchoedPrompt(transcript: string, prompt: string | undefined): string {
  if (prompt && wordsOf(transcript) === wordsOf(prompt)) return '';
  return transcript;
}

/** Lowercase letters, digits and single spaces, so "Thanks for watching!" equals "thanks for watching". */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
