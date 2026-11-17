// ============================================================================
// SpineAlign — Real-Time Posture Monitor
// Target Hardware: ESP32-WROOM-32 / ESP32 DevKit v1
// Transport: Bluetooth Low Energy (BLE) & USB Serial (115200 baud)
// ============================================================================
//
// Hardware Pinout Guide:
// ----------------------------------------------------------------------------
// Peripheral         ESP32 Pin     Notes
// ----------------------------------------------------------------------------
// I2C SDA            GPIO 21       Shared between MPU6050 & SSD1306 OLED
// I2C SCL            GPIO 22       Shared between MPU6050 & SSD1306 OLED
// Alert Buzzer/LED   GPIO 18       Active-HIGH driver (via NPN / MOSFET transistor)
// Calibrate Button   GPIO 0        Onboard BOOT button (active-LOW, internal pullup)
// Status LED         GPIO 2        Onboard blue LED (Blink = Adv, Solid = Connected)
// Battery ADC (Opt)  GPIO 34       ADC1 channel (voltage divider input only)
//
// I2C Addresses:
// - Back MPU6050:    0x68 (AD0 -> GND) [Default primary sensor]
// - Neck MPU6050:    0x69 (AD0 -> 3.3V) [Optional secondary sensor if dual-IMU]
// - SSD1306 OLED:    0x3C (128x64 pixels)
//
// BLE UUIDs:
// - Service UUID:        67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101
// - Characteristic UUID: 67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101
// ============================================================================

#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLESecurity.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

#if __has_include("config.h")
#include "config.h"
#endif

// Mode: 0 = Single IMU (Back at 0x68); 1 = Dual IMU (Neck at 0x68, Back at 0x69)
#ifndef SPINEALIGN_DUAL_IMU
#define SPINEALIGN_DUAL_IMU 0
#endif

// ============================================================================
// Pin Definitions & Hardware Constants
// ============================================================================
#define SDA_PIN 21  // ESP32 default I2C Data
#define SCL_PIN 22  // ESP32 default I2C Clock
#define ALERT_PIN 18  // Active-HIGH buzzer / haptic motor
#define CALIBRATION_BUTTON_PIN 0  // Onboard BOOT button (active LOW)
#define STATUS_LED_PIN 2  // Onboard Blue LED on ESP32 DevKit
#define BATTERY_ADC_PIN 34  // Optional battery sense pin
#define BATTERY_MONITOR_ENABLED 0

#define NECK_MPU_ADDRESS        0x68
#define BACK_MPU_ADDRESS        0x69
#define OLED_ADDRESS            0x3C
#define SCREEN_WIDTH            128
#define SCREEN_HEIGHT           64
#define OLED_RESET              -1

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool displayAvailable = false;

// MPU6050 Register Map
#define MPU_PWR_MGMT_1          0x6B
#define MPU_SMPLRT_DIV          0x19
#define MPU_CONFIG              0x1A
#define MPU_GYRO_CONFIG         0x1B
#define MPU_ACCEL_CONFIG        0x1C
#define MPU_ACCEL_XOUT_H        0x3B
#define MPU_WHO_AM_I            0x75

// Timing & Threshold Constants
const unsigned long SENSOR_INTERVAL_MS  = 10;    // 100 Hz sensor sampling
const unsigned long OLED_INTERVAL_MS    = 250;   // 4 Hz OLED refresh
const unsigned long SERIAL_INTERVAL_MS  = 100;   // 10 Hz telemetry stream (doubled temporal resolution)
const float POSTURE_THRESHOLD_DEG       = 15.0f; // 15° slouch alert threshold
const float RECOVER_THRESHOLD_DEG       = 12.0f; // 12° recovery threshold (3° hysteresis)
const unsigned long BAD_POSTURE_HOLD_MS = 3000;  // 3s sustained slouch before alert
const unsigned long ALERT_REPEAT_MS     = 45000; // 45s repeat reminder

