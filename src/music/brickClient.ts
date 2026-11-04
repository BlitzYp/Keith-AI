/**
 * Talks to Brick Maback, the music bot, through its website's API (../discord-music-bot).
 *
 * Every request carries the shared key (MUSIC_BOT_KEY here, INTEGRATION_KEY in Brick). Requests
 * that do something for a person also say who: Brick then applies that person's permissions
 * (DJ role, same voice channel), so Keith can never do more than whoever asked him.
 *
 * Nothing here throws: every call returns a Result, so a stopped or slow Brick turns into a
 * sentence Keith can say ("Brick isn't running") instead of a broken reply.
 */

/** Success with a value, or failure with a reason a person can read. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Who Keith is acting for: the person who asked. */
export interface ActingUser {
  id: string;
  name: string;
}

/** A song in Brick's queue: the parts of Brick's QueueItem that Keith uses. */
export interface Song {
  /** Brick's id for this queue entry, used to play it from the queue. */
  id: string;
  title: string;
  author?: string;
  durationMs?: number;
  requestedBy: { name: string };
}

/** The parts of Brick's PlayerSnapshot that Keith uses. */
export interface PlayerState {
  voiceChannelId: string | null;
  current: Song | null;
  positionMs: number;
  paused: boolean;
  volume: number;
  queue: Song[];
  /** Recently played, newest first. */
  history: Song[];
}

/** One of the server's saved playlists (Brick's PlaylistSummary, the parts Keith uses). */
export interface PlaylistSummary {
  id: number;
  name: string;
  songCount: number;
  totalDurationMs: number;
}

/** What playing a saved playlist added to the queue (Brick's AddManyResult). */
export interface AddManyResult {
  added: number;
  /** Left out for being longer than the server allows. */
  tooLong: number;
  /** Left out because the queue was full. */
  queueFull: number;
}

/** How to play a song: right after the current one, and whether a YouTube playlist link means all of it. */
export interface PlayOptions {
  next: boolean;
  wholePlaylist: boolean;
}

/** What Keith can ask the music bot to do. musicTools.ts uses this; tests pass a fake. */
export interface MusicBot {
  /** As `user`: Brick only shows the player to members of the server. */
  state(guildId: string, user: ActingUser): Promise<Result<PlayerState>>;
  play(guildId: string, user: ActingUser, query: string, options: PlayOptions): Promise<Result<PlayerState>>;
  skip(guildId: string, user: ActingUser): Promise<Result<PlayerState>>;
  pause(guildId: string, user: ActingUser): Promise<Result<PlayerState>>;
  resume(guildId: string, user: ActingUser): Promise<Result<PlayerState>>;
  setVolume(guildId: string, user: ActingUser, percent: number): Promise<Result<PlayerState>>;
  /** An audio effect like "nightcore" or "daycore", or "off". Brick checks the name. */
  setEffect(guildId: string, user: ActingUser, effect: string): Promise<Result<PlayerState>>;
  /** Plays a song from the queue right away (by its id), skipping the current one. */
  playQueued(guildId: string, user: ActingUser, itemId: string): Promise<Result<PlayerState>>;
  /** Takes a song out of the queue (by its id). */
  removeQueued(guildId: string, user: ActingUser, itemId: string): Promise<Result<PlayerState>>;
  /** The server's saved playlists. */
  listPlaylists(guildId: string, user: ActingUser): Promise<Result<PlaylistSummary[]>>;
  /** Plays a saved playlist: added to the end of the queue ("append"), or instead of it ("replace"). */
  playPlaylist(
    guildId: string,
    user: ActingUser,
    playlistId: number,
    mode: 'append' | 'replace',
  ): Promise<Result<{ result: AddManyResult; state: PlayerState }>>;
  /** Turns the music down while Keith talks (true), and back up (false). */
  duck(guildId: string, on: boolean): Promise<Result<unknown>>;
}

