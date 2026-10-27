#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_ADS1X15.h>
#include <WiFi.h>
#include <ArduinoOTA.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLESecurity.h>
#include <math.h>
#include <string.h>
#if __has_include("config.h")
#include "config.h"
#endif
#ifndef SPINEALIGN_WIFI_SSID
#define SPINEALIGN_WIFI_SSID ""
#endif
#ifndef SPINEALIGN_WIFI_PASSWORD
#define SPINEALIGN_WIFI_PASSWORD ""
#endif
#ifndef SPINEALIGN_OTA_PASSWORD
#define SPINEALIGN_OTA_PASSWORD ""
#endif

// Dedicated physical sketch; root SpineAlign.ino remains the unchanged Wokwi simulation.
#define SDA_PIN 14
#define SCL_PIN 15
#define ALERT_PIN 2
#define CALIBRATION_BUTTON_PIN -1
#define BATTERY_ADC_PIN -1
#define CHARGER_STATUS_PIN -1
#define BATTERY_MONITOR_ENABLED 1

#define NECK_MPU_ADDRESS 0x68
#define BACK_MPU_ADDRESS 0x69
#define OLED_ADDRESS 0x3C
#define BATTERY_VOLTAGE_DIVIDER_RATIO 2.0f
#define BATTERY_CHARGE_FULL_VOLTAGE 4.15f
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_ADS1115 batteryADC;
bool displayAvailable = false;
bool batteryAdcAvailable = false;

#define MPU_PWR_MGMT_1   0x6B
#define MPU_SMPLRT_DIV   0x19
#define MPU_CONFIG       0x1A
#define MPU_GYRO_CONFIG  0x1B
#define MPU_ACCEL_CONFIG 0x1C
#define MPU_ACCEL_XOUT_H 0x3B
#define MPU_WHO_AM_I     0x75

const unsigned long SENSOR_INTERVAL_MS = 10;
const unsigned long OLED_INTERVAL_MS = 250;
const unsigned long SERIAL_INTERVAL_MS = 200;
const float POSTURE_THRESHOLD_DEG = 15.0f;
const float RECOVER_THRESHOLD_DEG = 12.0f;
const unsigned long BAD_POSTURE_HOLD_MS = 3000;
const unsigned long ALERT_REPEAT_MS = 45000;

class KalmanFilter
{
private:
  float angle, bias, rate;
  float P[2][2];
  float Q_angle, Q_bias, R_measure;

public:
  KalmanFilter()
  {
    Q_angle = 0.001f;
    Q_bias = 0.003f;
    R_measure = 0.03f;
    angle = 0.0f;
    bias = 0.0f;
    rate = 0.0f;
    P[0][0] = P[0][1] = P[1][0] = P[1][1] = 0.0f;
  }

  float update(float measuredAngle, float measuredRate, float dt)
  {
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
    float innovation = measuredAngle - angle;

    angle += K[0] * innovation;
    bias += K[1] * innovation;

    float P00_temp = P[0][0];
    float P01_temp = P[0][1];
    P[0][0] -= K[0] * P00_temp;
    P[0][1] -= K[0] * P01_temp;
    P[1][0] -= K[1] * P00_temp;
    P[1][1] -= K[1] * P01_temp;
    return angle;
  }

  void reset(float initialAngle)
  {
    angle = initialAngle;
    bias = 0.0f;
    P[0][0] = P[0][1] = P[1][0] = P[1][1] = 0.0f;
  }
};

struct SensorData
{
  int16_t ax, ay, az;
  int16_t gx, gy, gz;
};

