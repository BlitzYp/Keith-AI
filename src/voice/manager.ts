import type { VoiceBasedChannel } from 'discord.js';
import { VoiceSession } from './session.js';

/** Tracks the active voice session in each guild. */
class VoiceManager {
  private readonly sessions = new Map<string, VoiceSession>();

  get(guildId: string): VoiceSession | undefined {
    return this.sessions.get(guildId);
  }

  async join(channel: VoiceBasedChannel, textChannelId: string): Promise<VoiceSession> {
    const guildId = channel.guild.id;
    this.sessions.get(guildId)?.destroy();

    // `let` so the destroy callback can safely run even if joining fails.
    let session: VoiceSession | undefined;
    session = await VoiceSession.join(channel, textChannelId, () => {
      if (session && this.sessions.get(guildId) === session) this.sessions.delete(guildId);
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