// ============================================================================
// Bluetooth Low Energy (BLE) Configuration
// ============================================================================
static const char *BLE_DEVICE_NAME         = "SpineAlign-ESP32";
static const char *BLE_SERVICE_UUID        = "67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101";
static const char *BLE_CHARACTERISTIC_UUID = "67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101";
static const size_t BLE_CHUNK_BYTES        = 20;
static const size_t BLE_QUEUE_CAPACITY     = 6;
static const uint32_t BLE_CHUNK_INTERVAL_MS = 10;

BLEServer *bleServer = nullptr;
BLECharacteristic *bleTelemetryCharacteristic = nullptr;
volatile bool bleClientConnected = false;
volatile bool calibrationRequested = false;

String bleTxQueue[BLE_QUEUE_CAPACITY];
size_t bleTxHead = 0, bleTxCount = 0, bleTxOffset = 0;
uint32_t lastBleChunkTime = 0;

void calibrateSensors();

class SpineAlignServerCallbacks final : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleClientConnected = true;
    digitalWrite(STATUS_LED_PIN, HIGH);
    Serial.println("[BLE] Dashboard client connected");
  }
  void onDisconnect(BLEServer *) override {
    bleClientConnected = false;
    digitalWrite(STATUS_LED_PIN, LOW);
    Serial.println("[BLE] Client disconnected; restarting advertising...");
    BLEDevice::startAdvertising();
  }
};

class SpineAlignCharacteristicCallbacks final : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String command = c->getValue().c_str();
    command.trim();
    command.toUpperCase();
    Serial.printf("[BLE] Command received: %s\n", command.c_str());
    if (command == "CALIBRATE") {
      calibrationRequested = true;
    }
  }
};

void sendBleLine(const String &line) {
  if (!bleTelemetryCharacteristic || !bleClientConnected) return;
  if (bleTxCount >= BLE_QUEUE_CAPACITY) return; // Drop frame if queue is full
  const size_t tail = (bleTxHead + bleTxCount) % BLE_QUEUE_CAPACITY;
  bleTxQueue[tail] = line + "\n";
  ++bleTxCount;
}

void serviceBleTx() {
  if (!bleTelemetryCharacteristic || !bleClientConnected) {
    bleTxHead = bleTxCount = bleTxOffset = 0;
    for (size_t i = 0; i < BLE_QUEUE_CAPACITY; ++i) bleTxQueue[i] = "";
    return;
  }
  if (!bleTxCount || millis() - lastBleChunkTime < BLE_CHUNK_INTERVAL_MS) return;

  String &frame = bleTxQueue[bleTxHead];
  const size_t remaining = frame.length() - bleTxOffset;
  const size_t n = min(BLE_CHUNK_BYTES, remaining);
  uint8_t chunk[BLE_CHUNK_BYTES];
  memcpy(chunk, frame.c_str() + bleTxOffset, n);
  bleTelemetryCharacteristic->setValue(chunk, n);
  bleTelemetryCharacteristic->notify();
  bleTxOffset += n;
  lastBleChunkTime = millis();

  if (bleTxOffset >= frame.length()) {
    frame = "";
    bleTxHead = (bleTxHead + 1) % BLE_QUEUE_CAPACITY;
    --bleTxCount;
    bleTxOffset = 0;
  }
}

void startBle() {
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(185);

  BLESecurity *security = new BLESecurity();
  security->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  security->setCapability(ESP_IO_CAP_NONE);
  security->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new SpineAlignServerCallbacks());

  BLEService *service = bleServer->createService(BLE_SERVICE_UUID);
  bleTelemetryCharacteristic = service->createCharacteristic(
    BLE_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_WRITE
  );
  bleTelemetryCharacteristic->addDescriptor(new BLE2902());
  bleTelemetryCharacteristic->setCallbacks(new SpineAlignCharacteristicCallbacks());

  service->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();
  Serial.printf("[BLE] Ready: %s (UUID: %s)\n", BLE_DEVICE_NAME, BLE_SERVICE_UUID);
}