KalmanFilter neckPitchFilter, neckRollFilter, backPitchFilter, backRollFilter;
float neckAngle = 0.0f, backAngle = 0.0f;
float neckPitch = 0.0f, neckRoll = 0.0f, backPitch = 0.0f, backRoll = 0.0f;
float neckPitchZero = 0.0f, neckRollZero = 0.0f, backPitchZero = 0.0f, backRollZero = 0.0f;
float batteryVoltage = -1.0f;
int batteryPercent = -1;
bool batteryCharging = false, batteryFull = false, batteryTelemetryAvailable = false;
bool chargerSignalAvailable = false;
float chargerSenseVoltage = -1.0f;
unsigned long lastBatteryRead = 0;
bool neckAvailable = false, backAvailable = false;
bool isCalibrated = false;
bool badPosture = false, alertActive = false;
unsigned long badPostureStartTime = 0, lastAlertTime = 0;
unsigned long lastSensorTime = 0, lastOLEDTime = 0, lastSerialTime = 0;
bool lastButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;
const unsigned long BUTTON_DEBOUNCE_MS = 50;

static const uint8_t ADS1115_ADDRESS=0x48, BATTERY_ADC_CHANNEL=0, CHARGER_ADC_CHANNEL=1;
static const char *BLE_DEVICE_NAME="SpineAlign-ESP32CAM";
static const char *BLE_SERVICE_UUID="67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101";
static const char *BLE_CHARACTERISTIC_UUID="67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101";
static const size_t BLE_CHUNK_BYTES=20, BLE_QUEUE_CAPACITY=4;
static const uint32_t BLE_CHUNK_INTERVAL_MS=3;
BLEServer *bleServer=nullptr;
BLECharacteristic *bleTelemetryCharacteristic=nullptr;
volatile bool bleClientConnected=false, calibrationRequested=false;
String bleTxQueue[BLE_QUEUE_CAPACITY];
size_t bleTxHead=0, bleTxCount=0, bleTxOffset=0;
uint32_t lastBleChunkTime=0, lastWifiAttempt=0;
bool otaStarted=false, wifiAttempted=false;

void calibrateSensors();

class SpineAlignServerCallbacks final : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleClientConnected=true; Serial.println("BLE dashboard connected"); }
  void onDisconnect(BLEServer *) override { bleClientConnected=false; BLEDevice::startAdvertising(); }
};
class SpineAlignCharacteristicCallbacks final : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String command=c->getValue(); command.trim(); command.toUpperCase();
    if(command=="CALIBRATE") calibrationRequested=true;
  }
};
void sendBleLine(const String &line) {
  if(!bleTelemetryCharacteristic || !bleClientConnected) return;
  if(bleTxCount>=BLE_QUEUE_CAPACITY) { Serial.println("BLE queue full; dropping telemetry"); return; }
  const size_t tail=(bleTxHead+bleTxCount)%BLE_QUEUE_CAPACITY;
  bleTxQueue[tail]=line+"\n"; ++bleTxCount;
}
void serviceBleTx() {
  if(!bleTelemetryCharacteristic || !bleClientConnected) {
    bleTxHead=bleTxCount=bleTxOffset=0;
    for(size_t i=0;i<BLE_QUEUE_CAPACITY;++i) bleTxQueue[i]="";
    return;
  }
  if(!bleTxCount || millis()-lastBleChunkTime<BLE_CHUNK_INTERVAL_MS) return;
  String &frame=bleTxQueue[bleTxHead];
  const size_t remaining=frame.length()-bleTxOffset;
  const size_t n=min(BLE_CHUNK_BYTES,remaining);
  uint8_t chunk[BLE_CHUNK_BYTES]; memcpy(chunk,frame.c_str()+bleTxOffset,n);
  bleTelemetryCharacteristic->setValue(chunk,n); bleTelemetryCharacteristic->notify();
  bleTxOffset+=n; lastBleChunkTime=millis();
  if(bleTxOffset>=frame.length()) {
    frame=""; bleTxHead=(bleTxHead+1)%BLE_QUEUE_CAPACITY; --bleTxCount; bleTxOffset=0;
  }
}
bool isPlaceholderCredential(const char *v) {
  return !v || !v[0] || strstr(v,"YOUR_") || strstr(v,"CHANGE_") ||
         strstr(v,"PLACEHOLDER") || strstr(v,"REPLACE_ME");
}
bool wifiCredentialsPresent() {
  return !isPlaceholderCredential(SPINEALIGN_WIFI_SSID) &&
         !isPlaceholderCredential(SPINEALIGN_WIFI_PASSWORD) &&
         !isPlaceholderCredential(SPINEALIGN_OTA_PASSWORD) &&
         strlen(SPINEALIGN_OTA_PASSWORD)>=12;
}
void beginOtaIfReady() {
  if(otaStarted || WiFi.status()!=WL_CONNECTED) return;
  ArduinoOTA.setHostname("spinealign-esp32cam");
  ArduinoOTA.setPassword(SPINEALIGN_OTA_PASSWORD);
  ArduinoOTA.onStart([](){Serial.println("OTA update started");});
  ArduinoOTA.onEnd([](){Serial.println("OTA update finished");});
  ArduinoOTA.onError([](ota_error_t e){Serial.printf("OTA error: %u\\n",(unsigned)e);});
  ArduinoOTA.begin(); otaStarted=true;
  Serial.print("OTA ready at "); Serial.println(WiFi.localIP());
}
void serviceOta() {
  if(!wifiCredentialsPresent()) return;
  if(WiFi.status()==WL_CONNECTED) { beginOtaIfReady(); if(otaStarted) ArduinoOTA.handle(); return; }
  otaStarted=false;
  if(!wifiAttempted || millis()-lastWifiAttempt>=60000UL) {
    wifiAttempted=true; lastWifiAttempt=millis(); WiFi.mode(WIFI_STA); WiFi.setSleep(false);
    WiFi.begin(SPINEALIGN_WIFI_SSID,SPINEALIGN_WIFI_PASSWORD);
  }
}
void startBle() {
  BLEDevice::init(BLE_DEVICE_NAME); BLEDevice::setMTU(185);
  BLESecurity *security=new BLESecurity();
  security->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  security->setCapability(ESP_IO_CAP_NONE);
  security->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK|ESP_BLE_ID_KEY_MASK);
  bleServer=BLEDevice::createServer(); bleServer->setCallbacks(new SpineAlignServerCallbacks());
  BLEService *service=bleServer->createService(BLE_SERVICE_UUID);
  bleTelemetryCharacteristic=service->createCharacteristic(BLE_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_NOTIFY|BLECharacteristic::PROPERTY_WRITE);
