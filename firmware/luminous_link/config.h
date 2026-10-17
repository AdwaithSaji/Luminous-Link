#pragma once
#include <Arduino.h>

// ---- Pins (same wiring as the TECHSCAPE 2024 prototype) ----
const uint8_t PIN_LDR       = 8;   // LDR module digital output (D0)
const uint8_t PIN_SOLENOID  = 12;  // MOSFET gate -> 12 V solenoid lock
const uint8_t PIN_BUZZER    = 4;
const uint8_t PIN_LED_GREEN = 6;   // "open"
const uint8_t PIN_LED_RED   = 11;  // "closed"

// Most LM393 LDR modules pull D0 LOW when light is above the threshold set by
// the trim pot. Flip this if your module works the other way round.
const uint8_t LDR_LIGHT_LEVEL = LOW;

// ---- Access ----
const uint16_t ACCESS_PIN     = 2024;   // 0000-9999, change before you deploy
const uint8_t  MAX_ATTEMPTS   = 3;      // wrong PINs before lockout
const uint32_t LOCKOUT_MS     = 30000;
const uint32_t UNLOCK_HOLD_MS = 3000;   // how long the bolt stays retracted
