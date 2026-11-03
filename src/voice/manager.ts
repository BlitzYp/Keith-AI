import type { VoiceBasedChannel } from 'discord.js';
import { config } from '../config.js';
import { DEFAULT_LISTEN_MODE, shouldAnswer, type ListenMode } from './addressing.js';
import { VoiceSession, type SpokenMessage } from './session.js';

/** Tracks the active voice session in each guild. */
class VoiceManager {
  private readonly sessions = new Map<string, VoiceSession>();
  /** What to do with speech Keith hears. index.ts sets it; until then Keith only talks. */
  private heardHandler: (spoken: SpokenMessage) => void = () => {};
  /** Each server's /listen choice. Kept across /leave and /join; a restart resets it. */
  private readonly listenModes = new Map<string, ListenMode>();

  /** Sets what happens when someone says something in any of Keith's voice channels. */
  onHeard(handler: (spoken: SpokenMessage) => void): void {
    this.heardHandler = handler;
  }

  listenMode(guildId: string): ListenMode {
    return this.listenModes.get(guildId) ?? DEFAULT_LISTEN_MODE;
  }

  setListenMode(guildId: string, mode: ListenMode): void {
    this.listenModes.set(guildId, mode);
  }

  get(guildId: string): VoiceSession | undefined {
    return this.sessions.get(guildId);
  }

  async join(channel: VoiceBasedChannel, textChannelId: string): Promise<VoiceSession> {
    const guildId = channel.guild.id;
    this.sessions.get(guildId)?.destroy();

    // `let` so the destroy callback can safely run even if joining fails.
    let session: VoiceSession | undefined;
    session = await VoiceSession.join(channel, textChannelId, {
      onHeard: (spoken) => {
        if (shouldAnswer(spoken.text, this.listenMode(guildId), config.bot.name)) {
          this.heardHandler(spoken);
        } else {
          console.log(`[listen] not answering ${spoken.speaker}: no "${config.bot.name}" in it`);
        }
      },
      onDestroyed: () => {
        if (session && this.sessions.get(guildId) === session) this.sessions.delete(guildId);
      },
    });
    this.sessions.set(guildId, session);
    return session;
  }

  leave(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) return false;
    session.destroy();
    this.sessions.delete(guildId);
    return true;
  }

  leaveAll(): void {
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
  }
}

export const voiceManager = new VoiceManager();