#if defined(CONFIG_BLUEDROID_ENABLED)
  bleTelemetryCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED|ESP_GATT_PERM_WRITE_ENCRYPTED);
#endif
  bleTelemetryCharacteristic->addDescriptor(new BLE2902());
  bleTelemetryCharacteristic->setCallbacks(new SpineAlignCharacteristicCallbacks());
  service->start();
  BLEAdvertising *adv=BLEDevice::getAdvertising(); adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(true); adv->start();
  Serial.println("BLE ready: SpineAlign-ESP32CAM (bonding enabled)");
}

enum BuzzType { BUZZ_NONE, BUZZ_DOUBLE, BUZZ_SINGLE };
enum BuzzStep { BUZZ_IDLE, BUZZ_ON_1, BUZZ_OFF_1, BUZZ_ON_2 };
BuzzType currentBuzz = BUZZ_NONE;
BuzzStep currentBuzzStep = BUZZ_IDLE;
unsigned long buzzStepStartTime = 0;
const unsigned long BUZZ_ON_TIME = 150;
const unsigned long BUZZ_OFF_TIME = 150;

bool mpuWriteRegister(uint8_t address, uint8_t reg, uint8_t value)
{
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuReadRegisters(uint8_t address, uint8_t startRegister, uint8_t *buffer, uint8_t length)
{
  Wire.beginTransmission(address);
  Wire.write(startRegister);
  if (Wire.endTransmission(false) != 0)
    return false;

  uint8_t received = Wire.requestFrom(address, length, true);
  if (received != length)
    return false;

  for (uint8_t i = 0; i < length; i++)
    buffer[i] = Wire.read();

  return true;
}

bool mpuPresent(uint8_t address)
{
  uint8_t whoAmI = 0;
  if (!mpuReadRegisters(address, MPU_WHO_AM_I, &whoAmI, 1))
    return false;
  // Accept MPU6050 (0x68) and compatible MPU6500-family modules (0x70) observed in this project.
  return whoAmI == 0x68 || whoAmI == 0x70;
}

bool mpuInit(uint8_t address)
{
  if (!mpuPresent(address))
    return false;

  if (!mpuWriteRegister(address, MPU_PWR_MGMT_1, 0x00)) return false;
  if (!mpuWriteRegister(address, MPU_SMPLRT_DIV, 9)) return false;
  if (!mpuWriteRegister(address, MPU_CONFIG, 0x03)) return false;
  if (!mpuWriteRegister(address, MPU_GYRO_CONFIG, 0x00)) return false;
  if (!mpuWriteRegister(address, MPU_ACCEL_CONFIG, 0x00)) return false;
  delay(100);
  return mpuPresent(address);
}

bool mpuReadRaw(uint8_t address, SensorData &data)
{
  uint8_t buffer[14];
  if (!mpuReadRegisters(address, MPU_ACCEL_XOUT_H, buffer, 14))
    return false;

  data.ax = (int16_t)((buffer[0] << 8) | buffer[1]);
  data.ay = (int16_t)((buffer[2] << 8) | buffer[3]);
  data.az = (int16_t)((buffer[4] << 8) | buffer[5]);
  data.gx = (int16_t)((buffer[8] << 8) | buffer[9]);
  data.gy = (int16_t)((buffer[10] << 8) | buffer[11]);
  data.gz = (int16_t)((buffer[12] << 8) | buffer[13]);
  return true;
}

// Pitch keeps the original firmware's Y-axis tilt convention. Roll is an orthogonal estimate.
// Validate all axis signs after mounting the sensors in their final orientation.
float calculatePitchAngle(const SensorData &data)
{
  float ax = (float)data.ax, ay = (float)data.ay, az = (float)data.az;
  return atan2f(ay, sqrtf((ax * ax) + (az * az))) * 180.0f / PI;
}

float calculateRollAngle(const SensorData &data)
{
  return atan2f(-(float)data.ax, (float)data.az) * 180.0f / PI;
}

float calculatePitchRate(const SensorData &data) { return (float)data.gx / 131.0f; }
float calculateRollRate(const SensorData &data) { return (float)data.gy / 131.0f; }

void updateSensor(uint8_t address, KalmanFilter &pitchFilter, KalmanFilter &rollFilter,
                  float &outputPitch, float &outputRoll, float zeroPitch, float zeroRoll,
                  bool &available, float dt)
{
  SensorData data;
  if (!mpuReadRaw(address, data)) { available = false; return; }
  available = true;
  outputPitch = pitchFilter.update(calculatePitchAngle(data), calculatePitchRate(data), dt) - zeroPitch;
  outputRoll = rollFilter.update(calculateRollAngle(data), calculateRollRate(data), dt) - zeroRoll;
}

int voltageToPercent(float voltage)
{
  // Rough single-cell Li-ion voltage curve; calibrate with the chosen cell and load.
  if (voltage <= 3.30f) return 0;
  if (voltage >= 4.20f) return 100;
  if (voltage < 3.50f) return (int)roundf((voltage - 3.30f) * 50.0f);
  if (voltage < 3.60f) return 10 + (int)roundf((voltage - 3.50f) * 100.0f);
  if (voltage < 3.70f) return 20 + (int)roundf((voltage - 3.60f) * 150.0f);
  if (voltage < 3.80f) return 35 + (int)roundf((voltage - 3.70f) * 150.0f);
  if (voltage < 3.90f) return 50 + (int)roundf((voltage - 3.80f) * 200.0f);
  if (voltage < 4.00f) return 70 + (int)roundf((voltage - 3.90f) * 150.0f);
  if (voltage < 4.10f) return 85 + (int)roundf((voltage - 4.00f) * 100.0f);
  return 95 + (int)roundf((voltage - 4.10f) * 50.0f);
}

void updateBatteryTelemetry() {
#if BATTERY_MONITOR_ENABLED
  if(!batteryAdcAvailable) {
    batteryVoltage=-1; batteryPercent=-1; batteryTelemetryAvailable=false;
    chargerSignalAvailable=false; batteryCharging=false; batteryFull=false; return;
  }
  const unsigned long now=millis(); if(now-lastBatteryRead<1000) return; lastBatteryRead=now;
  int32_t sum=0;
  for(int i=0;i<8;++i) { sum+=batteryADC.readADC_SingleEnded(BATTERY_ADC_CHANNEL); delay(2); }
  const float halfCellVoltage=batteryADC.computeVolts((int16_t)(sum/8));
  batteryVoltage=halfCellVoltage*BATTERY_VOLTAGE_DIVIDER_RATIO;
  batteryTelemetryAvailable=batteryVoltage>=2.5f && batteryVoltage<=4.5f;
  batteryPercent=batteryTelemetryAvailable?constrain(voltageToPercent(batteryVoltage),0,100):-1;
  // Active-low, open-drain TP4056 CHRG; A1 has a 10k pull-up to 3V3.
  chargerSenseVoltage=batteryADC.computeVolts(batteryADC.readADC_SingleEnded(CHARGER_ADC_CHANNEL));
  chargerSignalAvailable=chargerSenseVoltage<0.8f || chargerSenseVoltage>2.0f;
  if(chargerSignalAvailable) batteryCharging=chargerSenseVoltage<0.8f;
  batteryFull=batteryTelemetryAvailable && chargerSignalAvailable && !batteryCharging &&
              batteryVoltage>=BATTERY_CHARGE_FULL_VOLTAGE;
#else
  batteryVoltage=-1; batteryPercent=-1; batteryTelemetryAvailable=false;
  chargerSignalAvailable=false; batteryCharging=false; batteryFull=false;
#endif
}

void calibrateSensors()
{
  // A failed recalibration must not leave stale calibration marked as valid.
  isCalibrated = false;
  badPosture = false;
  alertActive = false;
  badPostureStartTime = 0;
  lastAlertTime = 0;
  currentBuzz = BUZZ_NONE;
  currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);

  SensorData neckData, backData;
  bool neckReadOK = mpuReadRaw(NECK_MPU_ADDRESS, neckData);
  bool backReadOK = mpuReadRaw(BACK_MPU_ADDRESS, backData);

  if (!neckReadOK || !backReadOK)
  {
    Serial.println("CALIBRATION FAILED"); sendBleLine("CALIBRATION FAILED");
    if(displayAvailable) { display.clearDisplay(); display.setTextSize(1); display.setCursor(0,0); display.println("Calibration failed"); display.println("Check sensors"); display.display(); }
    return;
  }

  const float neckInitialPitch = calculatePitchAngle(neckData);
  const float neckInitialRoll = calculateRollAngle(neckData);
  const float backInitialPitch = calculatePitchAngle(backData);
  const float backInitialRoll = calculateRollAngle(backData);
  neckPitchZero = neckInitialPitch; neckRollZero = neckInitialRoll;
  backPitchZero = backInitialPitch; backRollZero = backInitialRoll;
  neckPitchFilter.reset(neckInitialPitch); neckRollFilter.reset(neckInitialRoll);
  backPitchFilter.reset(backInitialPitch); backRollFilter.reset(backInitialRoll);
  neckPitch = neckRoll = backPitch = backRoll = 0.0f;
  neckAngle = backAngle = 0.0f;
  badPosture = false;
  alertActive = false;
  badPostureStartTime = 0;
  lastAlertTime = 0;
  isCalibrated = true;
  currentBuzz = BUZZ_NONE;
  currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);

  Serial.println("CALIBRATED"); sendBleLine("CALIBRATED");
  if(displayAvailable) { display.clearDisplay(); display.setTextSize(1); display.setCursor(0,0); display.println("Calibration complete"); display.println("Posture reference set"); display.display(); }
  delay(700);
}

