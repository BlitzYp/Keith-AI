// Uses the real opusscript (it's pure JS/WebAssembly, so this runs anywhere).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import OpusScript from 'opusscript';
import { OpusDecoders } from './opusDecoder.js';

/** The copy of opusscript everything else gets, including @discordjs/voice for playback. */
const sharedEncoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
/** 20 ms of 48 kHz stereo: 960 frames × 2 channels × 2 bytes. */
const TWENTY_MS = 960 * 2 * 2;
const goodPacket = sharedEncoder.encode(Buffer.alloc(TWENTY_MS, 3), 960);

/**
 * Breaks a copy of opusscript the way it broke in Discord: its WebAssembly memory can't grow,
 * so about 54 decoders that have decoded something fill it, and the next one fails with
 * "memory access out of bounds".
 */
function fillUp(decoders: OpusDecoders): void {
  for (let i = 0; i < 80; i++) {
    try {
      decoders.create().decode(goodPacket); // never closed: that's what fills it up
    } catch {
      return; // broken now
    }
  }
  assert.fail('expected the copy to break before 80 decoders');
}

describe('OpusDecoders', () => {
  it('decodes a real Opus packet into 20 ms of 48 kHz stereo', () => {
    const decoder = new OpusDecoders().create();
    assert.equal(decoder.decode(goodPacket).length, TWENTY_MS);
    decoder.close();
  });

  it('loads a fresh copy of opusscript once its copy breaks, so listening carries on', () => {
    const decoders = new OpusDecoders();
    fillUp(decoders);

    const decoder = decoders.create();
    assert.equal(decoder.decode(goodPacket).length, TWENTY_MS);
    decoder.close();
  });

  it("keeps playback's copy of opusscript working when listening's copy breaks", () => {
    fillUp(new OpusDecoders());
    assert.ok(sharedEncoder.encode(Buffer.alloc(TWENTY_MS, 1), 960).length > 0);
  });

  it('lets a decoder be closed twice without harm', () => {
    const decoder = new OpusDecoders().create();
    decoder.close();
    assert.doesNotThrow(() => decoder.close());
  });
});
