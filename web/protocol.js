// Luminous Link light protocol.
//
// A frame is a long "preamble" flash followed by 20 short/long flashes:
// a 16-bit PIN and a 4-bit checksum, most significant bit first.
// Every duration is measured in units, and the receiver learns the unit from
// the preamble, so the same lock accepts fast screen flashes and slow torches.
//
// firmware/luminous_link/luminous_link.ino implements the same decoder in C++.

export const UNITS = { preamble: 6, gap: 1, zero: 1, one: 2.5 };
export const PIN_BITS = 16;
export const FRAME_BITS = 20;
export const PREAMBLE_MIN_MS = 240; // 6 units at 40 ms
export const PREAMBLE_MAX_MS = 2400; // 6 units at 400 ms
export const DEMO_PIN = 2024;

export function checksum(pin) {
  return ((pin >> 12) ^ (pin >> 8) ^ (pin >> 4) ^ pin ^ 0x5) & 0xf;
}

export function frameBits(pin) {
  if (!Number.isInteger(pin) || pin < 0 || pin > 9999) {
    throw new RangeError('PIN must be a whole number from 0 to 9999');
  }
  const word = (pin << 4) | checksum(pin);
  return Array.from({ length: FRAME_BITS }, (_, i) => (word >> (FRAME_BITS - 1 - i)) & 1);
}

// The frame as alternating light-on / light-off segments.
export function encodeFrame(pin, unit = 100) {
  const segments = [{ on: true, ms: UNITS.preamble * unit, kind: 'preamble' }];
  frameBits(pin).forEach((bit, index) => {
    segments.push({ on: false, ms: UNITS.gap * unit, kind: 'gap' });
    segments.push({
      on: true,
      ms: (bit ? UNITS.one : UNITS.zero) * unit,
      kind: index < PIN_BITS ? 'pin' : 'sum',
      bit,
      index,
    });
  });
  segments.push({ on: false, ms: UNITS.gap * unit, kind: 'gap' });
  return segments;
}

export function frameDuration(segments) {
  return segments.reduce((total, s) => total + s.ms, 0);
}

// Turns light/dark edges back into a PIN and decides whether to open.
// Call edge() whenever the sensor changes and tick() regularly so a
// half-received frame can time out.
export class Decoder {
  constructor({ pin = DEMO_PIN, maxAttempts = 3, lockoutMs = 30000, onEvent = () => {} } = {}) {
    Object.assign(this, { pin, maxAttempts, lockoutMs, onEvent });
    this.light = false;
    this.since = 0;
    this.receiving = false;
    this.unit = 0;
    this.bits = [];
    this.failures = 0;
    this.lockoutUntil = -Infinity;
  }

  edge(light, t) {
    if (light === this.light) return;
    if (this.light) this.#pulse(t - this.since, t);
    this.light = light;
    this.since = t;
  }

  tick(t) {
    if (this.receiving && !this.light && t - this.since > 4 * this.unit) {
      this.receiving = false;
      this.onEvent({ type: 'timeout', t });
    }
  }

  #pulse(ms, t) {
    if (this.receiving && ms <= 4 * this.unit) {
      if (ms < 0.4 * this.unit) return; // glitch
      const bit = ms > 1.75 * this.unit ? 1 : 0;
      this.bits.push(bit);
      this.onEvent({ type: 'bit', bit, index: this.bits.length - 1, t });
      if (this.bits.length === FRAME_BITS) this.#finish(t);
      return;
    }
    if (ms >= PREAMBLE_MIN_MS && ms <= PREAMBLE_MAX_MS) {
      this.receiving = true;
      this.unit = ms / UNITS.preamble;
      this.bits = [];
      this.onEvent({ type: 'sync', unit: this.unit, t });
    } else {
      this.receiving = false;
    }
  }

  #finish(t) {
    this.receiving = false;
    const word = this.bits.reduce((w, b) => (w << 1) | b, 0);
    const pin = word >> 4;
    if ((word & 0xf) !== checksum(pin)) return this.onEvent({ type: 'corrupt', t });
    if (t < this.lockoutUntil) return this.onEvent({ type: 'lockedout', until: this.lockoutUntil, t });
    if (pin === this.pin) {
      this.failures = 0;
      return this.onEvent({ type: 'unlock', pin, t });
    }
    if (++this.failures >= this.maxAttempts) {
      this.failures = 0;
      this.lockoutUntil = t + this.lockoutMs;
      return this.onEvent({ type: 'lockout', pin, until: this.lockoutUntil, t });
    }
    this.onEvent({ type: 'denied', pin, attemptsLeft: this.maxAttempts - this.failures, t });
  }
}