void startAlert(BuzzType type)
{
  currentBuzz = type;
  currentBuzzStep = BUZZ_ON_1;
  buzzStepStartTime = millis();
  digitalWrite(ALERT_PIN, HIGH);
}

void updateAlert()
{
  if (currentBuzz == BUZZ_NONE)
  {
    digitalWrite(ALERT_PIN, LOW);
    return;
  }

  unsigned long currentTime = millis();
  switch (currentBuzzStep)
  {
    case BUZZ_ON_1:
      if (currentTime - buzzStepStartTime >= BUZZ_ON_TIME)
      {
        digitalWrite(ALERT_PIN, LOW);
        currentBuzzStep = BUZZ_OFF_1;
        buzzStepStartTime = currentTime;
      }
      break;

    case BUZZ_OFF_1:
      if (currentTime - buzzStepStartTime >= BUZZ_OFF_TIME)
      {
        if (currentBuzz == BUZZ_DOUBLE)
        {
          digitalWrite(ALERT_PIN, HIGH);
          currentBuzzStep = BUZZ_ON_2;
          buzzStepStartTime = currentTime;
        }
        else
        {
          currentBuzz = BUZZ_NONE;
          currentBuzzStep = BUZZ_IDLE;
        }
      }
      break;

    case BUZZ_ON_2:
      if (currentTime - buzzStepStartTime >= BUZZ_ON_TIME)
      {
        digitalWrite(ALERT_PIN, LOW);
        currentBuzz = BUZZ_NONE;
        currentBuzzStep = BUZZ_IDLE;
      }
      break;

    case BUZZ_IDLE:
    default:
      currentBuzz = BUZZ_NONE;
      digitalWrite(ALERT_PIN, LOW);
      break;
  }
}