// ============================================================================
// Kalman Filter
// ============================================================================
class KalmanFilter {
private:
  float angle, bias, rate;
  float P[2][2];
  float Q_angle, Q_bias, R_measure;

public:
  KalmanFilter() {
    Q_angle = 0.001f;
    Q_bias = 0.003f;
    R_measure = 0.030f;
    angle = bias = rate = 0.0f;
    P[0][0] = P[0][1] = P[1][0] = P[1][1] = 0.0f;
  }

  float update(float measuredAngle, float measuredRate, float dt) {
    rate = measuredRate - bias;
    angle += dt * rate;
    P[0][0] += dt * (dt * P[1][1] - P[0][1] - P[1][0] + Q_angle);
    P[0][1] -= dt * P[1][1];
    P[1][0] -= dt * P[1][1];
    P[1][1] += Q_bias * dt;

    float S = P[0][0] + R_measure;
    float K[2];
    K[0] = P[0][0] / S;
    K[1] = P[1][0] / S;
    float y = measuredAngle - angle;

    angle += K[0] * y;
    bias += K[1] * y;

    float P00_temp = P[0][0];
    float P01_temp = P[0][1];
    P[0][0] -= K[0] * P00_temp;
    P[0][1] -= K[0] * P01_temp;
    P[1][0] -= K[1] * P00_temp;
    P[1][1] -= K[1] * P01_temp;
    return angle;
  }

  void reset(float initialAngle) {
    angle = initialAngle;
    bias = 0.0f;
    P[0][0] = P[0][1] = P[1][0] = P[1][1] = 0.0f;
  }
};

struct SensorData {
  int16_t ax, ay, az;
  int16_t gx, gy, gz;
};

KalmanFilter neckPitchFilter, neckRollFilter, backPitchFilter, backRollFilter;
float neckAngle = 0.0f, backAngle = 0.0f;
float neckPitch = 0.0f, neckRoll = 0.0f, backPitch = 0.0f, backRoll = 0.0f;
float neckPitchZero = 0.0f, neckRollZero = 0.0f, backPitchZero = 0.0f, backRollZero = 0.0f;
bool neckAvailable = false, backAvailable = false;
bool isCalibrated = false;

bool badPosture = false, alertActive = false;
unsigned long badPostureStartTime = 0, lastAlertTime = 0;
unsigned long lastSensorTime = 0, lastOLEDTime = 0, lastSerialTime = 0, lastLedBlinkTime = 0;

enum BuzzType { BUZZ_NONE, BUZZ_DOUBLE, BUZZ_SINGLE };
enum BuzzStep { BUZZ_IDLE, BUZZ_ON_1, BUZZ_OFF_1, BUZZ_ON_2 };
BuzzType currentBuzz = BUZZ_NONE;
BuzzStep currentBuzzStep = BUZZ_IDLE;
unsigned long buzzStepStartTime = 0;
const unsigned long BUZZ_ON_TIME = 150;
const unsigned long BUZZ_OFF_TIME = 150;

// Button debounce tracking
int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 50;

