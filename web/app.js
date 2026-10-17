import { encodeFrame, frameBits, frameDuration, Decoder, DEMO_PIN, FRAME_BITS } from './protocol.js';

// Timing unit per mode. Torches react slower than screens, and the lock
// adapts to whatever the preamble says.
const UNIT_MS = { virtual: 70, screen: 100, torch: 160 };
const LEAD_IN_MS = 3000; // time to aim the phone before a real transmission
const COLORS = { preamble: '#ffd36e', pin: '#6ee7ff', sum: '#b69cff' };

const NOTES = {
  virtual: 'Plays the signal into the virtual lock. Try a wrong PIN too: three in a row lock it for 30 s.',
  screen: 'Flashes your whole screen white. Hold it against the light sensor on the real lock. Skip this if flashing light bothers you.',
  torch: 'Blinks your phone’s flashlight (Chrome on Android). The browser asks for camera access to control it.',
};

const $ = (selector) => document.querySelector(selector);
const pinInput = $('#pin');
const sendButton = $('#send');
const sendLabel = $('.send-label');
const modeNote = $('#modeNote');
const lockEl = $('#lock');
const statusEl = $('#status');
const bitsEl = $('#bits');
const canvas = $('#wave');
const waveHint = $('#waveHint');
const flash = $('#flash');
const flashHint = $('.flash-hint');

const bitCells = Array.from({ length: FRAME_BITS }, () => bitsEl.appendChild(document.createElement('span')));

let mode = 'virtual';
let active = null;
let resetTimer = 0;
let countdownTimer = 0;

// ---------- virtual lock ----------

const decoder = new Decoder({ pin: DEMO_PIN, onEvent: handleEvent });
setInterval(() => decoder.tick(performance.now()), 50);