void updatePosture()
{
  if (!isCalibrated)
    return;

  if (!neckAvailable || !backAvailable)
  {
    if (badPosture || alertActive || currentBuzz != BUZZ_NONE)
      Serial.println("POSTURE MONITORING PAUSED - SENSOR ERROR");

    badPosture = false;
    alertActive = false;
    badPostureStartTime = 0;
    lastAlertTime = 0;
    currentBuzz = BUZZ_NONE;
    currentBuzzStep = BUZZ_IDLE;
    digitalWrite(ALERT_PIN, LOW);
    return;
  }

  float maximumDeviation = max(fabsf(neckAngle), fabsf(backAngle));
  unsigned long currentTime = millis();

  if (!badPosture)
  {
    if (maximumDeviation >= POSTURE_THRESHOLD_DEG)
    {
      badPosture = true;
      alertActive = false;
      badPostureStartTime = currentTime;
    }
    return;
  }

  if (!alertActive)
  {
    if (maximumDeviation < POSTURE_THRESHOLD_DEG)
    {
      badPosture = false;
      badPostureStartTime = 0;
      lastAlertTime = 0;
      Serial.println("POSTURE RECOVERED BEFORE ALERT");
      return;
    }

    if (currentTime - badPostureStartTime >= BAD_POSTURE_HOLD_MS)
    {
      startAlert(BUZZ_DOUBLE);
      alertActive = true;
      lastAlertTime = currentTime;
      Serial.println("BAD POSTURE ALERT");
    }
    return;
  }

  if (maximumDeviation < RECOVER_THRESHOLD_DEG)
  {
    badPosture = false;
    alertActive = false;
    badPostureStartTime = 0;
    lastAlertTime = 0;
    currentBuzz = BUZZ_NONE;
    currentBuzzStep = BUZZ_IDLE;
    digitalWrite(ALERT_PIN, LOW);
    Serial.println("POSTURE RECOVERED");
    return;
  }

  if (currentTime - lastAlertTime >= ALERT_REPEAT_MS)
  {
    startAlert(BUZZ_SINGLE);
    lastAlertTime = currentTime;
    Serial.println("REPEATED POSTURE ALERT");
  }
}

