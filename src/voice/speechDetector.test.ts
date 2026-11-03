import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpeechDetector, loudFrame } from './speechDetector.js';

describe('SpeechDetector', () => {
  it('hears digital silence as not speech', () => {
    assert.equal(new SpeechDetector().isSpeech(loudFrame(0)), false);
  });

  it('hears a faint hiss as not speech', () => {
    // A level of 100 out of 32,767 is about -50 dBFS: room tone on a quiet mic.
    assert.equal(new SpeechDetector().isSpeech(loudFrame(100)), false);
  });

  it('hears a normal speaking level as speech straight away', () => {
    // 3,000 is about -20 dBFS, a typical voice on a headset mic.
    assert.equal(new SpeechDetector().isSpeech(loudFrame(3000)), true);
  });

  it('gets used to a steady background noise (a fan, an open mic) within a few seconds', () => {
    const detector = new SpeechDetector();
    assert.equal(detector.isSpeech(loudFrame(800)), true, 'at first it can not tell noise from a voice');
    for (let i = 0; i < 300; i++) detector.isSpeech(loudFrame(800)); // 6 s of the same noise
    assert.equal(detector.isSpeech(loudFrame(800)), false);
  });

  it('still hears someone talking over the noise it got used to', () => {
    const detector = new SpeechDetector();
    for (let i = 0; i < 300; i++) detector.isSpeech(loudFrame(800));
    assert.equal(detector.isSpeech(loudFrame(5000)), true);
  });

  it('keeps hearing a long sentence as speech instead of getting used to it', () => {
    const detector = new SpeechDetector();
    let heardAsSpeech = 0;
    for (let i = 0; i < 150; i++) if (detector.isSpeech(loudFrame(3000))) heardAsSpeech++; // 3 s
    assert.equal(heardAsSpeech, 150);
  });
});