// ============================================================================
// MPU6050 Driver
// ============================================================================
bool mpuWriteRegister(uint8_t address, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuReadRegisters(uint8_t address, uint8_t startReg, uint8_t *buffer, uint8_t len) {
  Wire.beginTransmission(address);
  Wire.write(startReg);
  if (Wire.endTransmission(false) != 0) return false;
  uint8_t count = Wire.requestFrom(address, len, (uint8_t)true);
  if (count != len) return false;
  for (uint8_t i = 0; i < len; i++) buffer[i] = Wire.read();
  return true;
}

bool mpuPresent(uint8_t address) {
  uint8_t who = 0;
  if (!mpuReadRegisters(address, MPU_WHO_AM_I, &who, 1)) return false;
  return who == 0x68 || who == 0x70 || who == 0x72;
}

bool mpuInit(uint8_t address) {
  if (!mpuPresent(address)) return false;
  if (!mpuWriteRegister(address, MPU_PWR_MGMT_1, 0x00)) return false;
  if (!mpuWriteRegister(address, MPU_SMPLRT_DIV, 9)) return false;    // 100 Hz output
  if (!mpuWriteRegister(address, MPU_CONFIG, 0x03)) return false;        // 42 Hz DLPF filter
  if (!mpuWriteRegister(address, MPU_GYRO_CONFIG, 0x00)) return false;   // +/- 250 deg/s
  if (!mpuWriteRegister(address, MPU_ACCEL_CONFIG, 0x00)) return false;  // +/- 2g
  delay(50);
  return mpuPresent(address);
}

bool mpuReadRaw(uint8_t address, SensorData &data) {
  uint8_t buf[14];
  if (!mpuReadRegisters(address, MPU_ACCEL_XOUT_H, buf, 14)) return false;
  data.ax = (int16_t)((buf[0] << 8) | buf[1]);
  data.ay = (int16_t)((buf[2] << 8) | buf[3]);
  data.az = (int16_t)((buf[4] << 8) | buf[5]);
  data.gx = (int16_t)((buf[8] << 8) | buf[9]);
  data.gy = (int16_t)((buf[10] << 8) | buf[11]);
  data.gz = (int16_t)((buf[12] << 8) | buf[13]);
  return true;
}

float calculatePitchAngle(const SensorData &d) {
  return atan2f((float)d.ay, sqrtf((float)d.ax * d.ax + (float)d.az * d.az)) * 180.0f / PI;
}

float calculateRollAngle(const SensorData &d) {
  return atan2f(-(float)d.ax, (float)d.az) * 180.0f / PI;
}

void updateSensor(uint8_t address, KalmanFilter &pitchFilter, KalmanFilter &rollFilter,
                  float &outPitch, float &outRoll, float zeroPitch, float zeroRoll,
                  bool &available, float dt) {
  SensorData d;
  if (!mpuReadRaw(address, d)) { available = false; return; }
  available = true;
  outPitch = pitchFilter.update(calculatePitchAngle(d), (float)d.gx / 131.0f, dt) - zeroPitch;
  outRoll  = rollFilter.update(calculateRollAngle(d),   (float)d.gy / 131.0f, dt) - zeroRoll;
}

// ============================================================================
// Posture & Alert Logic
// ============================================================================
void calibrateSensors() {
  isCalibrated = badPosture = alertActive = false;
  badPostureStartTime = lastAlertTime = 0;
  currentBuzz = BUZZ_NONE; currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);

  // Take 25 consecutive samples to get a noise-free average zero baseline
  const int SAMPLES = 25;
  float sumBackPitch = 0.0f, sumBackRoll = 0.0f;
  float sumNeckPitch = 0.0f, sumNeckRoll = 0.0f;
  uint8_t backAddr = SPINEALIGN_DUAL_IMU ? BACK_MPU_ADDRESS : NECK_MPU_ADDRESS;

  for (int i = 0; i < SAMPLES; i++) {
    SensorData backD{}, neckD{};
    if (!mpuReadRaw(backAddr, backD)) {
      Serial.println("CALIBRATION FAILED");
      sendBleLine("CALIBRATION FAILED");
      return;
    }
    sumBackPitch += calculatePitchAngle(backD);
    sumBackRoll  += calculateRollAngle(backD);

#if SPINEALIGN_DUAL_IMU
    if (!mpuReadRaw(NECK_MPU_ADDRESS, neckD)) {
      Serial.println("CALIBRATION FAILED");
      sendBleLine("CALIBRATION FAILED");
      return;
    }
    sumNeckPitch += calculatePitchAngle(neckD);
    sumNeckRoll  += calculateRollAngle(neckD);
#endif
    delay(10);
  }

  backPitchZero = sumBackPitch / (float)SAMPLES;
  backRollZero  = sumBackRoll  / (float)SAMPLES;
  backPitchFilter.reset(backPitchZero);
  backRollFilter.reset(backRollZero);

#if SPINEALIGN_DUAL_IMU
  neckPitchZero = sumNeckPitch / (float)SAMPLES;
  neckRollZero  = sumNeckRoll  / (float)SAMPLES;
  neckPitchFilter.reset(neckPitchZero);
  neckRollFilter.reset(neckRollZero);
#else
  neckPitchZero = neckRollZero = 0.0f;
  neckPitchFilter.reset(0.0f);
  neckRollFilter.reset(0.0f);
#endif

  neckPitch = neckRoll = neckAngle = 0.0f;
  backPitch = backRoll = backAngle = 0.0f;
  isCalibrated = true;

  // Visual & Audio confirmation of calibration
  digitalWrite(STATUS_LED_PIN, HIGH);
  digitalWrite(ALERT_PIN, HIGH);
  delay(80);
  digitalWrite(STATUS_LED_PIN, LOW);
  digitalWrite(ALERT_PIN, LOW);
  delay(80);
  digitalWrite(STATUS_LED_PIN, HIGH);
  delay(80);
  if (!bleClientConnected) digitalWrite(STATUS_LED_PIN, LOW);

  Serial.println("CALIBRATED");
  sendBleLine("CALIBRATED");
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
      digitalWrite(ALERT_PIN, LOW);
      break;
  }
}