String serialCommand = "";

void handleSerialCommands()
{
  while (Serial.available() > 0)
  {
    char receivedCharacter = Serial.read();
    if (receivedCharacter == '\n' || receivedCharacter == '\r')
    {
      if (serialCommand.length() > 0)
      {
        serialCommand.trim();
        serialCommand.toUpperCase();
        if (serialCommand == "CALIBRATE")
          calibrateSensors();
        serialCommand = "";
      }
    }
    else
    {
      serialCommand += receivedCharacter;
      if (serialCommand.length() > 40)
        serialCommand = "";
    }
  }
}

void drawPostureIcon(int x, int y, bool bad)
{
  if (!bad)
  {
    display.drawCircle(x + 6, y, 4, SSD1306_WHITE);
    display.drawLine(x + 6, y + 4, x + 6, y + 16, SSD1306_WHITE);
    display.drawLine(x + 6, y + 16, x, y + 22, SSD1306_WHITE);
    display.drawLine(x + 6, y + 16, x + 12, y + 22, SSD1306_WHITE);
  }
  else
  {
    display.drawCircle(x + 12, y + 2, 4, SSD1306_WHITE);
    display.drawLine(x + 12, y + 6, x + 6, y + 16, SSD1306_WHITE);
    display.drawLine(x + 6, y + 16, x, y + 22, SSD1306_WHITE);
    display.drawLine(x + 6, y + 16, x + 12, y + 22, SSD1306_WHITE);
  }
}

