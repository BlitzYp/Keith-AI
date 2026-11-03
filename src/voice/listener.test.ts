import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VoiceListener, type HeardSpeech, type ListenerOptions, type OpusDecoder } from './listener.js';
import { loudFrame } from './speechDetector.js';

/** The error WebAssembly throws when opusscript breaks. */
const { RuntimeError } = WebAssembly;


/** Fake Opus packets: the fake decoder turns LOUD into 20 ms of talking, QUIET into 20 ms of hush. */
const LOUD = Buffer.from([1]);
const QUIET = Buffer.from([0]);
/** 20 ms of talking at a normal level (about -20 dBFS). */
const TALKING = loudFrame(3000);

/** Pretends to be `count` Opus packets of someone talking (count × 20 ms). */
async function* packets(count: number): AsyncGenerator<Buffer> {
  for (let i = 0; i < count; i++) yield LOUD;
}

/** Packets in the order given, e.g. sequence([LOUD, 50], [QUIET, 100]) is 1 s of talk, 2 s of hush. */
async function* sequence(...parts: [Buffer, number][]): AsyncGenerator<Buffer> {
  for (const [packet, count] of parts) for (let i = 0; i < count; i++) yield packet;
}

/** A decoder for LOUD and QUIET packets that remembers being closed. */
function fakeDecoder(): OpusDecoder & { closed: boolean } {
  return {
    closed: false,
    decode: (packet) => (packet.equals(QUIET) ? loudFrame(0) : TALKING),
    close() {
      this.closed = true;
    },
  };
}

/** A promise you resolve or reject by hand, to control when a fake transcription finishes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Never resolves: a packet stream that has gone quiet but hasn't ended. */
const forever = new Promise<never>(() => {});

/**
 * Packets that stop coming without the stream ending, like Discord's stream does: it only ends
 * when destroyed. Remembers whether the listener destroyed it.
 */
function goesQuiet(count: number) {
  let sent = 0;
  const stream = {
    destroyed: false,
    destroy() {
      stream.destroyed = true;
    },
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<Buffer>> =>
        sent++ < count ? Promise.resolve({ value: LOUD, done: false }) : forever,
    }),
  };
  return stream;
}

/** A listener with fakes for everything; each test overrides what it cares about. */
function setUp(overrides: Partial<ListenerOptions> = {}) {
  const heard: HeardSpeech[] = [];
  const transcribed: Buffer[] = [];
  const logs: string[] = [];
  const listener = new VoiceListener({
    log: (line) => logs.push(line),
    shouldListenTo: () => true,
    createDecoder: fakeDecoder,
    transcribe: async (pcm) => {
      transcribed.push(pcm);
      return 'Hello Keith.';
    },
    onHeard: (speech) => {
      heard.push(speech);
    },
    ...overrides,
  });
  return { listener, heard, transcribed, logs };
}

