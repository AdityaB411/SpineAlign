// ============================================================================
// SpineAlign — Low-Latency Wi-Fi-Only Posture Monitor for NodeMCU ESP8266
// Transport: Wi-Fi WebSockets (port 81, 25 Hz) + Embedded HTTP Server (port 80)
// IMU Modes: Auto-detect (-1), Single IMU (0, MODE:1), or Dual IMU (1, MODE:2)
// ============================================================================
// Required Arduino IDE setup:
//   1. Board:   NodeMCU 1.0 (ESP-12E Module)  [esp8266 board package]
//   2. Library: "WebSockets" by Markus Sattler (links2004)
//
// Wiring (NodeMCU -> Peripherals, separate boot-safe D pins for each MPU6050):
//   MPU #1 (Neck, 0x68):  SDA -> D2 (GPIO4),  SCL -> D1 (GPIO5)
//   MPU #2 (Back, 0x68):  SDA -> D6 (GPIO12), SCL -> D7 (GPIO13)
//   Alert Buzzer / LED:   +   -> D5 (GPIO14), -   -> GND
//   Calibrate Button:     D3 (GPIO0) -> GND (or onboard FLASH button)
//   Battery Sense (Opt):  A0  -> Voltage divider from battery (+)
//   Power (both MPUs):    VCC -> 3V3, GND -> GND, AD0 -> GND (or unconnected)
//
// Single IMU: Connect just 1 MPU6050 to EITHER D2/D1 or D6/D7 (auto-detected).
// Dual IMU:   Connect Neck to D2/D1 and Back to D6/D7 (both at default 0x68).
// ============================================================================

#include <Wire.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <WebSocketsServer.h>
#include <math.h>
#include <stdio.h>

#if __has_include("config.h")
#include "config.h"
#endif

// Leave blank or as placeholders to boot directly into AP mode ("SpineAlign-NodeMCU")
#ifndef SPINEALIGN_WIFI_SSID
#define SPINEALIGN_WIFI_SSID ""
#endif
#ifndef SPINEALIGN_WIFI_PASSWORD
#define SPINEALIGN_WIFI_PASSWORD ""
#endif

// IMU Mode:
//  -1 = Auto-detect on boot/calibration (Dual on D2/D1 + D6/D7 or 0x68+0x69, else Single)
//   0 = Force Single IMU (Back on D6/D7 or D2/D1, MODE:1)
//   1 = Force Dual IMU   (Neck on D2/D1, Back on D6/D7 or 0x69, MODE:2)
#ifndef SPINEALIGN_DUAL_IMU
#define SPINEALIGN_DUAL_IMU -1
#endif

// Optional axis fine-tuning (if your MPU6050 is rotated 90 deg or mirrored):
//   SPINEALIGN_SWAP_PITCH_ROLL: 0 = default, 1 = swap front/back and sideways
//   SPINEALIGN_PITCH_SIGN:      1 or -1 (invert front/back direction)
//   SPINEALIGN_ROLL_SIGN:       1 or -1 (invert left/right lean direction)
#ifndef SPINEALIGN_SWAP_PITCH_ROLL
#define SPINEALIGN_SWAP_PITCH_ROLL 0
#endif
#ifndef SPINEALIGN_PITCH_SIGN
#define SPINEALIGN_PITCH_SIGN 1
#endif
#ifndef SPINEALIGN_ROLL_SIGN
#define SPINEALIGN_ROLL_SIGN 1
#endif

// NodeMCU ESP8266 Pin Definitions (all I2C & Alert pins are 100% boot-safe)
// MPU #1 (Neck / Primary): D2 = GPIO4 (SDA),  D1 = GPIO5 (SCL)
// MPU #2 (Back):           D6 = GPIO12 (SDA), D7 = GPIO13 (SCL)
// Alert Buzzer / LED:      D5 = GPIO14
#define SDA_PIN 4
#define SCL_PIN 5
#define NECK_SDA_PIN SDA_PIN
#define NECK_SCL_PIN SCL_PIN
#define BACK_SDA_PIN 12
#define BACK_SCL_PIN 13
#define ALERT_PIN 14
#define CALIBRATION_BUTTON_PIN 0 // D3 / FLASH button (active LOW)
#define BATTERY_ADC_PIN A0
#define BATTERY_MONITOR_ENABLED 1

// MPU6050 / MPU6500 / MPU9250 I2C Addresses & Registers
#define MPU_DEFAULT_ADDRESS 0x68
#define MPU_ALT_ADDRESS     0x69
#define NECK_MPU_ADDRESS    MPU_DEFAULT_ADDRESS
#define BACK_MPU_ADDRESS    MPU_ALT_ADDRESS

#define MPU_PWR_MGMT_1   0x6B
#define MPU_SMPLRT_DIV   0x19
#define MPU_CONFIG       0x1A
#define MPU_GYRO_CONFIG  0x1B
#define MPU_ACCEL_CONFIG 0x1C
#define MPU_ACCEL_XOUT_H 0x3B
#define MPU_WHO_AM_I     0x75

// Timing & Posture Thresholds
const unsigned long SENSOR_INTERVAL_MS    = 5;      // 200 Hz Kalman filter
const unsigned long TELEMETRY_INTERVAL_MS = 40;     // 25 Hz low-latency WebSocket stream
const unsigned long SENSOR_REINIT_MS      = 1000;   // Non-blocking hot-recovery backoff
const unsigned long WIFI_RETRY_MS         = 10000;  // Periodic STA reconnect check
const float         POSTURE_THRESHOLD_DEG = 15.0f;
const float         RECOVER_THRESHOLD_DEG = 12.0f;
const unsigned long BAD_POSTURE_HOLD_MS   = 3000;
const unsigned long ALERT_REPEAT_MS       = 45000;
const unsigned long BUTTON_DEBOUNCE_MS    = 50;
const float         RAD_TO_DEG_F          = 57.2957795f;
const float         MIN_GRAVITY_LSB       = 8000.0f;  // ~0.49g at +/-2g (16384 LSB/g)
const float         MAX_GRAVITY_LSB       = 25000.0f; // ~1.53g at +/-2g

