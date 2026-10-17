// Luminous Link: a Li-Fi smart lock.
//
// An LDR watches for a light frame from a phone (screen or torch):
// a long preamble flash, then 20 short/long flashes carrying a 16-bit PIN and
// a 4-bit checksum. The preamble sets the timing unit, so fast and slow
// transmitters both work. Matching PIN -> the solenoid opens for a few seconds.
//
// The protocol is specified and unit-tested in web/protocol.js.

#include "config.h"

const uint8_t  FRAME_BITS      = 20;
const uint32_t PREAMBLE_MIN_MS = 240;   // 6 units at 40 ms
const uint32_t PREAMBLE_MAX_MS = 2400;  // 6 units at 400 ms
const uint8_t  DEBOUNCE_MS     = 8;

// Sensor
bool     light      = false;  // debounced
bool     rawLight   = false;
uint32_t rawSince   = 0;
uint32_t levelSince = 0;

// Frame being received
bool     receiving = false;
uint32_t unitMs    = 0;
uint32_t frame     = 0;
uint8_t  bitCount  = 0;

// Lock
uint8_t  failures     = 0;
bool     isOpen       = false;
uint32_t openUntil    = 0;
bool     lockedOut    = false;
uint32_t lockoutUntil = 0;

bool reached(uint32_t now, uint32_t deadline) {
  return (int32_t)(now - deadline) >= 0;  // safe across millis() rollover
}

uint8_t checksum(uint16_t pin) {
  return ((pin >> 12) ^ (pin >> 8) ^ (pin >> 4) ^ pin ^ 0x5) & 0xF;
}

void unlock(uint32_t now) {
  isOpen = true;
  openUntil = now + UNLOCK_HOLD_MS;
  tone(PIN_BUZZER, 2000, 150);
  Serial.println(F("access granted"));
}

void finishFrame(uint32_t now) {
  receiving = false;
  uint16_t pin = frame >> 4;

  if ((frame & 0xF) != checksum(pin)) {
    Serial.println(F("checksum mismatch, frame dropped"));
    return;
  }
  if (lockedOut) {
    Serial.println(F("ignored: locked out"));
    return;
  }
  if (pin == ACCESS_PIN) {
    failures = 0;
    unlock(now);
    return;
  }
  if (++failures >= MAX_ATTEMPTS) {
    failures = 0;
    lockedOut = true;
    lockoutUntil = now + LOCKOUT_MS;
    tone(PIN_BUZZER, 1800, 1500);
    Serial.println(F("too many wrong PINs, locked out"));
    return;
  }
  tone(PIN_BUZZER, 300, 400);
  Serial.print(F("access denied, attempts left: "));
  Serial.println(MAX_ATTEMPTS - failures);
}

// Called each time the light goes off, with how long it was on.
void onPulse(uint32_t ms, uint32_t now) {
  if (receiving && ms <= 4 * unitMs) {
    if (ms * 10 < 4 * unitMs) return;                  // < 0.4 unit: glitch
    frame = (frame << 1) | (ms * 4 > 7 * unitMs ? 1 : 0);  // > 1.75 units = 1
    if (++bitCount == FRAME_BITS) finishFrame(now);
    return;
  }
  if (ms >= PREAMBLE_MIN_MS && ms <= PREAMBLE_MAX_MS) {
    receiving = true;
    unitMs = ms / 6;
    frame = 0;
    bitCount = 0;
    Serial.print(F("sync, unit "));
    Serial.print(unitMs);
    Serial.println(F(" ms"));
  } else {
    receiving = false;
  }
}

void updateOutputs(uint32_t now) {
  if (isOpen && reached(now, openUntil)) isOpen = false;
  if (lockedOut && reached(now, lockoutUntil)) lockedOut = false;

  digitalWrite(PIN_SOLENOID, isOpen ? HIGH : LOW);
  digitalWrite(PIN_LED_GREEN, isOpen || (receiving && light) ? HIGH : LOW);
  bool redOn = lockedOut ? (now / 125) % 2 : !isOpen;  // blink while locked out
  digitalWrite(PIN_LED_RED, redOn ? HIGH : LOW);
}

void setup() {
  Serial.begin(9600);
  pinMode(PIN_LDR, INPUT_PULLUP);
  pinMode(PIN_SOLENOID, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  Serial.println(F("Luminous Link ready"));
}

void loop() {
  uint32_t now = millis();

  bool raw = digitalRead(PIN_LDR) == LDR_LIGHT_LEVEL;
  if (raw != rawLight) {
    rawLight = raw;
    rawSince = now;
  }
  if (raw != light && now - rawSince >= DEBOUNCE_MS) {
    if (light) onPulse(rawSince - levelSince, rawSince);
    light = raw;
    levelSince = rawSince;
  }

  if (receiving && !light && now - levelSince > 4 * unitMs) {
    receiving = false;
    Serial.println(F("signal lost"));
  }

  updateOutputs(now);
}