void updatePosture() {
  if (!isCalibrated || !backAvailable) return;
  float maxDev = fabsf(backAngle);
#if SPINEALIGN_DUAL_IMU
  if (neckAvailable) maxDev = max(maxDev, fabsf(neckAngle));
#endif

  unsigned long now = millis();
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
      badPostureStartTime = lastAlertTime = 0;
      return;
    }
    if (now - badPostureStartTime >= BAD_POSTURE_HOLD_MS) {
      startAlert(BUZZ_DOUBLE);
      alertActive = true;
      lastAlertTime = now;
      Serial.println("BAD POSTURE ALERT");
    }
    return;
  }
  if (maxDev < RECOVER_THRESHOLD_DEG) {
    badPosture = alertActive = false;
    badPostureStartTime = lastAlertTime = 0;
    currentBuzz = BUZZ_NONE;
    currentBuzzStep = BUZZ_IDLE;
    digitalWrite(ALERT_PIN, LOW);
    Serial.println("POSTURE RECOVERED");
    return;
  }
  if (now - lastAlertTime >= ALERT_REPEAT_MS) {
    startAlert(BUZZ_SINGLE);
    lastAlertTime = now;
  }
}

String buildTelemetryLine() {
  String l; l.reserve(150);
  l += "N:"    + String(neckAngle, 1);
  l += ",B:"   + String(backAngle, 1);
  l += ",NP:"  + String(neckPitch, 1);
  l += ",NR:"  + String(neckRoll, 1);
  l += ",BP:"  + String(backPitch, 1);
  l += ",BR:"  + String(backRoll, 1);
  l += ",MODE:"+ String(SPINEALIGN_DUAL_IMU ? 2 : 1);
  l += ",ALERT:" + String(badPosture ? 1 : 0);
  l += ",CAL:"   + String(isCalibrated ? 1 : 0);
  l += ",NS:"    + String(neckAvailable ? 1 : 0);
  l += ",BS:"    + String(backAvailable ? 1 : 0);
  l += ",BAT:-1";
  l += ",PCT:-1";
  l += ",CHG:-1";
  l += ",FULL:-1";
  return l;
}

void sendTelemetry() {
  String line = buildTelemetryLine();
  Serial.println(line);
  sendBleLine(line);
}

void updateStatusLed() {
  if (bleClientConnected) {
    digitalWrite(STATUS_LED_PIN, HIGH);
  } else {
    // Gentle 1 Hz advertising blink
    unsigned long now = millis();
    if (now - lastLedBlinkTime >= 500) {
      lastLedBlinkTime = now;
      digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
    }
  }
}

