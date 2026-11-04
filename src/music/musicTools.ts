import type { ToolDefinition, Tools } from '../llm/toolLoop.js';
import type { ActingUser, AddManyResult, MusicBot, PlayerState, PlaylistSummary, Result, Song } from './brickClient.js';

/** Brick's volume range, in percent. */
const MAX_VOLUME = 150;
/** How many upcoming and recent songs now_playing shows. show_queue shows up to QUEUE_SHOWN. */
const SONGS_SHOWN = 5;
const QUEUE_SHOWN = 50;

/**
 * Brick's audio effects (AUDIO_FILTERS in ../discord-music-bot/src/shared/filters.ts), with what they
 * sound like, so the model can match "make it slowed" or "chipmunk mode" to the right one.
 */
const EFFECTS: Record<string, string> = {
  off: 'no effect',
  nightcore: 'faster and higher-pitched (sped up, chipmunk)',
  daycore: 'slower and deeper, like a record played too slow ("slowed", the opposite of nightcore)',
  vaporwave: 'slower with the pitch dropped further, dreamy',
  bassboost: 'stronger bass',
  '8d': 'the sound circles around your head (best with headphones)',
  karaoke: 'tries to remove the vocals',
  soft: 'muffled, as if from another room',
};
const EFFECT_NAMES = Object.keys(EFFECTS).filter((name) => name !== 'off');

/** No arguments, in JSON Schema. */
const NO_ARGUMENTS = { type: 'object', properties: {} };

const DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'now_playing',
      description:
        "What the music bot (Brick) is playing right now: the song, who asked for it, how far in, the volume, what's queued next and what played recently. Use it before talking about the music.",
      parameters: NO_ARGUMENTS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_song',
      description:
        'Queues a song on the music bot: a song name to search for (best as "Artist - Title") or a link. ' +
        'For "something similar" or "something like this": call now_playing first, pick one real, well-known song by a related artist (not the same song), and queue it as "Artist - Title".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The song to search for, as "Artist - Title", or a link.' },
          play_next: { type: 'boolean', description: 'True to play it right after the current song instead of at the end of the queue.' },
          whole_playlist: {
            type: 'boolean',
            description:
              'For a YouTube playlist link (one with "list=" in it): true queues every song of the playlist, false just the one song. Spotify playlist and album links always queue every song.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'skip', description: 'Skips the current song.', parameters: NO_ARGUMENTS },
  },
  {
    type: 'function',
    function: {
      name: 'list_playlists',
      description: "The server's saved playlists (made with the music bot's /playlist or its website), with their sizes.",
      parameters: NO_ARGUMENTS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_playlist',
      description:
        'Plays one of the server\'s saved playlists, found by its name (part of the name is fine). By default its songs go to the end of the queue; mode "replace" stops the music and plays the playlist instead of the queue, only when someone clearly asks for that.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The playlist\'s name, or part of it.' },
          mode: { type: 'string', enum: ['append', 'replace'] },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_queue',
      description:
        'The whole queue, numbered from 1 (the next song) like /queue, plus the current song. Use it to answer what is coming up, or to find a song someone wants to hear now.',
      parameters: NO_ARGUMENTS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_from_queue',
      description:
        'Plays a song from the queue right now, skipping the current one; the rest of the queue keeps its order. Call show_queue first to find its number.',
      parameters: {
        type: 'object',
        properties: { position: { type: 'integer', minimum: 1, description: 'Its number in show_queue (1 = next up).' } },
        required: ['position'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_queue',
      description:
        'Takes one or more songs out of the queue, by their numbers in show_queue. Call show_queue first. To remove everything someone queued, or every song by an artist, pass all their numbers at once.',
      parameters: {
        type: 'object',
        properties: {
          positions: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            description: 'Numbers from show_queue (1 = next up).',
          },
        },
        required: ['positions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_effect',
      description:
        'Puts an audio effect on the music; it stays on for the next songs until changed. One at a time. ' +
        Object.entries(EFFECTS)
          .map(([name, sound]) => `${name}: ${sound}`)
          .join('; ') +
        '. "Slowed" means daycore, "sped up" means nightcore.',
      parameters: {
        type: 'object',
        properties: { effect: { type: 'string', enum: Object.keys(EFFECTS) } },
        required: ['effect'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'pause', description: 'Pauses the music.', parameters: NO_ARGUMENTS },
  },
  {
    type: 'function',
    function: { name: 'resume', description: 'Resumes paused music.', parameters: NO_ARGUMENTS },
  },
  {
    type: 'function',
    function: {
      name: 'set_volume',
      description: `Sets the music volume in percent, 0 to ${MAX_VOLUME} (100 is normal). "Turn it down" is about 60, "turn it up" about 130.`,
      parameters: {
        type: 'object',
        properties: { percent: { type: 'integer', minimum: 0, maximum: MAX_VOLUME } },
        required: ['percent'],
      },
    },
  },
];

/**
 * The music tools for one reply: what the model may do with Brick, acting as `user` in `guildId`.
 * Every result is a short sentence for the model, including failures, so it can explain them.
 */
export function musicTools(bot: MusicBot, guildId: string, user: ActingUser): Tools {
  return {
    definitions: DEFINITIONS,
    async run(name, args) {
      const input = (args ?? {}) as Record<string, unknown>;
      switch (name) {
        case 'now_playing':
          return answer(await bot.state(guildId, user), describeState);
        case 'play_song':
          return playSong(bot, guildId, user, input);
        case 'skip':
          return answer(await bot.skip(guildId, user), (state) => `Skipped. ${nowPlayingLine(state)}`);
        case 'pause':
          return answer(await bot.pause(guildId, user), () => 'Paused.');
        case 'resume':
          return answer(await bot.resume(guildId, user), () => 'Resumed.');
        case 'set_volume':
          return setVolume(bot, guildId, user, input.percent);
        case 'set_effect':
          return setEffect(bot, guildId, user, input.effect);
        case 'show_queue':
          return answer(await bot.state(guildId, user), describeQueue);
        case 'play_from_queue':
          return playFromQueue(bot, guildId, user, input.position);
        case 'remove_from_queue':
          return removeFromQueue(bot, guildId, user, input.positions);
        case 'list_playlists':
          return answer(await bot.listPlaylists(guildId, user), describePlaylists);
        case 'play_playlist':
          return playPlaylist(bot, guildId, user, input.name, input.mode);
        default:
          return `There is no tool called ${name}.`;
      }
    },
  };
}

async function playSong(bot: MusicBot, guildId: string, user: ActingUser, input: Record<string, unknown>) {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return 'play_song needs a song to look for.';
  const next = input.play_next === true;
  const wholePlaylist = input.whole_playlist === true;
  const result = await bot.play(guildId, user, query, { next, wholePlaylist });
  const isPlaylist = wholePlaylist || SPOTIFY_COLLECTION.test(query);
  return answer(result, (state) => (isPlaylist ? describeQueuedPlaylist(state) : describeQueued(state, next)));
}

async function setVolume(bot: MusicBot, guildId: string, user: ActingUser, percent: unknown) {
  if (!Number.isInteger(percent) || (percent as number) < 0 || (percent as number) > MAX_VOLUME) {
    return `The volume has to be a whole number from 0 to ${MAX_VOLUME}.`;
  }
  return answer(await bot.setVolume(guildId, user, percent as number), () => `Volume set to ${percent}%.`);
}

async function setEffect(bot: MusicBot, guildId: string, user: ActingUser, effect: unknown) {
  if (typeof effect !== 'string' || !(effect in EFFECTS)) {
    return `There's no such effect. Brick has: ${EFFECT_NAMES.join(', ')} (or "off").`;
  }
  return answer(await bot.setEffect(guildId, user, effect), () =>
    effect === 'off' ? 'Effects off.' : `Effect set to ${effect}: ${EFFECTS[effect]}.`,
  );
}

/** Looks the song up by its number first: Brick plays queued songs by id, and numbers shift as songs play. */
async function playFromQueue(bot: MusicBot, guildId: string, user: ActingUser, position: unknown) {
  const current = await bot.state(guildId, user);
  if (!current.ok) return `Couldn't do that: ${current.error}`;
  const { queue } = current.value;
  if (!Number.isInteger(position) || (position as number) < 1 || (position as number) > queue.length) {
    return queue.length === 0
      ? 'The queue is empty.'
      : `There are only ${queue.length} songs in the queue; pick a number from 1 to ${queue.length}.`;
  }
  const song = queue[(position as number) - 1]!;
  return answer(await bot.playQueued(guildId, user, song.id), () => `Now playing: ${songName(song)}.`);
}

/**
 * Removes songs by their numbers. All of them are looked up in one look at the queue first: numbers
 * shift as songs are removed, but each song's id stays the same. If any number is wrong, nothing is
 * removed, so the model can't take out the wrong songs by miscounting.
 */
async function removeFromQueue(bot: MusicBot, guildId: string, user: ActingUser, positions: unknown) {
  const numbers = Array.isArray(positions) ? [...new Set(positions)] : [];
  if (numbers.length === 0) return 'remove_from_queue needs the numbers of the songs to remove.';

  const current = await bot.state(guildId, user);
  if (!current.ok) return `Couldn't do that: ${current.error}`;
  const { queue } = current.value;
  const outOfRange = numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > queue.length);
  if (outOfRange.length > 0) {
    return queue.length === 0
      ? 'The queue is empty.'
      : `Nothing removed: there are only ${queue.length} songs in the queue, so ${outOfRange.join(', ')} isn't one of them.`;
  }

  const removed: string[] = [];
  const failed: string[] = [];
  for (const song of numbers.map((n) => queue[(n as number) - 1]!)) {
    const result = await bot.removeQueued(guildId, user, song.id);
    if (result.ok) removed.push(songName(song));
    else failed.push(`Couldn't remove ${songName(song)}: ${result.error}`);
  }
  return [removed.length > 0 ? `Removed: ${removed.join('; ')}.` : '', ...failed].filter(Boolean).join(' ');
}

/** Spotify album and playlist links, which Brick always queues in full. */
const SPOTIFY_COLLECTION = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:album|playlist)\//i;

async function playPlaylist(bot: MusicBot, guildId: string, user: ActingUser, name: unknown, mode: unknown) {
  if (typeof name !== 'string' || !name.trim()) return 'play_playlist needs the name of a saved playlist.';
  const list = await bot.listPlaylists(guildId, user);
  if (!list.ok) return `Couldn't do that: ${list.error}`;

  const found = findPlaylist(list.value, name.trim());
  if (typeof found === 'string') return found; // nothing matched, or several did

  const played = await bot.playPlaylist(guildId, user, found.id, mode === 'replace' ? 'replace' : 'append');
  return answer(played, ({ result }) => describeAddMany(result, found.name));
}

/**
 * The playlist called `name`: an exact match (ignoring case) first, else the only one whose name contains it.
 * Returns a sentence for the model instead when nothing or several match, so it can ask.
 */
function findPlaylist(playlists: PlaylistSummary[], name: string): PlaylistSummary | string {
  const wanted = name.toLowerCase();
  const exact = playlists.find((p) => p.name.toLowerCase() === wanted);
  if (exact) return exact;
  const partial = playlists.filter((p) => p.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    return `Several saved playlists match "${name}": ${partial.map((p) => p.name).join(', ')}. Ask which one.`;
  }
  const all = playlists.map((p) => p.name).join(', ');
  return `No saved playlist called "${name}". ${all ? `Saved playlists: ${all}.` : 'This server has no saved playlists.'}`;
}

/** The same summary Brick gives in Discord: "Queued 12 songs. 2 left out for being longer than this server allows." */
function describeAddMany({ added, tooLong, queueFull }: AddManyResult, playlistName: string): string {
  const parts = [`Queued ${added} ${added === 1 ? 'song' : 'songs'} from ${playlistName}.`];
  if (tooLong > 0) parts.push(`${tooLong} left out for being longer than this server allows.`);
  if (queueFull > 0) parts.push(`${queueFull} didn't fit: the queue is full.`);
  return parts.join(' ');
}

function describePlaylists(playlists: PlaylistSummary[]): string {
  if (playlists.length === 0) return 'This server has no saved playlists.';
  const shown = playlists.map((p) => `${p.name} (${p.songCount} ${p.songCount === 1 ? 'song' : 'songs'}, ${length(p.totalDurationMs)})`);
  return `Saved playlists: ${shown.join('; ')}.`;
}

/** Brick answers a whole-playlist request with the new state, so this says where the queue stands now. */
function describeQueuedPlaylist(state: PlayerState): string {
  const playing = state.current ? ` ${nowPlayingLine(state)}` : '';
  return `Queued the playlist. There are now ${state.queue.length} songs in the queue.${playing}`;
}

/** 5_400_000 → "1 h 30 min", 2_700_000 → "45 min". */
function length(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** Turns a Result into the model's answer: the success text, or Brick's reason for saying no. */
function answer<T>(result: Result<T>, onSuccess: (value: T) => string): string {
  return result.ok ? onSuccess(result.value) : `Couldn't do that: ${result.error}`;
}

/**
 * Brick answers a queue request with the new state, so the song that was just added is found by
 * where it went: first in line (play_next), playing already (nothing was queued), or last.
 */
function describeQueued(state: PlayerState, next: boolean): string {
  if (next && state.queue[0]) return `Queued next: ${songName(state.queue[0])}.`;
  const last = state.queue.at(-1);
  if (!last && state.current) return `Now playing: ${songName(state.current)}.`;
  return last ? `Queued: ${songName(last)}.` : 'Queued.';
}

function describeState(state: PlayerState): string {
  if (!state.current && state.queue.length === 0) {
    const recent = state.history.slice(0, SONGS_SHOWN).map(songName);
    return `Nothing is playing and the queue is empty.${recent.length ? ` Recently played: ${recent.join('; ')}.` : ''}`;
  }
  const lines = [nowPlayingLine(state), `Volume ${state.volume}%.`];
  const upNext = state.queue.slice(0, SONGS_SHOWN).map((song, i) => `${i + 1}. ${songName(song)}`);
  if (upNext.length) lines.push(`Up next: ${upNext.join('; ')}${state.queue.length > SONGS_SHOWN ? `; and ${state.queue.length - SONGS_SHOWN} more` : ''}.`);
  const recent = state.history.slice(0, SONGS_SHOWN).map(songName);
  if (recent.length) lines.push(`Recently played: ${recent.join('; ')}.`);
  return lines.join(' ');
}

function describeQueue(state: PlayerState): string {
  const playing = nowPlayingLine(state);
  if (state.queue.length === 0) return `${playing} The queue is empty.`;
  const shown = state.queue.slice(0, QUEUE_SHOWN).map((song, i) => `${i + 1}. ${songName(song)} (requested by ${song.requestedBy.name})`);
  const more = state.queue.length > QUEUE_SHOWN ? ` And ${state.queue.length - QUEUE_SHOWN} more.` : '';
  return `${playing} Queue: ${shown.join('; ')}.${more}`;
}

function nowPlayingLine(state: PlayerState): string {
  const song = state.current;
  if (!song) return 'Nothing is playing now.';
  const progress = song.durationMs ? `, ${clock(state.positionMs)} of ${clock(song.durationMs)}` : '';
  return `Now playing: ${songName(song)} (requested by ${song.requestedBy.name})${progress}${state.paused ? ', paused' : ''}.`;
}

function songName(song: Song): string {
  return song.author ? `${song.title} by ${song.author}` : song.title;
}

/** 83000 → "1:23". */
function clock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
