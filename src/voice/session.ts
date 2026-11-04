import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import {
  AudioPlayerStatus,
  EndBehaviorType,
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
import { ApiTranscriber } from '../stt/apiTranscriber.js';
import type { Transcriber } from '../stt/transcriber.js';
import { WhisperWorker } from '../stt/whisper.js';
import { PiperWorker } from '../tts/piper.js';
import { VoiceListener } from './listener.js';
import { OpusDecoders } from './opusDecoder.js';
import { IDLE_PHRASES } from '../personality/phrases.js';
import { brick } from '../music/brick.js';
import { Ducker } from './ducker.js';
import { IdleChatter } from './idleChatter.js';
import { SpeechQueue, type ReplySpeech } from './speechQueue.js';

/** One Piper for the whole bot: it handles sentences one at a time anyway. */
const piper = new PiperWorker(config.piper);

/** One speech-to-text for the whole bot, picked by STT_ENGINE. */
const transcriber: Transcriber =
  config.stt.engine === 'api'
    ? new ApiTranscriber({ ...config.stt.api, language: config.stt.language, prompt: config.stt.prompt })
    : new WhisperWorker({ ...config.stt.local, language: config.stt.language, prompt: config.stt.prompt });

/** Listening's own copy of opusscript, kept apart from playback's (see opusDecoder.ts). */
const opusDecoders = new OpusDecoders();

/**
 * How long someone has to be quiet before Keith takes it they've finished their sentence.
 * Shorter answers sooner but cuts people off when they pause to think.
 */
const END_OF_SPEECH_SILENCE_MS = 1200;

/**
 * /musings: Keith says a random line after a quiet stretch somewhere between these two.
 * Long enough that it stays a surprise rather than a routine.
 */
const MUSINGS_MIN_QUIET_MS = 90_000;
const MUSINGS_MAX_QUIET_MS = 6 * 60_000;

/** "Failed to decrypt" can come 50 times a second; one line every few seconds is plenty. */
const DECRYPT_LOG_INTERVAL_MS = 5_000;

/** Something said in Keith's voice channel, ready to be answered in its text channel. */
export interface SpokenMessage {
  guildId: string;
  /** The text channel /join was used in: where the transcript and reply go. */
  textChannelId: string;
  /** Display name of whoever said it. */
  speaker: string;
  /** Their Discord user id, so music commands act as them. */
  userId: string;
  text: string;
}

export interface VoiceSessionEvents {
  /** Called with each thing someone says in the voice channel. */
  onHeard(spoken: SpokenMessage): void;
  onDestroyed(): void;
}

/**
 * Keith in one voice channel: the Discord connection, an audio player, and the queue of
 * sentences to speak. The queue (speechQueue.ts) decides what plays when; this class only
 * connects it to Discord.
 */
export class VoiceSession {
  readonly connection: VoiceConnection;
  private readonly player: AudioPlayer;
  private readonly speech: SpeechQueue;
  /** Random lines in quiet moments, when /musings is on. */
  private readonly musings: IdleChatter;
  /** Turns the music bot down while Keith speaks; null when there's no music bot (MUSIC_BOT_KEY). */
  private readonly ducker: Ducker | null;

  private constructor(
    channel: VoiceBasedChannel,
    /** Text channel whose bot replies get read aloud in this VC. */
    public readonly textChannelId: string,
    events: VoiceSessionEvents,
  ) {
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false, // Keith has to hear people to listen to them
      selfMute: false,
      // daveEncryption defaults to true and needs @snazzah/davey installed.
      debug: true, // for the DAVE log lines below
    });
    this.logEncryptionTrouble();

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.connection.subscribe(this.player);
    this.player.on('error', (err) => {
      console.error('[voice] player error:', err.message);
    });

    this.musings = new IdleChatter({
      phrases: IDLE_PHRASES,
      say: (text) => this.speak(text),
      minQuietMs: MUSINGS_MIN_QUIET_MS,
      maxQuietMs: MUSINGS_MAX_QUIET_MS,
    });

    this.ducker = brick ? createDucker(channel.guild.id) : null;

    this.speech = new SpeechQueue({
      synthesize: (text) => piper.synthesize(text),
      // Keith talking counts as noise too: the next musing waits for quiet after he's done.
      play: async (file) => {
        this.musings.heardActivity();
        this.ducker?.speaking();
        await this.playFile(file);
        this.ducker?.quiet();
        this.musings.heardActivity();
      },
      stopPlaying: () => this.player.stop(true),
      deleteFile: (file) => unlink(file),
    });

    this.startListening(channel, events.onHeard);

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
      this.musings.stop(); // or its timer would outlive the session
      this.ducker?.stop(); // music back up if Keith leaves mid-sentence
      this.speech.stop();
      events.onDestroyed();
    });
    this.connection.on('error', (err) => {
      console.error('[voice] connection error:', err.message);
    });
  }

  static async join(
    channel: VoiceBasedChannel,
    textChannelId: string,
    events: VoiceSessionEvents,
  ): Promise<VoiceSession> {
    // Load the voice and the speech-to-text model while the connection comes up.
    piper.warmUp();
    transcriber.warmUp();
    const session = new VoiceSession(channel, textChannelId, events);
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

  /** Turns random lines in quiet moments on or off (/musings). */
  setMusings(on: boolean): void {
    if (on && !this.isDestroyed()) this.musings.start();
    else this.musings.stop();
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

  /**
   * Hands each person's audio to the listener (listener.ts) when they start speaking. The listener
   * ends the utterance after END_OF_SPEECH_SILENCE_MS without a packet, and transcribes it.
   */
  private startListening(
    channel: VoiceBasedChannel,
    onHeard: (spoken: SpokenMessage) => void,
  ): void {
    const { guild } = channel;
    const listener = new VoiceListener({
      // Members in a voice channel are cached through their voice states. Unknown means "not a bot".
      shouldListenTo: (userId) => !guild.members.cache.get(userId)?.user.bot,
      nameOf: (userId) => guild.members.cache.get(userId)?.displayName ?? userId,
      silenceMs: END_OF_SPEECH_SILENCE_MS,
      createDecoder: () => opusDecoders.create(),
      transcribe: (pcm) => transcriber.transcribe(pcm),
      onHeard: ({ userId, text }) => {
        if (this.isDestroyed()) return; // finished transcribing after Keith left
        // Someone said something: no musing for a while. (This also covers open mics, which
        // don't trigger a new 'start' below while they keep sending.)
        this.musings.heardActivity();
        const speaker = guild.members.cache.get(userId)?.displayName ?? 'Someone';
        onHeard({ guildId: guild.id, textChannelId: this.textChannelId, speaker, userId, text });
      },
    });

    const receiver = this.connection.receiver;
    receiver.speaking.on('start', (userId) => {
      this.musings.heardActivity();
      // Still recording them: they paused briefly and carried on, inside the same utterance.
      if (receiver.subscriptions.has(userId)) return;
      // Manual: the listener decides when they've stopped, and ends the stream by letting go of it.
      const packets = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
      void listener.hear(userId, packets);
    });
  }

  /** Logs Discord's end-to-end encryption trouble: undecryptable audio is audio Keith can't hear. */
  private logEncryptionTrouble(): void {
    let lastDecryptLog = 0;
    this.connection.on('debug', (message) => {
      // Only the DAVE session's own messages. The other debug lines (state changes, websocket
      // traffic) include the voice connection's secret key and token, which don't belong in a log.
      if (!message.includes('[DAVE]')) return;
      if (/decrypt/i.test(message)) {
        if (Date.now() - lastDecryptLog < DECRYPT_LOG_INTERVAL_MS) return;
        lastDecryptLog = Date.now();
      }
      console.warn('[voice] DAVE:', message);
    });
  }

  /** Plays one WAV file; resolves when the player goes idle (finished, stopped or failed). */
  private playFile(file: string): Promise<void> {
    return new Promise((resolve) => {
      this.player.once(AudioPlayerStatus.Idle, () => resolve());
      this.player.play(createAudioResource(wavToDiscordPcm(file), { inputType: StreamType.Raw }));
    });
  }
}

/** Asks the music bot to turn down (or up) in this server; a failure is logged, never thrown. */
function createDucker(guildId: string): Ducker {
  return new Ducker({
    setDucked: (on) => {
      void brick?.duck(guildId, on).then((result) => {
        if (!result.ok) console.warn(`[music] couldn't turn the music ${on ? 'down' : 'up'}: ${result.error}`);
      });
    },
  });
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