class KalmanFilter {
private:
  float angle, bias, rate;
  float P[2][2];
  float Q_angle, Q_bias, R_measure;

public:
  KalmanFilter()
      : angle(0.0f), bias(0.0f), rate(0.0f),
        Q_angle(0.001f), Q_bias(0.003f), R_measure(0.02f) {
    P[0][0] = P[0][1] = P[1][0] = P[1][1] = 0.0f;
  }

  float update(float measuredAngle, float measuredRate, float dt) {
    if (!isfinite(measuredAngle) || !isfinite(measuredRate) || !isfinite(dt) || dt <= 0.0f) {
      return isfinite(angle) ? angle : 0.0f;
    }

    rate = measuredRate - bias;
    angle += dt * rate;
    P[0][0] += dt * (dt * P[1][1] - P[0][1] - P[1][0] + Q_angle);
    P[0][1] -= dt * P[1][1];
    P[1][0] -= dt * P[1][1];
    P[1][1] += Q_bias * dt;

    float S = P[0][0] + R_measure;
    if (!isfinite(S) || S <= 1e-6f) {
      reset(measuredAngle);
      return angle;
    }

    float K0 = P[0][0] / S;
    float K1 = P[1][0] / S;
    float innovation = measuredAngle - angle;

    angle += K0 * innovation;
    bias += K1 * innovation;

    float P00 = P[0][0];
    float P01 = P[0][1];
    P[0][0] -= K0 * P00;
    P[0][1] -= K0 * P01;
    P[1][0] -= K1 * P00;
    P[1][1] -= K1 * P01;

    if (!isfinite(angle) || !isfinite(bias)) {
      reset(measuredAngle);
    }
    return angle;
  }

  void reset(float initialAngle) {
    angle = isfinite(initialAngle) ? initialAngle : 0.0f;
    bias = 0.0f;
    rate = 0.0f;
    P[0][0] = P[0][1] = P[1][0] = P[1][1] = 0.0f;
  }
};

struct SensorData {
  int16_t ax, ay, az;
  int16_t gx, gy, gz;
};

// Automatically detected dominant gravity axis at upright neutral posture:
//   MOUNT_FLAT_Z: PCB horizontal (Z up/down), X forward/back, Y left/right
//   MOUNT_VERT_X: PCB vertical on back (X up/down), Z out of back, Y left/right
//   MOUNT_VERT_Y: PCB vertical on back (Y up/down), Z out of back, X left/right
enum MountAxis { MOUNT_FLAT_Z = 0, MOUNT_VERT_X = 1, MOUNT_VERT_Y = 2 };

struct SensorCal {
  MountAxis mountAxis = MOUNT_FLAT_Z;
  float mountSign = 1.0f;
  float gxBias = 0.0f;
  float gyBias = 0.0f;
  float gzBias = 0.0f;
  float pitchZero = 0.0f;
  float rollZero = 0.0f;
};

struct ImuBus {
  uint8_t sda;
  uint8_t scl;
  uint8_t address;
};

// IMU & Posture State
KalmanFilter neckPitchFilter, neckRollFilter, backPitchFilter, backRollFilter;
SensorCal neckCal, backCal;
ImuBus neckBus = { NECK_SDA_PIN, NECK_SCL_PIN, MPU_DEFAULT_ADDRESS };
ImuBus backBus = { BACK_SDA_PIN, BACK_SCL_PIN, MPU_DEFAULT_ADDRESS };
uint8_t activeI2cSda = 255;
uint8_t activeI2cScl = 255;
bool dualImuActive = false;

float neckAngle = 0.0f, backAngle = 0.0f;
float neckPitch = 0.0f, neckRoll = 0.0f, backPitch = 0.0f, backRoll = 0.0f;

float batteryVoltage = -1.0f;
int batteryPercent = -1;
bool batteryTelemetryAvailable = false;
unsigned long lastBatteryRead = 0;

bool neckAvailable = false, backAvailable = false;
uint8_t neckFailCount = 0, backFailCount = 0;
unsigned long lastNeckReinitAttempt = 0, lastBackReinitAttempt = 0;
bool isCalibrated = false;
bool badPosture = false, alertActive = false;
unsigned long badPostureStartTime = 0, lastAlertTime = 0;
unsigned long lastSensorTime = 0, lastTelemetryTime = 0, lastWifiCheckTime = 0;

// Non-blocking debounced button state
bool lastButtonRaw = HIGH;
bool buttonPressedStable = false;
unsigned long lastButtonChangeTime = 0;

// Wi-Fi Servers
ESP8266WebServer httpServer(80);
WebSocketsServer webSocket = WebSocketsServer(81);
bool apModeActive = false;
bool networkStarted = false;
bool mdnsStarted = false;
bool calibrating = false;
volatile bool calibrationRequested = false;

// Buzzer State Machine
enum BuzzType { BUZZ_NONE, BUZZ_DOUBLE, BUZZ_SINGLE };
enum BuzzStep { BUZZ_IDLE, BUZZ_ON_1, BUZZ_OFF_1, BUZZ_ON_2 };
BuzzType currentBuzz = BUZZ_NONE;
BuzzStep currentBuzzStep = BUZZ_IDLE;
unsigned long buzzStepStartTime = 0;
const unsigned long BUZZ_ON_TIME  = 150;
const unsigned long BUZZ_OFF_TIME = 150;

// Forward declarations (no default args for Arduino IDE prototype compatibility)
void sendTelemetryToClient(uint8_t num);
void broadcastTelemetry();

// ---------------- Helpers ----------------

static inline float safeFloat(float v, float fallback = 0.0f) {
  return isfinite(v) ? v : fallback;
}

static inline float clampAngle(float v) {
  if (!isfinite(v)) return 0.0f;
  if (v > 180.0f) return 180.0f;
  if (v < -180.0f) return -180.0f;
  return v;
}

