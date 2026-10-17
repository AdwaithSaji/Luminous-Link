import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksum, frameBits, encodeFrame, Decoder, FRAME_BITS } from '../web/protocol.js';

// Plays a frame into the decoder, optionally stretching each segment.
function play(decoder, segments, { start = 0, jitter = () => 0 } = {}) {
  let t = start;
  for (const s of segments) {
    decoder.edge(s.on, t);
    t += s.ms + jitter(s);
  }
  decoder.edge(false, t);
  decoder.tick(t + 10_000);
  return t;
}

function receiver(options) {
  const events = [];
  const decoder = new Decoder({ onEvent: (e) => events.push(e), ...options });
  return { decoder, events, last: () => events.at(-1)?.type };
}

// Small deterministic PRNG so jitter tests are repeatable.
function lcg(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('frame is 16 PIN bits followed by a 4-bit checksum', () => {
  const bits = frameBits(2024);
  assert.equal(bits.length, FRAME_BITS);
  assert.equal(parseInt(bits.slice(0, 16).join(''), 2), 2024);
  assert.equal(parseInt(bits.slice(16).join(''), 2), checksum(2024));
});

test('rejects PINs outside 0-9999', () => {
  for (const bad of [-1, 10000, 1.5, NaN]) assert.throws(() => frameBits(bad), RangeError);
});

test('unlocks with the right PIN at screen and torch speeds', () => {
  for (const unit of [40, 70, 100, 160, 400]) {
    const { decoder, last } = receiver({ pin: 2024 });
    play(decoder, encodeFrame(2024, unit));
    assert.equal(last(), 'unlock', `unit ${unit} ms`);
  }
});

test('survives ±30% timing jitter on every flash', () => {
  const rand = lcg(7);
  for (let run = 0; run < 200; run++) {
    const { decoder, last } = receiver({ pin: 4711 });
    play(decoder, encodeFrame(4711, 100), { jitter: (s) => (rand() - 0.5) * 0.6 * Math.min(s.ms, 100) });
    assert.equal(last(), 'unlock', `run ${run}`);
  }
});

test('wrong PIN is denied, the third one triggers a lockout', () => {
  const { decoder, events } = receiver({ pin: 2024, lockoutMs: 30_000 });
  let t = 0;
  for (let i = 0; i < 3; i++) t = play(decoder, encodeFrame(1111, 100), { start: t + 1000 });
  const outcomes = events.filter((e) => e.type !== 'bit' && e.type !== 'sync').map((e) => e.type);
  assert.deepEqual(outcomes, ['denied', 'denied', 'lockout']);

  play(decoder, encodeFrame(2024, 100), { start: t + 1000 });
  assert.equal(events.at(-1).type, 'lockedout', 'correct PIN is ignored during lockout');

  play(decoder, encodeFrame(2024, 100), { start: t + 40_000 });
  assert.equal(events.at(-1).type, 'unlock', 'works again after lockout');
});

test('a flipped bit fails the checksum instead of counting as an attempt', () => {
  const segments = encodeFrame(2024, 100);
  const victim = segments.find((s) => s.kind === 'pin' && s.bit === 0);
  victim.ms = 250;
  const { decoder, last } = receiver({ pin: 2024 });
  play(decoder, segments);
  assert.equal(last(), 'corrupt');
  assert.equal(decoder.failures, 0);
});

test('a frame cut off halfway times out', () => {
  const { decoder, last } = receiver();
  play(decoder, encodeFrame(2024, 100).slice(0, 15));
  assert.equal(last(), 'timeout');
});

test('steady room light and short flickers are ignored', () => {
  const { decoder, events } = receiver();
  decoder.edge(true, 0);
  decoder.edge(false, 5000); // lights on for 5 s
  decoder.edge(true, 6000);
  decoder.edge(false, 6050); // 50 ms flicker
  decoder.tick(20_000);
  assert.deepEqual(events, []);
});
