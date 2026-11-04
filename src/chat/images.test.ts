import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_IMAGES, MAX_IMAGE_BYTES, pickImages, toDataUrl } from './images.js';

function attachment(name: string, contentType: string | null, size = 1000) {
  return { url: `https://cdn.example/${name}`, contentType, size };
}

describe('pickImages', () => {
  it('keeps pictures and skips other files', () => {
    const picked = pickImages([
      attachment('cat.png', 'image/png'),
      attachment('notes.pdf', 'application/pdf'),
      attachment('dog.jpg', 'image/jpeg'),
      attachment('mystery', null),
    ]);
    assert.deepEqual(picked.map((a) => a.url), ['https://cdn.example/cat.png', 'https://cdn.example/dog.jpg']);
  });

  it('skips picture formats models usually reject (like SVG and HEIC)', () => {
    const picked = pickImages([attachment('logo.svg', 'image/svg+xml'), attachment('phone.heic', 'image/heic')]);
    assert.deepEqual(picked, []);
  });

  it('skips pictures too big to send', () => {
    const picked = pickImages([attachment('huge.png', 'image/png', MAX_IMAGE_BYTES + 1)]);
    assert.deepEqual(picked, []);
  });

  it('takes at most a few pictures, so one message can not cost a fortune', () => {
    const many = Array.from({ length: MAX_IMAGES + 3 }, (_, i) => attachment(`${i}.png`, 'image/png'));
    assert.equal(pickImages(many).length, MAX_IMAGES);
  });

  it('reads "image/PNG; charset" style types too', () => {
    assert.equal(pickImages([attachment('a.png', 'IMAGE/PNG; whatever')]).length, 1);
  });
});

describe('toDataUrl', () => {
  it('packs the picture into the message itself, so the model never has to fetch a Discord link', () => {
    assert.equal(toDataUrl(Buffer.from('cat'), 'image/png'), 'data:image/png;base64,Y2F0');
  });
});