export interface BrickSettings {
  /** e.g. http://localhost:3000/api */
  baseUrl: string;
  key: string;
  /** How long to wait for an answer. Default 5 s. */
  timeoutMs?: number;
}

export class BrickClient implements MusicBot {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly settings: BrickSettings) {
    this.baseUrl = settings.baseUrl.replace(/\/$/, '');
    this.timeoutMs = settings.timeoutMs ?? 5000;
  }

  state(guildId: string, user: ActingUser) {
    return this.request<PlayerState>('GET', `/guilds/${guildId}/state`, undefined, user);
  }

  play(guildId: string, user: ActingUser, query: string, { next, wholePlaylist }: PlayOptions) {
    // Brick queues a single song from a YouTube playlist link unless asked for the whole playlist.
    const body = wholePlaylist ? { input: query, next, wholePlaylist: true } : { input: query, next };
    return this.request<PlayerState>('POST', `/guilds/${guildId}/queue`, body, user);
  }

  skip(guildId: string, user: ActingUser) {
    return this.request<PlayerState>('POST', `/guilds/${guildId}/player/skip`, {}, user);
  }

  pause(guildId: string, user: ActingUser) {
    return this.request<PlayerState>('POST', `/guilds/${guildId}/player/pause`, {}, user);
  }

  resume(guildId: string, user: ActingUser) {
    return this.request<PlayerState>('POST', `/guilds/${guildId}/player/resume`, {}, user);
  }

  setVolume(guildId: string, user: ActingUser, percent: number) {
    return this.request<PlayerState>('POST', `/guilds/${guildId}/player/volume`, { volume: percent }, user);
  }

  setEffect(guildId: string, user: ActingUser, effect: string) {
    return this.request<PlayerState>('POST', `/guilds/${guildId}/player/filter`, { filter: effect }, user);
  }

  playQueued(guildId: string, user: ActingUser, itemId: string) {
    return this.request<PlayerState>('POST', `/guilds/${guildId}/queue/${encodeURIComponent(itemId)}/play`, {}, user);
  }

  removeQueued(guildId: string, user: ActingUser, itemId: string) {
    // An empty JSON body, because Brick only accepts changes sent as JSON, deletes included.
    return this.request<PlayerState>('DELETE', `/guilds/${guildId}/queue/${encodeURIComponent(itemId)}`, {}, user);
  }

  listPlaylists(guildId: string, user: ActingUser) {
    return this.request<PlaylistSummary[]>('GET', `/guilds/${guildId}/playlists`, undefined, user);
  }

  playPlaylist(guildId: string, user: ActingUser, playlistId: number, mode: 'append' | 'replace') {
    return this.request<{ result: AddManyResult; state: PlayerState }>(
      'POST',
      `/guilds/${guildId}/playlists/${playlistId}/play`,
      { mode },
      user,
    );
  }

  duck(guildId: string, on: boolean) {
    return this.request<unknown>('POST', `/guilds/${guildId}/player/duck`, { on });
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    actingAs?: ActingUser,
  ): Promise<Result<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.settings.key}` };
    // Brick only accepts changes sent as JSON (a guard against other websites), so every change is.
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (actingAs) {
      headers['X-Acting-User-Id'] = actingAs.id;
      // Headers must be plain ASCII; names can have accents and emoji.
      headers['X-Acting-User-Name'] = encodeURIComponent(actingAs.name);
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return { ok: false, error: describeFetchFailure(err as Error, this.timeoutMs) };
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = (data as { error?: string } | null)?.error;
      return { ok: false, error: reason ?? `Brick answered HTTP ${response.status}` };
    }
    return { ok: true, value: data as T };
  }
}

function describeFetchFailure(err: Error, timeoutMs: number): string {
  if (err.name === 'TimeoutError') return `Brick didn't answer within ${timeoutMs / 1000} s`;
  return `Brick isn't running, or Keith couldn't reach him (${err.message})`;
}
