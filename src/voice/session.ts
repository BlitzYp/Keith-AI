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
import { config } from '../config.js';
import { PiperWorker } from '../tts/piper.js';
import { SpeechQueue, type ReplySpeech } from './speechQueue.js';

/** One Piper for the whole bot: it handles sentences one at a time anyway. */
const piper = new PiperWorker(config.piper);

/**
 * Keith in one voice channel: the Discord connection, an audio player, and the queue of
 * sentences to speak. The queue (speechQueue.ts) decides what plays when; this class only
 * connects it to Discord.
 */
export class VoiceSession {
  readonly connection: VoiceConnection;
  private readonly player: AudioPlayer;
  private readonly speech: SpeechQueue;

  private constructor(
    channel: VoiceBasedChannel,
    /** Text channel whose bot replies get read aloud in this VC. */
    public readonly textChannelId: string,
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
    this.player.on('error', (err) => {
      console.error('[voice] player error:', err.message);
    });

    this.speech = new SpeechQueue({
      synthesize: (text) => piper.synthesize(text),
      play: (file) => this.playFile(file),
      stopPlaying: () => this.player.stop(true),
      deleteFile: (file) => unlink(file),
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
      this.speech.stop();
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
    piper.warmUp(); // load the voice while the connection comes up
    const session = new VoiceSession(channel, textChannelId, onDestroyed);
    try {
      await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      session.destroy();
      throw new Error(
        'Could not connect to the voice channel within 20s. ' +
          'Check that @snazzah/davey is installed (Discord requires DAVE encryption).',
      );
    }
    return session;
  }

  /** Queues text to be spoken, e.g. from /say. */
  speak(text: string): void {
    if (this.isDestroyed()) return;
    this.speech.speak(text);
  }

  /** Speaks a chat reply while it streams in. */
  startReply(): ReplySpeech {
    return this.speech.startReply();
  }

  /** Stops current speech and drops anything queued (/shutup, barge-in). */
  stop(): void {
    this.speech.stop();
  }

  destroy(): void {
    if (!this.isDestroyed()) this.connection.destroy();
  }

  private isDestroyed(): boolean {
    return this.connection.state.status === VoiceConnectionStatus.Destroyed;
  }

  /** Plays one WAV file; resolves when the player goes idle (finished, stopped or failed). */
  private playFile(file: string): Promise<void> {
    return new Promise((resolve) => {
      this.player.once(AudioPlayerStatus.Idle, () => resolve());
      this.player.play(createAudioResource(wavToDiscordPcm(file), { inputType: StreamType.Raw }));
    });
  }
}

/**
 * Piper outputs mono WAV at the voice model's sample rate (often 22050 Hz).
 * Discord wants 48 kHz stereo 16-bit PCM, so resample with ffmpeg.
 */
function wavToDiscordPcm(file: string) {
  // ffmpeg-static's types declare `export default`, but the package is CommonJS, so under
  // NodeNext TypeScript types the default import as the whole module. At runtime it's the path.
  const bin = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
  const ff = spawn(
    bin,
    ['-loglevel', 'error', '-i', file, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  );
  return ff.stdout;
}