const char *mountAxisName(MountAxis axis) {
  switch (axis) {
    case MOUNT_VERT_X: return "VERT_X";
    case MOUNT_VERT_Y: return "VERT_Y";
    case MOUNT_FLAT_Z:
    default:           return "FLAT_Z";
  }
}

bool isPlaceholderCredential(const char *v) {
  return !v || !v[0] || strstr(v, "YOUR_") || strstr(v, "CHANGE_") ||
         strstr(v, "PLACEHOLDER") || strstr(v, "REPLACE_ME");
}

bool wifiCredentialsPresent() {
  return !isPlaceholderCredential(SPINEALIGN_WIFI_SSID) &&
         !isPlaceholderCredential(SPINEALIGN_WIFI_PASSWORD);
}

// Keep WebSocket & HTTP responsive during brief init/calibration waits
void serviceNetworkDelay(unsigned long ms) {
  const unsigned long start = millis();
  while (millis() - start < ms) {
    if (networkStarted) {
      webSocket.loop();
      httpServer.handleClient();
    }
    delay(1);
    yield();
  }
}

void sendBroadcastLine(const String &line) {
  webSocket.broadcastTXT(line.c_str(), line.length());
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      const char *statusMsg = isCalibrated ? "STATUS:CALIBRATED" : "STATUS:UNCALIBRATED";
      webSocket.sendTXT(num, statusMsg);
      sendTelemetryToClient(num);
      break;
    }
    case WStype_TEXT: {
      if (!payload || length == 0 || length > 64) break;
      String command;
      command.reserve(length + 1);
      for (size_t i = 0; i < length; ++i) command += (char)payload[i];
      command.trim();
      command.toUpperCase();
      if (command == "CALIBRATE") {
        if (!calibrating) calibrationRequested = true;
      } else if (command == "STATUS") {
        const char *statusMsg = isCalibrated ? "STATUS:CALIBRATED" : "STATUS:UNCALIBRATED";
        webSocket.sendTXT(num, statusMsg);
      } else if (command == "PING") {
        webSocket.sendTXT(num, "PONG");
      }
      break;
    }
    default:
      break;
  }
}

// ---------------- MPU6050 I2C (Dual-Bus Pin Switching + Recovery) ----------------

void recoverI2CBus(uint8_t sda, uint8_t scl) {
  // Release any slave holding SDA low with 9 SCL clock pulses + STOP condition
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, OUTPUT);
  for (uint8_t i = 0; i < 9; ++i) {
    digitalWrite(scl, LOW);
    delayMicroseconds(5);
    digitalWrite(scl, HIGH);
    delayMicroseconds(5);
  }
  pinMode(sda, OUTPUT);
  digitalWrite(sda, LOW);
  delayMicroseconds(5);
  digitalWrite(scl, HIGH);
  delayMicroseconds(5);
  digitalWrite(sda, HIGH);
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  activeI2cSda = 255;
  activeI2cScl = 255;
}

void selectI2CBus(uint8_t sda, uint8_t scl) {
  if (activeI2cSda == sda && activeI2cScl == scl) return;
  Wire.begin(sda, scl);
  Wire.setClock(400000); // 400 kHz I2C Fast Mode
  Wire.setClockStretchLimit(15000);
  activeI2cSda = sda;
  activeI2cScl = scl;
}