void updateOled() {
  if (!displayAvailable) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Top Bar: System Title & BLE Status
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("SpineAlign ");
  display.println(bleClientConnected ? "[BLE LINK]" : "[BLE ADV]");

  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  // Angle Readings
  display.setCursor(0, 16);
  display.printf("Back: %5.1f deg\n", backAngle);

#if SPINEALIGN_DUAL_IMU
  display.setCursor(0, 28);
  display.printf("Neck: %5.1f deg\n", neckAngle);
#else
  display.setCursor(0, 28);
  display.println(isCalibrated ? "Calibrated: YES" : "Calibrated: NO");
#endif

  // Posture Status Banner
  display.setCursor(0, 44);
  if (!isCalibrated) {
    display.println("Press BOOT to zero");
  } else if (badPosture) {
    display.fillRect(0, 42, 128, 20, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
    display.setCursor(4, 48);
    display.println("! SLOUCH ALERT !");
    display.setTextColor(SSD1306_WHITE);
  } else {
    display.println("Posture: GOOD");
  }

  display.display();
}

// ============================================================================
// Setup & Loop
// ============================================================================
void setup() {
  pinMode(ALERT_PIN, OUTPUT);
  digitalWrite(ALERT_PIN, LOW);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  pinMode(CALIBRATION_BUTTON_PIN, INPUT_PULLUP);

  Serial.begin(115200);
  delay(300);
  Serial.println("\n==============================================");
  Serial.println("  SpineAlign ESP32-WROOM BLE Posture Monitor  ");
  Serial.println("==============================================");

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  displayAvailable = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (displayAvailable) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("SpineAlign ESP32");
    display.println("Initializing BLE...");
    display.display();
  }

#if SPINEALIGN_DUAL_IMU
  neckAvailable = mpuInit(NECK_MPU_ADDRESS);
  backAvailable = mpuInit(BACK_MPU_ADDRESS);
  Serial.printf("Dual IMU: Neck(0x68): %s, Back(0x69): %s\n", neckAvailable ? "OK" : "ERR", backAvailable ? "OK" : "ERR");
#else
  neckAvailable = false;
  backAvailable = mpuInit(NECK_MPU_ADDRESS);
  Serial.printf("Single IMU: Back(0x68): %s\n", backAvailable ? "OK" : "ERR");
#endif

  startBle();
  lastSensorTime = lastOLEDTime = lastSerialTime = lastLedBlinkTime = millis();
}

void loop() {
  serviceBleTx();
  updateAlert();
  updateStatusLed();

  // Onboard BOOT Button with debouncing
  int reading = digitalRead(CALIBRATION_BUTTON_PIN);
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (reading == LOW && lastButtonState == HIGH) {
      calibrationRequested = true;
    }
  }
  lastButtonState = reading;

  // Calibration request check (via button or BLE/Serial command)
  if (calibrationRequested) {
    calibrationRequested = false;
    calibrateSensors();
  }

  // Serial commands
  while (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim(); cmd.toUpperCase();
    if (cmd == "CALIBRATE") calibrateSensors();
  }

  // High-rate sensor sampling (100 Hz)
  unsigned long now = millis();
  if (now - lastSensorTime >= SENSOR_INTERVAL_MS) {
    float dt = (now - lastSensorTime) / 1000.0f;
    lastSensorTime = now;
    if (dt <= 0.0f || dt > 0.5f) dt = 0.01f;

#if SPINEALIGN_DUAL_IMU
    updateSensor(NECK_MPU_ADDRESS, neckPitchFilter, neckRollFilter, neckPitch, neckRoll,
                 neckPitchZero, neckRollZero, neckAvailable, dt);
    neckAngle = sqrtf(neckPitch * neckPitch + neckRoll * neckRoll);
    uint8_t bAddr = BACK_MPU_ADDRESS;
#else
    uint8_t bAddr = NECK_MPU_ADDRESS;
#endif
    updateSensor(bAddr, backPitchFilter, backRollFilter, backPitch, backRoll,
                 backPitchZero, backRollZero, backAvailable, dt);
    backAngle = sqrtf(backPitch * backPitch + backRoll * backRoll);

    updatePosture();
  }

  // OLED Refresh (4 Hz)
  if (now - lastOLEDTime >= OLED_INTERVAL_MS) {
    lastOLEDTime = now;
    updateOled();
  }

  // Telemetry Stream (5 Hz)
  if (now - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = now;
    sendTelemetry();
  }
}