describe('VoiceListener', () => {
  it('transcribes what someone said and passes it on', async () => {
    const { listener, heard, transcribed } = setUp();
    await listener.hear('alice', packets(50)); // 50 × 20 ms = 1 s

    assert.deepEqual(heard, [{ userId: 'alice', text: 'Hello Keith.' }]);
    // Whisper gets 16 kHz mono: 1 s is 16,000 samples of 2 bytes.
    assert.equal(transcribed[0]?.length, 32_000);
  });

  it("doesn't listen to people it shouldn't (like other bots)", async () => {
    const { listener, heard, transcribed } = setUp({ shouldListenTo: (userId) => userId !== 'musicbot' });
    await listener.hear('musicbot', packets(50));

    assert.equal(transcribed.length, 0);
    assert.equal(heard.length, 0);
  });

  it('ignores sounds too short to be speech, like a click or a cough', async () => {
    const { listener, transcribed } = setUp({ minSpeechMs: 400 });
    await listener.hear('alice', packets(10)); // 200 ms

    assert.equal(transcribed.length, 0);
  });

  it('passes nothing on when the transcript has no words in it', async () => {
    const { listener, heard } = setUp({ transcribe: async () => '[BLANK_AUDIO]' });
    await listener.hear('alice', packets(50));

    assert.equal(heard.length, 0);
  });

  it('passes things on in the order people finished saying them, even if transcription finishes out of order', async () => {
    const aliceText = deferred<string>();
    const bobText = deferred<string>();
    const { listener, heard } = setUp({
      transcribe: (pcm) => (pcm.length === 32_000 ? aliceText.promise : bobText.promise),
    });

    const alice = listener.hear('alice', packets(50)); // 1 s: finishes talking first
    const bob = listener.hear('bob', packets(60)); // 1.2 s: finishes second
    bobText.resolve('I was second.');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heard.length, 0, "Bob's words wait for Alice's");

    aliceText.resolve('I was first.');
    await Promise.all([alice, bob]);
    assert.deepEqual(heard, [
      { userId: 'alice', text: 'I was first.' },
      { userId: 'bob', text: 'I was second.' },
    ]);
  });

  it('keeps listening after a transcription fails', async () => {
    let calls = 0;
    const { listener, heard } = setUp({
      transcribe: async () => {
        calls++;
        if (calls === 1) throw new Error('Whisper fell over');
        return 'Still here?';
      },
    });

    await listener.hear('alice', packets(50));
    await listener.hear('alice', packets(50));
    assert.deepEqual(heard, [{ userId: 'alice', text: 'Still here?' }]);
  });

  it('stops recording at the length limit, so one long talker can not fill up memory', async () => {
    const { listener, transcribed } = setUp({ maxSpeechMs: 1000 });
    await listener.hear('alice', packets(100)); // 2 s of talking

    assert.equal(transcribed[0]?.length, 32_000, 'only the first 1 s is kept');
  });

  it('skips a packet the decoder can not read and keeps the rest', async () => {
    let decoded = 0;
    const { listener, transcribed } = setUp({
      createDecoder: () => ({
        decode: () => {
          decoded++;
          if (decoded === 3) throw new Error('corrupt packet');
          return TALKING;
        },
        close: () => {},
      }),
    });
    await listener.hear('alice', packets(51));

    assert.equal(transcribed[0]?.length, 32_000, '50 good packets = 1 s');
  });

  it("keeps running when a decoder can't be made (this used to crash Keith)", async () => {
    const { listener, transcribed } = setUp({
      createDecoder: () => {
        throw new RuntimeError('memory access out of bounds');
      },
    });
    await listener.hear('alice', packets(50)); // resolves instead of rejecting

    assert.equal(transcribed.length, 0);
  });

  it("skips packets still under Discord's end-to-end encryption (DAVE frames end in FA FA)", async () => {
    let decoded = 0;
    async function* someStillEncrypted() {
      yield* packets(50);
      // While a DAVE session is still being set up, @discordjs/voice passes frames on undecrypted.
      for (let i = 0; i < 25; i++) yield Buffer.from([0x12, 0x34, 0x56, 0xfa, 0xfa]);
    }
    const { listener, transcribed } = setUp({
      createDecoder: () => ({
        decode: () => {
          decoded++;
          return TALKING;
        },
        close: () => {},
      }),
    });
    await listener.hear('alice', someStillEncrypted());

    assert.equal(decoded, 50, 'only the real Opus packets were decoded');
    assert.equal(transcribed[0]?.length, 32_000);
  });

  it("ends the recording after a silence even if the packet stream doesn't end", async () => {
    const { listener, heard, transcribed } = setUp({ silenceMs: 30 });
    await listener.hear('alice', goesQuiet(50));

    assert.equal(transcribed[0]?.length, 32_000, '50 packets = 1 s');
    assert.deepEqual(heard, [{ userId: 'alice', text: 'Hello Keith.' }]);
  });

  it('gives up on a stream that never sends a packet (this made Keith ignore someone for good)', async () => {
    const { listener, transcribed } = setUp({ silenceMs: 30 });
    await listener.hear('alice', goesQuiet(0)); // resolves instead of waiting forever

    assert.equal(transcribed.length, 0);
  });

  it('ends a sentence after a quiet stretch even when packets keep coming (an always-on mic)', async () => {
    const { listener, heard, transcribed } = setUp({ silenceMs: 700 });
    // 1 s of talking, then 2 s of hush: 700 ms of it is enough to end the sentence.
    await listener.hear('alice', sequence([LOUD, 50], [QUIET, 100]));

    assert.equal(transcribed[0]?.length, 32_000, 'the 1 s of talking; the hush after it is cut off');
    assert.deepEqual(heard, [{ userId: 'alice', text: 'Hello Keith.' }]);
  });

  it('hears every sentence on an always-on mic, not just the first', async () => {
    const { listener, transcribed } = setUp({ silenceMs: 700 });
    await listener.hear('alice', sequence([LOUD, 50], [QUIET, 50], [LOUD, 25], [QUIET, 50]));

    // 1 s, then 0.5 s plus the 200 ms of lead-in kept from the hush before it.
    assert.deepEqual(
      transcribed.map((pcm) => pcm.length),
      [32_000, 22_400],
    );
  });

  it('skips the hush before someone talks, apart from a short lead-in so the first word is whole', async () => {
    const { listener, transcribed } = setUp();
    await listener.hear('alice', sequence([QUIET, 200], [LOUD, 50])); // 4 s of hush, 1 s of talking

    assert.equal(transcribed[0]?.length, 38_400, '1 s of talking + 200 ms lead-in = 1.2 s');
  });

  it('ignores a short noise on an always-on mic', async () => {
    const { listener, transcribed } = setUp();
    await listener.hear('alice', sequence([QUIET, 50], [LOUD, 5], [QUIET, 100])); // a 100 ms click

    assert.equal(transcribed.length, 0);
  });

  it('destroys the packet stream as soon as the utterance is recorded, so the next one can start', async () => {
    const replyDone = deferred<void>();
    const { listener } = setUp({ silenceMs: 30, onHeard: () => replyDone.promise });
    const stream = goesQuiet(50);
    const hearing = listener.hear('alice', stream);

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(stream.destroyed, true, "doesn't wait for Keith's answer before letting go");
    replyDone.resolve();
    await hearing;
  });

  it('logs who spoke and what Keith heard', async () => {
    const { listener, logs } = setUp({ nameOf: () => 'Alice' });
    await listener.hear('alice', packets(50));

    assert.match(logs.join('\n'), /Alice: 1\.0 s → "Hello Keith\."/);
  });

  it('logs why speech was dropped, so a quiet Keith can be explained', async () => {
    const short = setUp();
    await short.listener.hear('alice', packets(10));
    assert.match(short.logs.join('\n'),/alice: 0\.2 s, too short to be speech/);

    const blank = setUp({ transcribe: async () => '[BLANK_AUDIO]' });
    await blank.listener.hear('alice', packets(50));
    assert.match(blank.logs.join('\n'),/alice: 1\.0 s → nothing \(Whisper heard "\[BLANK_AUDIO\]"\)/);

    const encrypted = setUp();
    async function* allEncrypted() {
      for (let i = 0; i < 25; i++) yield Buffer.from([0x12, 0xfa, 0xfa]);
    }
    await encrypted.listener.hear('alice', allEncrypted());
    assert.match(encrypted.logs.join('\n'),/alice: skipped 25 packets still encrypted/);
  });

  it('drops what it recorded if the audio stream breaks (e.g. Keith left the channel)', async () => {
    async function* breaksHalfway() {
      yield* packets(50);
      throw new Error('stream destroyed');
    }
    const { listener, transcribed } = setUp();
    await listener.hear('alice', breaksHalfway());

    assert.equal(transcribed.length, 0);
  });

  it('closes each decoder once the utterance is recorded', async () => {
    const decoders: ReturnType<typeof fakeDecoder>[] = [];
    const { listener } = setUp({
      createDecoder: () => {
        const decoder = fakeDecoder();
        decoders.push(decoder);
        return decoder;
      },
    });
    await listener.hear('alice', packets(50));

    assert.equal(decoders.length, 1);
    assert.equal(decoders[0]?.closed, true);
  });
});