bool mpuWriteRegister(const ImuBus &bus, uint8_t reg, uint8_t value) {
  selectI2CBus(bus.sda, bus.scl);
  Wire.beginTransmission(bus.address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission(true) == 0;
}

bool mpuReadRegistersOnce(const ImuBus &bus, uint8_t startReg, uint8_t *buffer, uint8_t length) {
  selectI2CBus(bus.sda, bus.scl);
  Wire.beginTransmission(bus.address);
  Wire.write(startReg);
  if (Wire.endTransmission(false) != 0) return false;

  uint8_t received = Wire.requestFrom((uint8_t)bus.address, (uint8_t)length, (uint8_t)true);
  if (received != length) return false;

  for (uint8_t i = 0; i < length; i++) buffer[i] = Wire.read();
  return true;
}

bool mpuReadRegisters(const ImuBus &bus, uint8_t startReg, uint8_t *buffer, uint8_t length) {
  if (mpuReadRegistersOnce(bus, startReg, buffer, length)) return true;
  // Single fast retry to ride through transient wire noise
  return mpuReadRegistersOnce(bus, startReg, buffer, length);
}

bool mpuPresent(const ImuBus &bus) {
  uint8_t whoAmI = 0;
  if (!mpuReadRegisters(bus, MPU_WHO_AM_I, &whoAmI, 1)) return false;
  // Support MPU6050 (0x68/0x69/0x72), MPU6500 (0x70), MPU9250 (0x71), MPU9255 (0x73), ICM-20689 (0x98)
  return whoAmI == 0x68 || whoAmI == 0x69 || whoAmI == 0x70 ||
         whoAmI == 0x71 || whoAmI == 0x72 || whoAmI == 0x73 || whoAmI == 0x98;
}

bool mpuInit(const ImuBus &bus) {
  if (!mpuPresent(bus)) {
    recoverI2CBus(bus.sda, bus.scl);
    if (!mpuPresent(bus)) return false;
  }
  if (!mpuWriteRegister(bus, MPU_PWR_MGMT_1, 0x00))   return false; // Wake up
  if (!mpuWriteRegister(bus, MPU_CONFIG, 0x03))       return false; // 44 Hz DLPF (1 kHz gyro base)
  if (!mpuWriteRegister(bus, MPU_SMPLRT_DIV, 4))      return false; // 1000 / (1 + 4) = 200 Hz
  if (!mpuWriteRegister(bus, MPU_GYRO_CONFIG, 0x00))  return false; // +/- 250 deg/s (131 LSB/deg/s)
  if (!mpuWriteRegister(bus, MPU_ACCEL_CONFIG, 0x00)) return false; // +/- 2g
  serviceNetworkDelay(50);
  return mpuPresent(bus);
}

bool mpuReadRaw(const ImuBus &bus, SensorData &data) {
  uint8_t buf[14];
  if (!mpuReadRegisters(bus, MPU_ACCEL_XOUT_H, buf, 14)) return false;

  data.ax = (int16_t)((buf[0] << 8) | buf[1]);
  data.ay = (int16_t)((buf[2] << 8) | buf[3]);
  data.az = (int16_t)((buf[4] << 8) | buf[5]);
  data.gx = (int16_t)((buf[8] << 8) | buf[9]);
  data.gy = (int16_t)((buf[10] << 8) | buf[11]);
  data.gz = (int16_t)((buf[12] << 8) | buf[13]);

  // All-zero frame means sensor reset into sleep mode or bus is stuck low
  if (data.ax == 0 && data.ay == 0 && data.az == 0 &&
      data.gx == 0 && data.gy == 0 && data.gz == 0) {
    return false;
  }
  return true;
}

// Compute singularity-free Pitch (front/back) and Roll (sideways) + matched gyro rates
// using du/dt = -omega x u for whichever mounting orientation was detected.
void computeAnglesAndRatesFloat(float ax, float ay, float az,
                                float gx, float gy, float gz,
                                const SensorCal &cal,
                                float &measPitch, float &measRoll,
                                float &pitchRate, float &rollRate) {
  const float wx = (gx - cal.gxBias) / 131.0f;
  const float wy = (gy - cal.gyBias) / 131.0f;
  const float wz = (gz - cal.gzBias) / 131.0f;
  const float s = cal.mountSign;

  float rawPitch = 0.0f, rawRoll = 0.0f;
  float rawPitchRate = 0.0f, rawRollRate = 0.0f;

  switch (cal.mountAxis) {
    case MOUNT_VERT_X:
      // PCB vertical on back: X up/down, Z out of back, Y left/right
      rawPitch = atan2f(az, sqrtf((ax * ax) + (ay * ay))) * RAD_TO_DEG_F;
      rawRoll  = atan2f(ay, sqrtf((ax * ax) + (az * az))) * RAD_TO_DEG_F;
      rawPitchRate = s * wy;
      rawRollRate  = -s * wz;
      break;

    case MOUNT_VERT_Y:
      // PCB vertical on back: Y up/down, Z out of back, X left/right
      rawPitch = atan2f(az, sqrtf((ax * ax) + (ay * ay))) * RAD_TO_DEG_F;
      rawRoll  = atan2f(-ax, sqrtf((ay * ay) + (az * az))) * RAD_TO_DEG_F;
      rawPitchRate = -s * wx;
      rawRollRate  = -s * wz;
      break;

    case MOUNT_FLAT_Z:
    default:
      // PCB horizontal: Z up/down, X forward/back, Y left/right
      rawPitch = atan2f(-ax, sqrtf((ay * ay) + (az * az))) * RAD_TO_DEG_F;
      rawRoll  = atan2f(ay, sqrtf((ax * ax) + (az * az))) * RAD_TO_DEG_F;
      rawPitchRate = s * wy;
      rawRollRate  = s * wx;
      break;
  }

#if SPINEALIGN_SWAP_PITCH_ROLL
  measPitch = rawRoll * (float)SPINEALIGN_PITCH_SIGN;
  pitchRate = rawRollRate * (float)SPINEALIGN_PITCH_SIGN;
  measRoll  = rawPitch * (float)SPINEALIGN_ROLL_SIGN;
  rollRate  = rawPitchRate * (float)SPINEALIGN_ROLL_SIGN;
#else
  measPitch = rawPitch * (float)SPINEALIGN_PITCH_SIGN;
  pitchRate = rawPitchRate * (float)SPINEALIGN_PITCH_SIGN;
  measRoll  = rawRoll * (float)SPINEALIGN_ROLL_SIGN;
  rollRate  = rawRollRate * (float)SPINEALIGN_ROLL_SIGN;
#endif
}

void computeAnglesAndRates(const SensorData &d, const SensorCal &cal,
                           float &measPitch, float &measRoll,
                           float &pitchRate, float &rollRate) {
  computeAnglesAndRatesFloat((float)d.ax, (float)d.ay, (float)d.az,
                             (float)d.gx, (float)d.gy, (float)d.gz,
                             cal, measPitch, measRoll, pitchRate, rollRate);
}

bool calibrateSingleSensor(const ImuBus &bus, SensorCal &cal,
                           KalmanFilter &pitchFilter, KalmanFilter &rollFilter,
                           int sampleCount) {
  float sumAx = 0.0f, sumAy = 0.0f, sumAz = 0.0f;
  float sumGx = 0.0f, sumGy = 0.0f, sumGz = 0.0f;
  int validSamples = 0;

  for (int i = 0; i < sampleCount; ++i) {
    SensorData d;
    if (mpuReadRaw(bus, d)) {
      sumAx += (float)d.ax;
      sumAy += (float)d.ay;
      sumAz += (float)d.az;
      sumGx += (float)d.gx;
      sumGy += (float)d.gy;
      sumGz += (float)d.gz;
      validSamples++;
    }
    serviceNetworkDelay(2);
  }

  if (validSamples < sampleCount / 2) return false;

  const float invN = 1.0f / (float)validSamples;
  const float avgAx = sumAx * invN;
  const float avgAy = sumAy * invN;
  const float avgAz = sumAz * invN;

  // Reject impossible gravity vector (corrupt/asleep sensor or violent shaking)
  const float gMag = sqrtf((avgAx * avgAx) + (avgAy * avgAy) + (avgAz * avgAz));
  if (!isfinite(gMag) || gMag < MIN_GRAVITY_LSB || gMag > MAX_GRAVITY_LSB) {
    return false;
  }

  cal.gxBias = sumGx * invN;
  cal.gyBias = sumGy * invN;
  cal.gzBias = sumGz * invN;

  // Detect dominant gravity axis to prevent gimbal lock in vertical or flat mounting
  const float absAx = fabsf(avgAx);
  const float absAy = fabsf(avgAy);
  const float absAz = fabsf(avgAz);
  if (absAz >= absAx && absAz >= absAy) {
    cal.mountAxis = MOUNT_FLAT_Z;
    cal.mountSign = (avgAz >= 0.0f) ? 1.0f : -1.0f;
  } else if (absAx >= absAy) {
    cal.mountAxis = MOUNT_VERT_X;
    cal.mountSign = (avgAx >= 0.0f) ? 1.0f : -1.0f;
  } else {
    cal.mountAxis = MOUNT_VERT_Y;
    cal.mountSign = (avgAy >= 0.0f) ? 1.0f : -1.0f;
  }

  float initPitch = 0.0f, initRoll = 0.0f, dummyPR = 0.0f, dummyRR = 0.0f;
  computeAnglesAndRatesFloat(avgAx, avgAy, avgAz, cal.gxBias, cal.gyBias, cal.gzBias,
                             cal, initPitch, initRoll, dummyPR, dummyRR);
  cal.pitchZero = safeFloat(initPitch, 0.0f);
  cal.rollZero  = safeFloat(initRoll, 0.0f);
  pitchFilter.reset(cal.pitchZero);
  rollFilter.reset(cal.rollZero);
  return true;
}

void detectAndInitIMUs() {
  const ImuBus bus1Primary   = { NECK_SDA_PIN, NECK_SCL_PIN, MPU_DEFAULT_ADDRESS }; // D2/D1 @ 0x68
  const ImuBus bus2Primary   = { BACK_SDA_PIN, BACK_SCL_PIN, MPU_DEFAULT_ADDRESS }; // D6/D7 @ 0x68
  const ImuBus bus1Secondary = { NECK_SDA_PIN, NECK_SCL_PIN, MPU_ALT_ADDRESS };     // D2/D1 @ 0x69 (shared-bus fallback)

#if SPINEALIGN_DUAL_IMU == 1
  dualImuActive = true;
  neckBus = bus1Primary;
  neckAvailable = mpuInit(neckBus);
  if (mpuInit(bus2Primary)) {
    backBus = bus2Primary;
    backAvailable = true;
  } else if (mpuInit(bus1Secondary)) {
    backBus = bus1Secondary;
    backAvailable = true;
  } else {
    backBus = bus2Primary;
    backAvailable = false;
  }
#elif SPINEALIGN_DUAL_IMU == 0
  dualImuActive = false;
  neckAvailable = false;
  if (mpuInit(bus2Primary)) {
    backBus = bus2Primary;
    backAvailable = true;
  } else if (mpuInit(bus1Primary)) {
    backBus = bus1Primary;
    backAvailable = true;
  } else {
    backBus = bus1Primary;
    backAvailable = false;
  }
#else
  // Auto-detect: supports Dual IMU on separate D2/D1 + D6/D7 pins (both 0x68),
  // shared D2/D1 pins (0x68 + 0x69), or Single IMU on either D2/D1 or D6/D7.
  const bool hasBus1 = mpuInit(bus1Primary);
  const bool hasBus2 = mpuInit(bus2Primary);

  if (hasBus1 && hasBus2) {
    dualImuActive = true;
    neckBus = bus1Primary;
    backBus = bus2Primary;
    neckAvailable = true;
    backAvailable = true;
  } else if (hasBus1 && mpuInit(bus1Secondary)) {
    dualImuActive = true;
    neckBus = bus1Primary;
    backBus = bus1Secondary;
    neckAvailable = true;
    backAvailable = true;
  } else if (hasBus2) {
    dualImuActive = false;
    backBus = bus2Primary;
    neckAvailable = false;
    backAvailable = true;
  } else if (hasBus1) {
    dualImuActive = false;
    backBus = bus1Primary;
    neckAvailable = false;
    backAvailable = true;
  } else {
    dualImuActive = false;
    backBus = bus1Primary;
    neckAvailable = false;
    backAvailable = false;
  }
#endif
  neckFailCount = 0;
  backFailCount = 0;
}

void updateSensor(const ImuBus &bus, const SensorCal &cal,
                  KalmanFilter &pitchFilter, KalmanFilter &rollFilter,
                  float &outputPitch, float &outputRoll,
                  bool &available, uint8_t &failCount,
                  unsigned long &lastReinitAttempt, float dt) {
  // If offline, back off re-init attempts to 1 Hz so we don't stall the 200 Hz loop
  if (!available) {
    const unsigned long now = millis();
    if (now - lastReinitAttempt < SENSOR_REINIT_MS) return;
    lastReinitAttempt = now;
    if (!mpuInit(bus)) return;

    SensorData seed;
    if (!mpuReadRaw(bus, seed)) return;
    float p = 0.0f, r = 0.0f, pr = 0.0f, rr = 0.0f;
    computeAnglesAndRates(seed, cal, p, r, pr, rr);
    pitchFilter.reset(p);
    rollFilter.reset(r);
    outputPitch = clampAngle(p - cal.pitchZero);
    outputRoll  = clampAngle(r - cal.rollZero);
    failCount = 0;
    available = true;
    return;
  }

  SensorData data;
  if (!mpuReadRaw(bus, data)) {
    if (failCount < 255) failCount++;
    // Require 3 consecutive failed reads (~15 ms) before flagging offline
    if (failCount >= 3) {
      available = false;
      lastReinitAttempt = millis();
    }
    return;
  }

  failCount = 0;
  float measPitch = 0.0f, measRoll = 0.0f, pitchRate = 0.0f, rollRate = 0.0f;
  computeAnglesAndRates(data, cal, measPitch, measRoll, pitchRate, rollRate);
  outputPitch = clampAngle(pitchFilter.update(measPitch, pitchRate, dt) - cal.pitchZero);
  outputRoll  = clampAngle(rollFilter.update(measRoll, rollRate, dt) - cal.rollZero);
}

// ---------------- Battery ----------------

void updateBatteryTelemetry() {
#if BATTERY_MONITOR_ENABLED
  const unsigned long now = millis();
  if (now - lastBatteryRead < 2000) return;
  lastBatteryRead = now;

  int raw = analogRead(BATTERY_ADC_PIN);
  float pinVoltage = (raw / 1023.0f) * 3.3f;
  if (pinVoltage < 0.2f) {
    batteryVoltage = -1.0f;
    batteryPercent = -1;
    batteryTelemetryAvailable = false;
    return;
  }
  float measuredVoltage = pinVoltage * 1.3f; // Calibrate multiplier for your voltage divider
  if (measuredVoltage >= 3.0f && measuredVoltage <= 4.5f) {
    batteryVoltage = measuredVoltage;
    batteryPercent = (int)constrain((batteryVoltage - 3.2f) / (4.2f - 3.2f) * 100.0f, 0.0f, 100.0f);
    batteryTelemetryAvailable = true;
  } else {
    batteryVoltage = -1.0f;
    batteryPercent = -1;
    batteryTelemetryAvailable = false;
  }
#else
  batteryVoltage = -1.0f;
  batteryPercent = -1;
  batteryTelemetryAvailable = false;
#endif
}

// ---------------- Calibration & Alerts ----------------

void calibrateSensors() {
  calibrating = true;
  isCalibrated = false;
  badPosture = false;
  alertActive = false;
  badPostureStartTime = 0;
  lastAlertTime = 0;
  currentBuzz = BUZZ_NONE;
  currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);

#if SPINEALIGN_DUAL_IMU < 0
  detectAndInitIMUs();
#else
  if (dualImuActive && !neckAvailable) neckAvailable = mpuInit(neckBus);
  if (!backAvailable) backAvailable = mpuInit(backBus);
#endif

  const bool neckOK = dualImuActive
      ? calibrateSingleSensor(neckBus, neckCal, neckPitchFilter, neckRollFilter, 40)
      : true;
  const bool backOK = calibrateSingleSensor(backBus, backCal, backPitchFilter, backRollFilter, 40);

  neckAvailable = dualImuActive && neckOK;
  backAvailable = backOK;
  neckFailCount = 0;
  backFailCount = 0;
  lastSensorTime = millis();

  if (!neckOK || !backOK) {
    calibrating = false;
    sendBroadcastLine("CALIBRATION FAILED");
    broadcastTelemetry();
    return;
  }

  if (!dualImuActive) {
    neckCal.pitchZero = neckCal.rollZero = 0.0f;
    neckPitchFilter.reset(0.0f);
    neckRollFilter.reset(0.0f);
  }

  neckPitch = neckRoll = neckAngle = 0.0f;
  backPitch = backRoll = backAngle = 0.0f;
  isCalibrated = true;
  calibrating = false;
  sendBroadcastLine("CALIBRATED");
  broadcastTelemetry();
}

