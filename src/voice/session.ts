import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import ffmpegPath from 'ffmpeg-static';
import { synthesize } from '../tts/piper.js';
import { cleanForSpeech } from '../tts/text.js';

/**
 * One voice session per guild: the voice connection, an audio player, and an
 * ordered queue of sentences to speak. Sentences are synthesized in parallel
 * as they arrive but always played in order.
 */
export class VoiceSession {
  readonly connection: VoiceConnection;
  private readonly player: AudioPlayer;
  private readonly queue: Promise<string | null>[] = [];
  private playing = false;
  private currentFile: string | null = null;
  /** Bumped by stop(); anything queued under an older generation is discarded. */
  private gen = 0;

  private constructor(
    channel: VoiceBasedChannel,
    /** Text channel whose bot replies get read aloud in this VC. */
    public textChannelId: string,
    private readonly onDestroyed: () => void,
  ) {
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false, // stage 3 (listening) needs to hear people
      selfMute: false,
      // daveEncryption defaults to true and needs @snazzah/davey installed.
    });

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      void this.cleanupCurrent();
      this.playing = false;
      void this.playNext();
    });
    this.player.on('error', (err) => {
      console.error('[voice] player error:', err.message);
    });

    // Standard reconnect handling: if Discord moves or briefly drops us, wait
    // for it to recover; otherwise tear the session down.
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.stop();
      void this.cleanupCurrent();
      this.onDestroyed();
    });
    this.connection.on('error', (err) => {
      console.error('[voice] connection error:', err.message);
    });
  }

  static async join(
    channel: VoiceBasedChannel,
    textChannelId: string,
    onDestroyed: () => void,
  ): Promise<VoiceSession> {
    const session = new VoiceSession(channel, textChannelId, onDestroyed);
    try {
      await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      session.destroy();
      throw new Error(
        'Could not connect to the voice channel within 20s. ' +
          'Check that @snazzah/davey is installed (Discord requires DAVE encryption).',
      );
    }
    return session;
  }

  /** Changes every time stop() runs, so a streaming reply can tell it was cut off. */
  get generation(): number {
    return this.gen;
  }

  /** Queues text to be spoken. Safe to call once per sentence while a reply streams in. */
  speak(text: string): void {
    if (this.connection.state.status === VoiceConnectionStatus.Destroyed) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    this.queue.push(
      synthesize(clean).catch((err: Error) => {
        console.error('[tts]', err.message);
        return null;
      }),
    );
    void this.playNext();
  }

  /** Stops current speech and drops anything queued (barge-in). */
  stop(): void {
    this.gen++;
    // Sentences still being synthesized: delete their WAVs once Piper finishes.
    for (const pending of this.queue.splice(0)) {
      void pending.then((file) => {
        if (file) return unlink(file).catch(() => {});
      });
    }
    this.player.stop(true);
  }

  destroy(): void {
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
  }

  private async playNext(): Promise<void> {
    if (this.playing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.playing = true;
    const gen = this.gen;

    const file = await next;
    if (gen !== this.gen) {
      // stop() ran while this sentence was being synthesized.
      if (file) await unlink(file).catch(() => {});
      this.playing = false;
      return this.playNext();
    }
    if (!file) {
      this.playing = false;
      return this.playNext();
    }

    this.currentFile = file;
    this.player.play(
      createAudioResource(wavToDiscordPcm(file), { inputType: StreamType.Raw }),
    );
  }

  private async cleanupCurrent(): Promise<void> {
    const file = this.currentFile;
    this.currentFile = null;
    if (file) await unlink(file).catch(() => {});
  }
}

/**
 * Piper outputs mono WAV at the voice model's sample rate (often 22050 Hz).
 * Discord wants 48 kHz stereo 16-bit PCM, so resample with ffmpeg.
 */
function wavToDiscordPcm(file: string) {
  const bin = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
  const ff = spawn(
    bin,
    ['-loglevel', 'error', '-i', file, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  );
  return ff.stdout;
}
