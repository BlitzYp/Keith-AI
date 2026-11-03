/**
 * Who Keith answers in voice, switched with /listen:
 *   everyone: anything anyone says
 *   name:     only sentences with Keith's name in them ("Keith, what's the time?")
 */
export type ListenMode = 'everyone' | 'name';

/** With several people in a channel, answering every sentence is a lot, so name mode is the default. */
export const DEFAULT_LISTEN_MODE: ListenMode = 'name';

/** Whether Keith should answer `text`, heard in voice. `name` is Keith's name (BOT_NAME). */
export function shouldAnswer(text: string, mode: ListenMode, name: string): boolean {
  if (mode === 'everyone') return true;
  return mentionsName(text, name);
}

/** Names this long or longer also match with one letter wrong; shorter ones would match too much. */
const MIN_LENGTH_FOR_MISSPELLINGS = 4;

/**
 * True when one of the words in `text` is `name`: "Keith", "keith!", "Keith's" count, "Keithley"
 * doesn't. Case doesn't matter. For names of 4+ letters, one letter added, missing or wrong also
 * counts ("Keeith", "Keth"): Whisper does that with names now and then, and missing someone who
 * called Keith is worse than the odd answer to someone saying "Leith".
 */
function mentionsName(text: string, name: string): boolean {
  const target = name.toLowerCase();
  const allowedTypos = target.length >= MIN_LENGTH_FOR_MISSPELLINGS ? 1 : 0;
  // Words are runs of letters and digits, so "Keith's" gives "keith" and "s".
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.some((word) => editDistance(word, target) <= allowedTypos);
}

/**
 * How many letters have to be added, removed or swapped to turn `a` into `b` (Levenshtein
 * distance). Worked out row by row: row[j] is the distance between what we've read of `a` so far
 * and the first j letters of `b`.
 */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2; // more than one apart for sure; skip the work
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const swap = row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      next.push(Math.min(swap, row[j]! + 1, next[j - 1]! + 1));
    }
    row = next;
  }
  return row[b.length]!;
}