void startAlert(BuzzType type) {
  currentBuzz = type;
  currentBuzzStep = BUZZ_ON_1;
  buzzStepStartTime = millis();
  digitalWrite(ALERT_PIN, HIGH);
}

void updateAlert() {
  if (currentBuzz == BUZZ_NONE) {
    digitalWrite(ALERT_PIN, LOW);
    return;
  }

  unsigned long now = millis();
  switch (currentBuzzStep) {
    case BUZZ_ON_1:
      if (now - buzzStepStartTime >= BUZZ_ON_TIME) {
        digitalWrite(ALERT_PIN, LOW);
        currentBuzzStep = BUZZ_OFF_1;
        buzzStepStartTime = now;
      }
      break;
    case BUZZ_OFF_1:
      if (now - buzzStepStartTime >= BUZZ_OFF_TIME) {
        if (currentBuzz == BUZZ_DOUBLE) {
          digitalWrite(ALERT_PIN, HIGH);
          currentBuzzStep = BUZZ_ON_2;
          buzzStepStartTime = now;
        } else {
          currentBuzz = BUZZ_NONE;
          currentBuzzStep = BUZZ_IDLE;
        }
      }
      break;
    case BUZZ_ON_2:
      if (now - buzzStepStartTime >= BUZZ_ON_TIME) {
        digitalWrite(ALERT_PIN, LOW);
        currentBuzz = BUZZ_NONE;
        currentBuzzStep = BUZZ_IDLE;
      }
      break;
    default:
      currentBuzz = BUZZ_NONE;
      currentBuzzStep = BUZZ_IDLE;
      digitalWrite(ALERT_PIN, LOW);
      break;
  }
}

