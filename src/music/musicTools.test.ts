import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MusicBot, PlayerState, PlaylistSummary, Result, Song } from './brickClient.js';
import { musicTools } from './musicTools.js';

const ALICE = { id: 'u-alice', name: 'Alice' };

function song(title: string, author: string, requester = 'Bob'): Song {
  return { id: `id-${title}`, title, author, durationMs: 320_000, requestedBy: { name: requester } };
}

function state(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    voiceChannelId: 'vc-1',
    current: song('One More Time', 'Daft Punk'),
    positionMs: 83_000,
    paused: false,
    volume: 100,
    queue: [song('Around the World', 'Daft Punk'), song('Get Lucky', 'Daft Punk')],
    history: [song('Strobe', 'deadmau5')],
    ...overrides,
  };
}

/** The server's saved playlists, as Brick lists them. */
const PLAYLISTS: PlaylistSummary[] = [
  { id: 1, name: 'Gym Bangers', songCount: 12, totalDurationMs: 2_700_000 },
  { id: 2, name: 'Late Night Lofi', songCount: 30, totalDurationMs: 5_400_000 },
  { id: 3, name: 'Gym Classics', songCount: 8, totalDurationMs: 1_800_000 },
];

/** A pretend Brick that records every call and answers with `answer` (a state by default). */
function fakeBot(answer: (method: string) => Result<PlayerState> = () => ({ ok: true, value: state() })) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return answer(method);
    };
  const bot: MusicBot = {
    state: record('state'),
    play: record('play'),
    skip: record('skip'),
    pause: record('pause'),
    resume: record('resume'),
    setVolume: record('setVolume'),
    setEffect: record('setEffect'),
    playQueued: record('playQueued'),
    removeQueued: record('removeQueued'),
    listPlaylists: async (...args: unknown[]) => {
      calls.push({ method: 'listPlaylists', args });
      return { ok: true, value: PLAYLISTS };
    },
    playPlaylist: async (...args: unknown[]) => {
      calls.push({ method: 'playPlaylist', args });
      return { ok: true, value: { result: { added: 12, tooLong: 1, queueFull: 0 }, state: state() } };
    },
    duck: async () => ({ ok: true, value: undefined }),
  };
  return { bot, calls };
}