void printFixedAngle(float value)
{
  char buf[8];
  dtostrf(value, 6, 1, buf);
  display.print(buf);
}

void updateOLED()
{
  if(!displayAvailable) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SpineAlign Lite");
  display.setCursor(0, 13);
  display.print("Neck:");
  printFixedAngle(neckAngle);
  display.println((char)247);
  display.setCursor(0, 25);
  display.print("Back:");
  printFixedAngle(backAngle);
  display.println((char)247);

  if (!neckAvailable || !backAvailable)
  {
    display.setTextSize(1);
    display.setCursor(0, 44);
    display.println("SENSOR ERROR");
  }
  else if (!isCalibrated)
  {
    display.setTextSize(1);
    display.setCursor(0, 44);
    display.println("Press CALIBRATE");
  }
  else
  {
    display.setTextSize(2);
    display.setCursor(38, 40);
    display.println(badPosture ? "ALERT" : "GOOD");
    drawPostureIcon(90, 38, badPosture);
  }
  display.display();
}

String buildTelemetryLine() {
  String line; line.reserve(160);
  line += "N:" + String(neckAngle,1);
  line += ",B:" + String(backAngle,1);
  line += ",NP:" + String(neckPitch,1);
  line += ",NR:" + String(neckRoll,1);
  line += ",BP:" + String(backPitch,1);
  line += ",BR:" + String(backRoll,1);
  line += ",ALERT:" + String(badPosture?1:0);
  line += ",CAL:" + String(isCalibrated?1:0);
  line += ",NS:" + String(neckAvailable?1:0);
  line += ",BS:" + String(backAvailable?1:0);
  line += ",BAT:" + String(batteryTelemetryAvailable?batteryVoltage:-1.0f,2);
  line += ",PCT:" + String(batteryTelemetryAvailable?batteryPercent:-1);
  line += ",CHG:" + String((batteryTelemetryAvailable&&chargerSignalAvailable)?(batteryCharging?1:0):-1);
  line += ",FULL:" + String((batteryTelemetryAvailable&&chargerSignalAvailable)?(batteryFull?1:0):-1);
  return line;
}
void sendSerialData() { const String line=buildTelemetryLine(); Serial.println(line); sendBleLine(line); }
void checkCalibrationButton()
{
#if CALIBRATION_BUTTON_PIN >= 0
  bool currentButtonState = digitalRead(CALIBRATION_BUTTON_PIN);
  unsigned long currentTime = millis();

  if (currentButtonState != lastButtonState)
  {
    lastButtonChangeTime = currentTime;
    lastButtonState = currentButtonState;
  }

  if (currentTime - lastButtonChangeTime >= BUTTON_DEBOUNCE_MS)
  {
    if (currentButtonState == LOW)
    {
      calibrateSensors();
      while (digitalRead(CALIBRATION_BUTTON_PIN) == LOW)
        delay(5);
      lastButtonState = HIGH;
    }
  }
#endif
}