void updatePosture() {
  if (!isCalibrated) return;
  if (!backAvailable || (dualImuActive && !neckAvailable)) {
    badPosture = false;
    alertActive = false;
    badPostureStartTime = 0;
    lastAlertTime = 0;
    currentBuzz = BUZZ_NONE;
    currentBuzzStep = BUZZ_IDLE;
    digitalWrite(ALERT_PIN, LOW);
    return;
  }

  float maxDev = fabsf(backAngle);
  if (dualImuActive) {
    maxDev = fmaxf(maxDev, fabsf(neckAngle));
  }

  const unsigned long now = millis();
  if (!badPosture) {
    if (maxDev >= POSTURE_THRESHOLD_DEG) {
      badPosture = true;
      alertActive = false;
      badPostureStartTime = now;
    }
    return;
  }

  if (!alertActive) {
    if (maxDev < POSTURE_THRESHOLD_DEG) {
      badPosture = false;
      badPostureStartTime = 0;
      lastAlertTime = 0;
      return;
    }
    if (now - badPostureStartTime >= BAD_POSTURE_HOLD_MS) {
      startAlert(BUZZ_DOUBLE);
      alertActive = true;
      lastAlertTime = now;
    }
    return;
  }

  if (maxDev < RECOVER_THRESHOLD_DEG) {
    badPosture = false;
    alertActive = false;
    badPostureStartTime = 0;
    lastAlertTime = 0;
    currentBuzz = BUZZ_NONE;
    currentBuzzStep = BUZZ_IDLE;
    digitalWrite(ALERT_PIN, LOW);
    return;
  }

  if (now - lastAlertTime >= ALERT_REPEAT_MS) {
    startAlert(BUZZ_SINGLE);
    lastAlertTime = now;
  }
}