describe('musicTools', () => {
  it('offers the model twelve tools', () => {
    const tools = musicTools(fakeBot().bot, 'guild-1', ALICE);
    assert.deepEqual(
      tools.definitions.map((d) => d.function.name).sort(),
      ['list_playlists', 'now_playing', 'pause', 'play_from_queue', 'play_playlist', 'play_song', 'remove_from_queue', 'resume', 'set_effect', 'set_volume', 'show_queue', 'skip'],
    );
  });

  it('tells play_song how to pick "something similar"', () => {
    const playSong = musicTools(fakeBot().bot, 'guild-1', ALICE).definitions.find((d) => d.function.name === 'play_song');
    assert.match(playSong!.function.description, /similar/i);
    assert.match(playSong!.function.description, /now_playing/);
  });

  it('describes what is playing, how far in, and what comes next', async () => {
    const result = await musicTools(fakeBot().bot, 'guild-1', ALICE).run('now_playing', {});
    assert.match(result, /One More Time by Daft Punk/);
    assert.match(result, /requested by Bob/);
    assert.match(result, /1:23 of 5:20/);
    assert.match(result, /Up next: 1\. Around the World by Daft Punk; 2\. Get Lucky by Daft Punk/);
    assert.match(result, /Recently played: Strobe by deadmau5/);
  });

  it('says when nothing is playing', async () => {
    const { bot } = fakeBot(() => ({ ok: true, value: state({ current: null, queue: [], history: [] }) }));
    assert.match(await musicTools(bot, 'guild-1', ALICE).run('now_playing', {}), /Nothing is playing/);
  });

  it('queues a song for whoever asked, and says what got queued', async () => {
    const { bot, calls } = fakeBot();
    const result = await musicTools(bot, 'guild-1', ALICE).run('play_song', { query: 'get lucky' });

    assert.deepEqual(calls, [{ method: 'play', args: ['guild-1', ALICE, 'get lucky', { next: false, wholePlaylist: false }] }]);
    // Brick answers with the new state; a song added at the end is the last in the queue.
    assert.match(result, /Queued: Get Lucky by Daft Punk/);
  });

  it('puts a song first in line with play_next', async () => {
    const { bot, calls } = fakeBot();
    const result = await musicTools(bot, 'guild-1', ALICE).run('play_song', { query: 'around the world', play_next: true });
    assert.deepEqual(calls[0]?.args[3], { next: true, wholePlaylist: false });
    assert.match(result, /Queued next: Around the World by Daft Punk/);
  });

  it('says a song started straight away when nothing was playing', async () => {
    const { bot } = fakeBot(() => ({ ok: true, value: state({ queue: [] }) }));
    assert.match(await musicTools(bot, 'guild-1', ALICE).run('play_song', { query: 'one more time' }), /Now playing: One More Time/);
  });

  it('refuses play_song without a song to look for, without bothering Brick', async () => {
    const { bot, calls } = fakeBot();
    assert.match(await musicTools(bot, 'guild-1', ALICE).run('play_song', { query: '  ' }), /needs a song/);
    assert.deepEqual(calls, []);
  });

  it('skips, and says what plays now', async () => {
    const { bot, calls } = fakeBot();
    const result = await musicTools(bot, 'guild-1', ALICE).run('skip', {});
    assert.deepEqual(calls, [{ method: 'skip', args: ['guild-1', ALICE] }]);
    assert.match(result, /Skipped\. Now playing: One More Time/);
  });

  it('pauses and resumes', async () => {
    const { bot, calls } = fakeBot();
    const tools = musicTools(bot, 'guild-1', ALICE);
    assert.match(await tools.run('pause', {}), /Paused/);
    assert.match(await tools.run('resume', {}), /Resumed/);
    assert.deepEqual(calls.map((c) => c.method), ['pause', 'resume']);
  });

  it('sets the volume, but only to a whole number from 0 to 150', async () => {
    const { bot, calls } = fakeBot();
    const tools = musicTools(bot, 'guild-1', ALICE);
    assert.match(await tools.run('set_volume', { percent: 40 }), /Volume set to 40%/);
    assert.match(await tools.run('set_volume', { percent: 400 }), /0 to 150/);
    assert.match(await tools.run('set_volume', { percent: 'loud' }), /0 to 150/);
    assert.deepEqual(calls, [{ method: 'setVolume', args: ['guild-1', ALICE, 40] }]);
  });

  it("passes on Brick's reason when he says no, so Keith can explain it", async () => {
    const { bot } = fakeBot(() => ({ ok: false, error: 'You need to be a DJ to do that.' }));
    assert.equal(await musicTools(bot, 'guild-1', ALICE).run('skip', {}), "Couldn't do that: You need to be a DJ to do that.");
  });

  it('answers an unknown tool name instead of throwing', async () => {
    assert.match(await musicTools(fakeBot().bot, 'guild-1', ALICE).run('launch_rockets', {}), /no tool called launch_rockets/);
  });

  describe('effects', () => {
    it('applies an effect for whoever asked', async () => {
      const { bot, calls } = fakeBot();
      const result = await musicTools(bot, 'guild-1', ALICE).run('set_effect', { effect: 'daycore' });
      assert.deepEqual(calls, [{ method: 'setEffect', args: ['guild-1', ALICE, 'daycore'] }]);
      assert.match(result, /Effect set to daycore/);
    });

    it('takes the effect off with "off"', async () => {
      assert.match(await musicTools(fakeBot().bot, 'guild-1', ALICE).run('set_effect', { effect: 'off' }), /Effects off/);
    });

    it('refuses an effect Brick does not have, and lists the ones he does', async () => {
      const { bot, calls } = fakeBot();
      const result = await musicTools(bot, 'guild-1', ALICE).run('set_effect', { effect: 'reverb' });
      assert.match(result, /nightcore, daycore, vaporwave/);
      assert.deepEqual(calls, []);
    });

    it('tells the model what each effect is, and that "slowed" means daycore', () => {
      const setEffect = musicTools(fakeBot().bot, 'g', ALICE).definitions.find((d) => d.function.name === 'set_effect')!;
      assert.match(setEffect.function.description, /slowed/i);
      assert.match(JSON.stringify(setEffect.function.parameters), /daycore/);
    });
  });

  describe('the queue', () => {
    const longQueue = state({
      queue: Array.from({ length: 8 }, (_, i) => song(`Song ${i + 1}`, 'Artist')),
    });

    it('shows the whole queue, numbered like /queue', async () => {
      const { bot } = fakeBot(() => ({ ok: true, value: longQueue }));
      const result = await musicTools(bot, 'guild-1', ALICE).run('show_queue', {});
      assert.match(result, /1\. Song 1 by Artist/);
      assert.match(result, /8\. Song 8 by Artist/, 'all of it, not just the next five');
      assert.match(result, /Now playing: One More Time/);
    });

    it('says when the queue is empty', async () => {
      const { bot } = fakeBot(() => ({ ok: true, value: state({ queue: [] }) }));
      assert.match(await musicTools(bot, 'guild-1', ALICE).run('show_queue', {}), /queue is empty/);
    });

    it('plays a queued song right away, found by its number', async () => {
      const { bot, calls } = fakeBot(() => ({ ok: true, value: longQueue }));
      await musicTools(bot, 'guild-1', ALICE).run('play_from_queue', { position: 3 });
      // It looks at the queue first, then asks Brick to play that song (by its id).
      assert.deepEqual(calls, [
        { method: 'state', args: ['guild-1', ALICE] },
        { method: 'playQueued', args: ['guild-1', ALICE, 'id-Song 3'] },
      ]);
    });

    it('removes a queued song by its number, and says which one went', async () => {
      const { bot, calls } = fakeBot(() => ({ ok: true, value: longQueue }));
      const result = await musicTools(bot, 'guild-1', ALICE).run('remove_from_queue', { positions: [2] });
      assert.deepEqual(calls, [
        { method: 'state', args: ['guild-1', ALICE] },
        { method: 'removeQueued', args: ['guild-1', ALICE, 'id-Song 2'] },
      ]);
      assert.match(result, /Removed: Song 2 by Artist/);
    });

    it('removes several songs at once, all looked up before any is removed (numbers shift as songs go)', async () => {
      const { bot, calls } = fakeBot(() => ({ ok: true, value: longQueue }));
      const result = await musicTools(bot, 'guild-1', ALICE).run('remove_from_queue', { positions: [1, 3, 3] });
      assert.deepEqual(
        calls.map((c) => c.args[2] ?? c.method),
        ['state', 'id-Song 1', 'id-Song 3'],
        'one look at the queue, then each song once, by id',
      );
      assert.match(result, /Removed: Song 1 by Artist; Song 3 by Artist/);
    });

    it('removes nothing when any number is not in the queue', async () => {
      const { bot, calls } = fakeBot(() => ({ ok: true, value: longQueue }));
      const result = await musicTools(bot, 'guild-1', ALICE).run('remove_from_queue', { positions: [2, 40] });
      assert.match(result, /only 8 songs/);
      assert.deepEqual(calls.map((c) => c.method), ['state']);
    });

    it('says which songs went and which did not, when Brick refuses partway', async () => {
      let removals = 0;
      const { bot } = fakeBot((method) => {
        if (method !== 'removeQueued') return { ok: true, value: longQueue };
        removals++;
        return removals === 1 ? { ok: true, value: longQueue } : { ok: false, error: 'You need to be a DJ to do that.' };
      });
      const result = await musicTools(bot, 'guild-1', ALICE).run('remove_from_queue', { positions: [1, 2] });
      assert.match(result, /Removed: Song 1 by Artist/);
      assert.match(result, /Couldn't remove Song 2 by Artist: You need to be a DJ/);
    });

    it('refuses a number that is not in the queue', async () => {
      const { bot, calls } = fakeBot(() => ({ ok: true, value: longQueue }));
      const result = await musicTools(bot, 'guild-1', ALICE).run('play_from_queue', { position: 12 });
      assert.match(result, /only 8 songs/);
      assert.deepEqual(calls.map((c) => c.method), ['state']);
    });
  });

  describe('playlists', () => {
    const LIST_LINK = 'https://www.youtube.com/playlist?list=PL123';

    it('queues every song of a YouTube playlist link when asked for the whole playlist', async () => {
      const { bot, calls } = fakeBot();
      const result = await musicTools(bot, 'guild-1', ALICE).run('play_song', { query: LIST_LINK, whole_playlist: true });
      assert.deepEqual(calls.at(-1), { method: 'play', args: ['guild-1', ALICE, LIST_LINK, { next: false, wholePlaylist: true }] });
      assert.match(result, /Queued the playlist/);
      assert.match(result, /2 songs in the queue/);
    });

    it('describes a Spotify playlist or album link as a playlist too (Brick always queues all of those)', async () => {
      const { bot } = fakeBot();
      const result = await musicTools(bot, 'guild-1', ALICE).run('play_song', { query: 'https://open.spotify.com/album/abc' });
      assert.match(result, /Queued the playlist/);
    });

    it("lists the server's saved playlists with their sizes", async () => {
      const result = await musicTools(fakeBot().bot, 'guild-1', ALICE).run('list_playlists', {});
      assert.match(result, /Gym Bangers \(12 songs, 45 min\)/);
      assert.match(result, /Late Night Lofi \(30 songs, 1 h 30 min\)/);
    });

    it('plays a saved playlist found by its name, adding it to the queue by default', async () => {
      const { bot, calls } = fakeBot();
      const result = await musicTools(bot, 'guild-1', ALICE).run('play_playlist', { name: 'late night lofi' });
      assert.deepEqual(calls.at(-1), { method: 'playPlaylist', args: ['guild-1', ALICE, 2, 'append'] });
      // Brick's own summary of what went in.
      assert.match(result, /Queued 12 songs from Late Night Lofi\. 1 left out for being longer than this server allows/);
    });

    it('replaces the queue with the playlist when asked to', async () => {
      const { bot, calls } = fakeBot();
      await musicTools(bot, 'guild-1', ALICE).run('play_playlist', { name: 'Gym Bangers', mode: 'replace' });
      assert.deepEqual(calls.at(-1)?.args.slice(2), [1, 'replace']);
    });

    it('finds a playlist from part of its name, when only one matches', async () => {
      const { bot, calls } = fakeBot();
      await musicTools(bot, 'guild-1', ALICE).run('play_playlist', { name: 'lofi' });
      assert.equal(calls.at(-1)?.args[2], 2);
    });

    it('asks which one when part of a name matches several', async () => {
      const { bot, calls } = fakeBot();
      const result = await musicTools(bot, 'guild-1', ALICE).run('play_playlist', { name: 'gym' });
      assert.match(result, /Gym Bangers/);
      assert.match(result, /Gym Classics/);
      assert.match(result, /which one/i);
      assert.equal(calls.some((c) => c.method === 'playPlaylist'), false);
    });

    it('lists what there is when no playlist has that name', async () => {
      const result = await musicTools(fakeBot().bot, 'guild-1', ALICE).run('play_playlist', { name: 'metal' });
      assert.match(result, /No saved playlist called "metal"/);
      assert.match(result, /Gym Bangers, Late Night Lofi, Gym Classics/);
    });
  });
});
