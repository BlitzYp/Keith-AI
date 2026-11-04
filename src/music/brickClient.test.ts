// Runs the real client against a small local HTTP server standing in for Brick's website API.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { BrickClient } from './brickClient.js';

/** What the fake Brick saw for each request. */
interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

const SNAPSHOT = {
  guildId: 'guild-1',
  voiceChannelId: 'vc-1',
  current: { title: 'One More Time', author: 'Daft Punk', durationMs: 320_000, requestedBy: { id: 'u1', name: 'Bob', via: 'web' } },
  positionMs: 1000,
  paused: false,
  volume: 100,
  queue: [],
  history: [],
};

describe('BrickClient', () => {
  let server: Server;
  let baseUrl: string;
  const seen: Seen[] = [];
  /** How the fake Brick answers the next request. */
  let reply: { status: number; body: unknown; delayMs?: number } = { status: 200, body: SNAPSHOT };

  before(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
        setTimeout(() => {
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(() => server.close());

  function client(timeoutMs = 2000) {
    return new BrickClient({ baseUrl, key: 'secret-key', timeoutMs });
  }

  it('reads the player state with the key, as the person asking (Brick checks they are in the server)', async () => {
    reply = { status: 200, body: SNAPSHOT };
    const result = await client().state('guild-1', { id: 'u-alice', name: 'Alice' });

    assert.deepEqual(result.ok && result.value.current?.title, 'One More Time');
    const request = seen.at(-1)!;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/guilds/guild-1/state');
    assert.equal(request.headers.authorization, 'Bearer secret-key');
    assert.equal(request.headers['x-acting-user-id'], 'u-alice');
  });

  it('queues a song as the person who asked: their id, and their name made safe for a header', async () => {
    reply = { status: 200, body: SNAPSHOT };
    await client().play('guild-1', { id: 'u-alice', name: 'Ålice 🎵' }, 'daft punk', { next: true, wholePlaylist: false });

    const request = seen.at(-1)!;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/guilds/guild-1/queue');
    assert.deepEqual(request.body, { input: 'daft punk', next: true });
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.headers['x-acting-user-id'], 'u-alice');
    assert.equal(decodeURIComponent(String(request.headers['x-acting-user-name'])), 'Ålice 🎵');
  });

  it('uses the routes Brick has for skip, pause, resume and volume', async () => {
    reply = { status: 200, body: SNAPSHOT };
    const user = { id: 'u1', name: 'Bob' };
    await client().skip('g', user);
    await client().pause('g', user);
    await client().resume('g', user);
    await client().setVolume('g', user, 40);
    assert.deepEqual(
      seen.slice(-4).map((r) => `${r.method} ${r.url} ${JSON.stringify(r.body ?? {})}`),
      [
        'POST /api/guilds/g/player/skip {}',
        'POST /api/guilds/g/player/pause {}',
        'POST /api/guilds/g/player/resume {}',
        'POST /api/guilds/g/player/volume {"volume":40}',
      ],
    );
  });

  it("sets an effect and plays a queued song through Brick's routes, as the person asking", async () => {
    reply = { status: 200, body: SNAPSHOT };
    const user = { id: 'u1', name: 'Bob' };
    await client().setEffect('g', user, 'daycore');
    await client().playQueued('g', user, 'item-42');
    assert.deepEqual(
      seen.slice(-2).map((r) => `${r.method} ${r.url} ${JSON.stringify(r.body ?? {})} as ${String(r.headers['x-acting-user-id'])}`),
      ['POST /api/guilds/g/player/filter {"filter":"daycore"} as u1', 'POST /api/guilds/g/queue/item-42/play {} as u1'],
    );
  });

  it('removes a queued song with DELETE, still sent as JSON (Brick refuses changes that are not)', async () => {
    reply = { status: 200, body: SNAPSHOT };
    await client().removeQueued('g', { id: 'u1', name: 'Bob' }, 'item-7');
    const request = seen.at(-1)!;
    assert.equal(`${request.method} ${request.url}`, 'DELETE /api/guilds/g/queue/item-7');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.headers['x-acting-user-id'], 'u1');
  });

  it("asks for the whole playlist when told to, as Brick's queue route expects", async () => {
    reply = { status: 200, body: SNAPSHOT };
    await client().play('g', { id: 'u1', name: 'Bob' }, 'https://youtube.com/playlist?list=PL1', { next: false, wholePlaylist: true });
    assert.deepEqual(seen.at(-1)!.body, { input: 'https://youtube.com/playlist?list=PL1', next: false, wholePlaylist: true });
  });

  it("lists and plays the server's saved playlists", async () => {
    const user = { id: 'u1', name: 'Bob' };
    reply = { status: 200, body: [{ id: 3, name: 'Gym', songCount: 2, totalDurationMs: 1000 }] };
    const list = await client().listPlaylists('g', user);
    assert.deepEqual(list.ok && list.value.map((p) => p.name), ['Gym']);
    assert.equal(`${seen.at(-1)!.method} ${seen.at(-1)!.url}`, 'GET /api/guilds/g/playlists');

    reply = { status: 200, body: { result: { added: 2, tooLong: 0, queueFull: 0 }, state: SNAPSHOT } };
    const played = await client().playPlaylist('g', user, 3, 'replace');
    assert.deepEqual(played.ok && played.value.result.added, 2);
    assert.equal(
      `${seen.at(-1)!.method} ${seen.at(-1)!.url} ${JSON.stringify(seen.at(-1)!.body)}`,
      'POST /api/guilds/g/playlists/3/play {"mode":"replace"}',
    );
  });

  it('ducks without acting as anyone', async () => {
    reply = { status: 200, body: SNAPSHOT };
    await client().duck('g', true);
    const request = seen.at(-1)!;
    assert.equal(request.url, '/api/guilds/g/player/duck');
    assert.deepEqual(request.body, { on: true });
    assert.equal(request.headers['x-acting-user-id'], undefined);
  });

  it("returns Brick's own error message when he says no", async () => {
    reply = { status: 403, body: { error: 'You need to be a DJ to do that.' } };
    assert.deepEqual(await client().skip('g', { id: 'u1', name: 'Bob' }), { ok: false, error: 'You need to be a DJ to do that.' });
  });

  it('says Brick is not answering when he takes too long, instead of hanging the reply', async () => {
    reply = { status: 200, body: SNAPSHOT, delayMs: 300 };
    const result = await client(50).state('g', { id: 'u1', name: 'Bob' });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /didn't answer/);
  });

  it('says Brick is not running when nothing is listening', async () => {
    const offline = new BrickClient({ baseUrl: 'http://127.0.0.1:1/api', key: 'k', timeoutMs: 2000 });
    const result = await offline.state('g', { id: 'u1', name: 'Bob' });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /isn't running|couldn't reach/i);
  });
});