// 100% non-blocking edge-triggered debounced calibration button
void checkCalibrationButton() {
#if CALIBRATION_BUTTON_PIN >= 0
  const bool raw = digitalRead(CALIBRATION_BUTTON_PIN);
  const unsigned long now = millis();

  if (raw != lastButtonRaw) {
    lastButtonRaw = raw;
    lastButtonChangeTime = now;
  }

  if (now - lastButtonChangeTime >= BUTTON_DEBOUNCE_MS) {
    if (raw == LOW && !buttonPressedStable) {
      buttonPressedStable = true;
      calibrationRequested = true;
    } else if (raw == HIGH) {
      buttonPressedStable = false;
    }
  }
#endif
}

// ---------------- Zero-Allocation Telemetry & HTTP Server ----------------

size_t formatTelemetryLine(char *buf, size_t bufSize) {
  const int len = snprintf(
      buf, bufSize,
      "N:%.1f,B:%.1f,NP:%.1f,NR:%.1f,BP:%.1f,BR:%.1f,MODE:%d,ALERT:%d,CAL:%d,NS:%d,BS:%d,BAT:%.2f,PCT:%d,CHG:-1,FULL:-1",
      clampAngle(neckAngle),
      clampAngle(backAngle),
      clampAngle(neckPitch),
      clampAngle(neckRoll),
      clampAngle(backPitch),
      clampAngle(backRoll),
      dualImuActive ? 2 : 1,
      badPosture ? 1 : 0,
      isCalibrated ? 1 : 0,
      neckAvailable ? 1 : 0,
      backAvailable ? 1 : 0,
      batteryTelemetryAvailable ? safeFloat(batteryVoltage, -1.0f) : -1.0f,
      batteryTelemetryAvailable ? batteryPercent : -1);
  if (len <= 0) return 0;
  return (len < (int)bufSize) ? (size_t)len : (bufSize - 1);
}

void sendTelemetryToClient(uint8_t num) {
  char buf[192];
  const size_t safeLen = formatTelemetryLine(buf, sizeof(buf));
  if (safeLen > 0) {
    webSocket.sendTXT(num, (const char *)buf, safeLen);
  }
}

void broadcastTelemetry() {
  if (webSocket.connectedClients() == 0) return;
  char buf[192];
  const size_t safeLen = formatTelemetryLine(buf, sizeof(buf));
  if (safeLen > 0) {
    webSocket.broadcastTXT((const char *)buf, safeLen);
  }
}

void sendCorsHeaders() {
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleCalibrateHttp() {
  if (!calibrating) calibrationRequested = true;
  sendCorsHeaders();
  httpServer.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"calibrating\"}");
}

void setupWebServer() {
  httpServer.on("/status", HTTP_GET, []() {
    char json[384];
    String ipStr = apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
    snprintf(
        json, sizeof(json),
        "{\"device\":\"SpineAlign-NodeMCU\",\"mode\":%d,\"ap\":%s,\"ip\":\"%s\","
        "\"wsPort\":81,\"rateHz\":25,\"clients\":%u,\"calibrated\":%s,"
        "\"badPosture\":%s,\"alertActive\":%s,\"neckSensor\":%s,\"backSensor\":%s,"
        "\"neckMount\":\"%s\",\"backMount\":\"%s\",\"neckAngle\":%.1f,\"backAngle\":%.1f,"
        "\"freeHeap\":%u}",
        dualImuActive ? 2 : 1,
        apModeActive ? "true" : "false",
        ipStr.c_str(),
        (unsigned int)webSocket.connectedClients(),
        isCalibrated ? "true" : "false",
        badPosture ? "true" : "false",
        alertActive ? "true" : "false",
        neckAvailable ? "true" : "false",
        backAvailable ? "true" : "false",
        dualImuActive ? mountAxisName(neckCal.mountAxis) : "NONE",
        mountAxisName(backCal.mountAxis),
        clampAngle(neckAngle),
        clampAngle(backAngle),
        (unsigned int)ESP.getFreeHeap());
    sendCorsHeaders();
    httpServer.send(200, "application/json", json);
  });

  httpServer.on("/calibrate", HTTP_GET, handleCalibrateHttp);
  httpServer.on("/calibrate", HTTP_POST, handleCalibrateHttp);
  httpServer.on("/calibrate", HTTP_OPTIONS, []() {
    sendCorsHeaders();
    httpServer.send(204);
  });

  httpServer.on("/", HTTP_GET, []() {
    String html = F(
      "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>SpineAlign NodeMCU</title><style>"
      "body{margin:0;padding:24px;background:#f3f5ef;color:#29372e;font-family:system-ui,sans-serif;}"
      ".card{max-width:480px;margin:20px auto;background:#fff;border:1px solid #e1e7dc;border-radius:16px;padding:24px;}"
      ".meta{font-size:13px;color:#55645a;margin:6px 0 14px;}"
      ".angles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;}"
      ".box{background:#f6f8f4;border-radius:12px;padding:14px;text-align:center;}"
      ".val{font-size:28px;font-weight:800;margin-top:4px;}"
      "button{width:100%;padding:12px;border:none;border-radius:10px;background:#66836d;color:#fff;font-weight:700;cursor:pointer;}"
      "</style></head><body><div class='card'>"
      "<h2>SpineAlign NodeMCU (Wi-Fi)</h2>"
      "<div class='meta'><span id='link'>Connecting...</span> &middot; <span id='mode'>Detecting IMU...</span></div>"
      "<div class='angles'>"
      "<div class='box'><div>Neck</div><div class='val' id='n'>--&deg;</div></div>"
      "<div class='box'><div>Back</div><div class='val' id='b'>--&deg;</div></div>"
      "</div>"
      "<button onclick='cal()'>Calibrate Posture</button>"
      "<p id='st'>Waiting for telemetry...</p></div><script>"
      "let ws;function go(){ws=new WebSocket('ws://'+location.hostname+':81/');"
      "ws.onopen=()=>document.getElementById('link').innerText='Connected';"
      "ws.onclose=()=>{document.getElementById('link').innerText='Reconnecting...';setTimeout(go,2000);};"
      "ws.onmessage=e=>{const d={};e.data.trim().split(',').forEach(p=>{const s=p.split(':');if(s.length===2)d[s[0]]=s[1];});"
      "const dual=d.MODE==='2';"
      "if(d.MODE){document.getElementById('mode').innerText=dual?'Dual IMU (MODE:2)':'Single IMU (MODE:1)';"
      "document.getElementById('n').innerText=dual?(d.N+'\\u00B0'):'N/A';}"
      "if(d.B)document.getElementById('b').innerText=d.B+'\\u00B0';"
      "const st=document.getElementById('st');"
      "if(d.BS==='0'||(dual&&d.NS==='0'))st.innerText='Sensor Offline - Check Wiring';"
      "else if(d.CAL==='0')st.innerText='Press Calibrate Posture';"
      "else if(d.ALERT==='1')st.innerText='Posture Alert!';"
      "else if(d.ALERT==='0')st.innerText='Posture Good';};}"
      "function cal(){if(ws&&ws.readyState===1)ws.send('CALIBRATE');}go();"
      "</script></body></html>");
    httpServer.send(200, "text/html", html);
  });

  httpServer.begin();
}