void setup() {
  pinMode(ALERT_PIN,OUTPUT); digitalWrite(ALERT_PIN,LOW);
  Serial.begin(115200); delay(300);
  Serial.println(); Serial.println("SpineAlign Lite - ESP32-CAM BLE + Wi-Fi OTA");
  Wire.begin(SDA_PIN,SCL_PIN); Wire.setClock(100000);
  displayAvailable=display.begin(SSD1306_SWITCHCAPVCC,OLED_ADDRESS);
  if(displayAvailable) {
    display.clearDisplay(); display.setTextColor(SSD1306_WHITE); display.setTextSize(1);
    display.setCursor(0,0); display.println("SpineAlign Lite"); display.println("Starting..."); display.display();
  } else Serial.println("OLED not detected; continuing without display");
  neckAvailable=mpuInit(NECK_MPU_ADDRESS); backAvailable=mpuInit(BACK_MPU_ADDRESS);
  Serial.printf("Neck IMU 0x68: %s\\n",neckAvailable?"OK":"FAILED");
  Serial.printf("Back IMU 0x69: %s\\n",backAvailable?"OK":"FAILED");
  batteryAdcAvailable=batteryADC.begin(ADS1115_ADDRESS,&Wire);
  if(batteryAdcAvailable) {
    batteryADC.setGain(GAIN_ONE); batteryADC.setDataRate(RATE_ADS1115_128SPS);
    Serial.println("ADS1115 battery/charger monitor: OK");
  } else Serial.println("ADS1115 not detected; battery telemetry unavailable");
  startBle();
  if(wifiCredentialsPresent()) {
    Serial.println("Wi-Fi configured; OTA will start after connection.");
    WiFi.mode(WIFI_STA); WiFi.setSleep(false); WiFi.begin(SPINEALIGN_WIFI_SSID,SPINEALIGN_WIFI_PASSWORD);
    wifiAttempted=true; lastWifiAttempt=millis();
  } else Serial.println("OTA disabled: replace config.h placeholders and use a 12+ char OTA password.");
  lastSensorTime=lastOLEDTime=lastSerialTime=lastBatteryRead=millis();
}

void loop() {
  serviceOta(); serviceBleTx(); handleSerialCommands(); checkCalibrationButton(); updateAlert();
  if(calibrationRequested) { calibrationRequested=false; calibrateSensors(); }
  updateBatteryTelemetry();
  const unsigned long currentTime=millis();
  if(currentTime-lastSensorTime>=SENSOR_INTERVAL_MS) {
    float dt=(currentTime-lastSensorTime)/1000.0f; lastSensorTime=currentTime;
    if(dt<=0.0f || dt>0.5f) dt=0.01f;
    updateSensor(NECK_MPU_ADDRESS,neckPitchFilter,neckRollFilter,neckPitch,neckRoll,
                 neckPitchZero,neckRollZero,neckAvailable,dt);
    updateSensor(BACK_MPU_ADDRESS,backPitchFilter,backRollFilter,backPitch,backRoll,
                 backPitchZero,backRollZero,backAvailable,dt);
    neckAngle=sqrtf((neckPitch*neckPitch)+(neckRoll*neckRoll));
    backAngle=sqrtf((backPitch*backPitch)+(backRoll*backRoll));
    updatePosture();
  }
  if(currentTime-lastOLEDTime>=OLED_INTERVAL_MS) { lastOLEDTime=currentTime; updateOLED(); }
  if(currentTime-lastSerialTime>=SERIAL_INTERVAL_MS) { lastSerialTime=currentTime; sendSerialData(); }
}