function setStatus(text, tone = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${tone}`;
}

function setLockState(state, { text, tone, resetAfter } = {}) {
  clearTimeout(resetTimer);
  clearInterval(countdownTimer);
  lockEl.dataset.state = state;
  if (text) setStatus(text, tone);
  if (resetAfter) resetTimer = setTimeout(() => setLockState('idle', { text: 'Locked' }), resetAfter);
}

function handleEvent(event) {
  switch (event.type) {
    case 'sync':
      setLockState('receiving', { text: `Preamble detected · unit ${Math.round(event.unit)} ms` });
      bitCells.forEach((cell) => { cell.textContent = '·'; cell.classList.remove('got'); });
      break;
    case 'bit':
      bitCells[event.index].textContent = event.bit;
      bitCells[event.index].classList.add('got');
      break;
    case 'unlock':
      setLockState('open', { text: 'Access granted · bolt open for 3 s', tone: 'ok', resetAfter: 3000 });
      break;
    case 'denied':
      setLockState('denied', {
        text: `Wrong PIN · ${event.attemptsLeft} attempt${event.attemptsLeft === 1 ? '' : 's'} left`,
        tone: 'bad',
        resetAfter: 2500,
      });
      break;
    case 'lockout':
    case 'lockedout':
      showLockout(event.until);
      break;
    case 'corrupt':
      setLockState('idle', { text: 'Checksum mismatch · frame dropped', tone: 'bad' });
      break;
    case 'timeout':
      setLockState('idle', { text: 'Signal lost', tone: 'bad' });
      break;
  }
}

function showLockout(until) {
  setLockState('lockout');
  const update = () => {
    const left = Math.ceil((until - performance.now()) / 1000);
    if (left <= 0) return setLockState('idle', { text: 'Locked' });
    setStatus(`Too many wrong PINs · locked for ${left} s`, 'bad');
  };
  update();
  countdownTimer = setInterval(update, 250);
}

// ---------- signal preview ----------

function readPin() {
  const value = pinInput.value;
  return /^\d{4}$/.test(value) ? Number(value) : null;
}

function drawWave(progress = 0) {
  const pin = readPin();
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (pin === null) {
    waveHint.textContent = 'enter 4 digits';
    return;
  }

  const segments = encodeFrame(pin, UNIT_MS[mode]);
  const total = frameDuration(segments);
  waveHint.textContent = `${FRAME_BITS + 1} flashes · ${(total / 1000).toFixed(1)} s`;

  const top = 18;
  const bottom = height - 18;
  const cursor = progress * width;
  let x = 0;

  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const segment of segments) {
    const w = (segment.ms / total) * width;
    const done = x + w <= cursor || (progress > 0 && x < cursor);
    const alpha = progress === 0 || done ? 1 : 0.3;
    const color = COLORS[segment.kind] ?? '#4a4f63';

    if (segment.on) {
      const gradient = ctx.createLinearGradient(0, top, 0, bottom);
      gradient.addColorStop(0, hexA(color, 0.32 * alpha));
      gradient.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x, top, w, bottom - top);
      ctx.strokeStyle = hexA(color, alpha);
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, top);
      ctx.lineTo(x + w, top);
      ctx.lineTo(x + w, bottom);
      ctx.stroke();
    } else {
      ctx.strokeStyle = hexA('#8b91a7', 0.5 * alpha);
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x + w, bottom);
      ctx.stroke();
    }
    x += w;
  }

  if (progress > 0 && progress < 1) {
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#ffd36e';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cursor, 4);
    ctx.lineTo(cursor, height - 4);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function previewBits() {
  const pin = readPin();
  const bits = pin === null ? [] : frameBits(pin);
  bitCells.forEach((cell, i) => {
    cell.textContent = bits[i] ?? '·';
    cell.classList.remove('got');
  });
}

// ---------- light emitters ----------

async function openEmitter(kind) {
  if (kind === 'virtual') return { set() {}, close() {} };

  if (kind === 'screen') {
    flash.hidden = false;
    flash.classList.remove('on');
    await flash.requestFullscreen?.().catch(() => {});
    return {
      set: (on) => flash.classList.toggle('on', on),
      close: () => {
        flash.hidden = true;
        flash.classList.remove('on');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      },
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t reach the flashlight. Use Screen instead.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
  const [track] = stream.getVideoTracks();
  const stopAll = () => stream.getTracks().forEach((t) => t.stop());
  if (!track?.getCapabilities?.().torch) {
    stopAll();
    throw new Error('No controllable flashlight here. Torch mode needs Chrome on Android; use Screen instead.');
  }
  return {
    set: (on) => track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}),
    close: stopAll,
  };
}

// ---------- transmission ----------

function setLight(on, at) {
  active.emitter.set(on);
  lockEl.classList.toggle('light', on);
  decoder.edge(on, at);
}

async function transmit() {
  if (active) return stop('Cancelled');

  const pin = readPin();
  if (pin === null) {
    pinInput.classList.remove('invalid');
    void pinInput.offsetWidth;
    pinInput.classList.add('invalid');
    pinInput.focus();
    return;
  }

  let emitter;
  try {
    emitter = await openEmitter(mode);
  } catch (error) {
    modeNote.textContent = error.message || 'Could not start the light source.';
    modeNote.classList.add('warn');
    return;
  }

  const segments = encodeFrame(pin, UNIT_MS[mode]);
  const starts = [];
  segments.reduce((t, s) => (starts.push(t), t + s.ms), 0);
  const total = frameDuration(segments);
  const leadIn = mode === 'virtual' ? 0 : LEAD_IN_MS;
  const t0 = performance.now() + leadIn;

  active = { emitter, index: -1, timer: 0 };
  sendButton.classList.add('busy');
  setStatus(leadIn ? 'Get ready…' : 'Listening…');

  // A short interval rather than requestAnimationFrame keeps edge timing
  // tight and keeps running when no frames are being painted.
  const step = () => {
    if (!active) return;
    const t = performance.now() - t0;

    if (t < 0) {
      const secs = Math.ceil(-t / 1000);
      sendLabel.textContent = `Starting in ${secs}…`;
      flashHint.firstChild.textContent = `Hold the screen against the light sensor · ${secs}`;
      return;
    }

    let i = Math.max(active.index, 0);
    while (i < segments.length && t >= starts[i] + segments[i].ms) i++;
    // Replay every edge we passed, even if a slow frame skipped one.
    for (let j = active.index + 1; j <= Math.min(i, segments.length - 1); j++) {
      setLight(segments[j].on, t0 + starts[j]);
    }
    active.index = Math.min(i, segments.length - 1);

    const progress = Math.min(t / total, 1);
    sendButton.style.setProperty('--progress', `${progress * 100}%`);
    sendLabel.textContent = `Transmitting · tap to cancel`;
    drawWave(progress);

    if (i >= segments.length) finish();
  };
  active.timer = setInterval(step, 10);
  step();
}

function finish() {
  if (!active) return;
  setLight(false, performance.now());
  clearInterval(active.timer);
  active.emitter.close();
  active = null;
  sendButton.classList.remove('busy');
  sendButton.style.removeProperty('--progress');
  sendLabel.textContent = 'Transmit';
  flashHint.firstChild.textContent = 'Hold the screen against the light sensor';
  drawWave(0);
}

function stop(message) {
  finish();
  setLockState('idle', { text: message });
}

// ---------- wiring ----------

function setMode(next) {
  if (active) return;
  mode = next;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  modeNote.textContent = NOTES[mode];
  modeNote.classList.remove('warn');
  drawWave(0);
}

pinInput.addEventListener('input', () => {
  pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
  pinInput.classList.remove('invalid');
  if (!active) {
    drawWave(0);
    previewBits();
  }
});
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') transmit(); });
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
sendButton.addEventListener('click', transmit);
flash.addEventListener('click', () => stop('Cancelled'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active) stop('Cancelled'); });
new ResizeObserver(() => { if (!active) drawWave(0); }).observe(canvas);

setMode('virtual');
previewBits();