void setupWiFi() {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleepMode(WIFI_NONE_SLEEP); // Eliminates 100-300 ms DTIM radio stalls
  WiFi.mode(WIFI_STA);

  if (wifiCredentialsPresent()) {
    WiFi.begin(SPINEALIGN_WIFI_SSID, SPINEALIGN_WIFI_PASSWORD);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
      delay(250);
      yield();
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    apModeActive = false;
  } else {
    apModeActive = true;
    WiFi.mode(WIFI_AP);
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
    IPAddress apIP(192, 168, 4, 1);
    IPAddress netMsk(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, apIP, netMsk);
    WiFi.softAP("SpineAlign-NodeMCU");
  }

  if (MDNS.begin("spinealign")) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
    mdnsStarted = true;
  }

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  // Automatically reap stale/dropped sockets so all 5 ESP8266 WS slots stay available
  webSocket.enableHeartbeat(15000, 3000, 2);
  setupWebServer();
  networkStarted = true;
}

void maintainWiFi() {
  if (apModeActive || !wifiCredentialsPresent()) return;
  const unsigned long now = millis();
  if (now - lastWifiCheckTime < WIFI_RETRY_MS) return;
  lastWifiCheckTime = now;
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
  }
}

// ---------------- Main Setup & Loop ----------------

void setup() {
  pinMode(ALERT_PIN, OUTPUT);
  digitalWrite(ALERT_PIN, LOW);
#if CALIBRATION_BUTTON_PIN >= 0
  pinMode(CALIBRATION_BUTTON_PIN, INPUT_PULLUP);
#endif

  pinMode(NECK_SDA_PIN, INPUT_PULLUP);
  pinMode(NECK_SCL_PIN, INPUT_PULLUP);
  pinMode(BACK_SDA_PIN, INPUT_PULLUP);
  pinMode(BACK_SCL_PIN, INPUT_PULLUP);
  selectI2CBus(NECK_SDA_PIN, NECK_SCL_PIN);

  detectAndInitIMUs();

  // Initial gyro bias & mount-axis capture so live motion is smooth even before manual calibration
  if (dualImuActive && neckAvailable) {
    calibrateSingleSensor(neckBus, neckCal, neckPitchFilter, neckRollFilter, 25);
  }
  if (backAvailable) {
    calibrateSingleSensor(backBus, backCal, backPitchFilter, backRollFilter, 25);
  }

  setupWiFi();
  lastSensorTime = lastTelemetryTime = lastBatteryRead = lastWifiCheckTime = millis();
}

void loop() {
  webSocket.loop();
  httpServer.handleClient();
  if (mdnsStarted) MDNS.update();
  maintainWiFi();

  checkCalibrationButton();
  updateAlert();

  if (calibrationRequested) {
    calibrationRequested = false;
    calibrateSensors();
  }

  updateBatteryTelemetry();

  const unsigned long now = millis();
  if (now - lastSensorTime >= SENSOR_INTERVAL_MS) {
    float dt = (now - lastSensorTime) / 1000.0f;
    lastSensorTime = now;
    if (dt <= 0.0f || dt > 0.25f) dt = 0.005f;

    if (dualImuActive) {
      updateSensor(neckBus, neckCal, neckPitchFilter, neckRollFilter,
                   neckPitch, neckRoll, neckAvailable, neckFailCount,
                   lastNeckReinitAttempt, dt);
      updateSensor(backBus, backCal, backPitchFilter, backRollFilter,
                   backPitch, backRoll, backAvailable, backFailCount,
                   lastBackReinitAttempt, dt);
      neckAngle = clampAngle(sqrtf((neckPitch * neckPitch) + (neckRoll * neckRoll)));
    } else {
      neckAvailable = false;
      neckPitch = neckRoll = neckAngle = 0.0f;
      updateSensor(backBus, backCal, backPitchFilter, backRollFilter,
                   backPitch, backRoll, backAvailable, backFailCount,
                   lastBackReinitAttempt, dt);
    }
    backAngle = clampAngle(sqrtf((backPitch * backPitch) + (backRoll * backRoll)));
    updatePosture();
  }

  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = now;
    broadcastTelemetry();
  }

  yield();
}
