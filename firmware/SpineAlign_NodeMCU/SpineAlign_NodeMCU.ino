#include <Wire.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <WebSocketsServer.h>
#include <ArduinoOTA.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

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
#ifndef SPINEALIGN_DUAL_IMU
#define SPINEALIGN_DUAL_IMU 0
#endif

// NodeMCU ESP8266 Pin Definitions
// D1 = GPIO5 (SCL), D2 = GPIO4 (SDA), D5 = GPIO14 (Alert Buzzer/LED)
#define SDA_PIN 4
#define SCL_PIN 5
#define ALERT_PIN 14
#define CALIBRATION_BUTTON_PIN 0 // D3 / FLASH button (active LOW)
#define BATTERY_ADC_PIN A0
#define BATTERY_MONITOR_ENABLED 1

#define NECK_MPU_ADDRESS 0x68
#define BACK_MPU_ADDRESS 0x69
#define OLED_ADDRESS 0x3C
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool displayAvailable = false;

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
bool batteryTelemetryAvailable = false;
unsigned long lastBatteryRead = 0;
bool neckAvailable = false, backAvailable = false;
bool isCalibrated = false;
bool badPosture = false, alertActive = false;
unsigned long badPostureStartTime = 0, lastAlertTime = 0;
unsigned long lastSensorTime = 0, lastOLEDTime = 0, lastSerialTime = 0;
bool lastButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;
const unsigned long BUTTON_DEBOUNCE_MS = 50;

// Wi-Fi, Web Server, WebSocket Server & OTA
ESP8266WebServer httpServer(80);
WebSocketsServer webSocket = WebSocketsServer(81);
bool apModeActive = false;
bool otaStarted = false;
volatile bool calibrationRequested = false;

void calibrateSensors();

bool isPlaceholderCredential(const char *v) {
  return !v || !v[0] || strstr(v, "YOUR_") || strstr(v, "CHANGE_") ||
         strstr(v, "PLACEHOLDER") || strstr(v, "REPLACE_ME");
}

bool wifiCredentialsPresent() {
  return !isPlaceholderCredential(SPINEALIGN_WIFI_SSID) &&
         !isPlaceholderCredential(SPINEALIGN_WIFI_PASSWORD);
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[WebSocket] Client #%u disconnected\n", num);
      break;
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[WebSocket] Client #%u connected from %s\n", num, ip.toString().c_str());
      webSocket.sendTXT(num, isCalibrated ? "STATUS:CALIBRATED" : "STATUS:UNCALIBRATED");
      break;
    }
    case WStype_TEXT: {
      String command = "";
      for (size_t i = 0; i < length; ++i) command += (char)payload[i];
      command.trim();
      command.toUpperCase();
      Serial.printf("[WebSocket] Received command: %s\n", command.c_str());
      if (command == "CALIBRATE") {
        calibrationRequested = true;
      }
      break;
    }
    default:
      break;
  }
}

void sendBroadcastLine(const String &line) {
  webSocket.broadcastTXT(line);
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

  uint8_t received = Wire.requestFrom(address, length, (uint8_t)true);
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
  return whoAmI == 0x68 || whoAmI == 0x70 || whoAmI == 0x72;
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

void updateBatteryTelemetry() {
#if BATTERY_MONITOR_ENABLED
  const unsigned long now = millis();
  if (now - lastBatteryRead < 1000) return;
  lastBatteryRead = now;

  // NodeMCU onboard divider maps 0-3.3V to 0-1.0V internal ADC.
  // Standard Li-ion 1S 3.0V - 4.2V can be monitored via voltage divider to A0.
  int raw = analogRead(BATTERY_ADC_PIN);
  float pinVoltage = (raw / 1023.0f) * 3.3f;
  // If pinVoltage is below 0.1V, treat as unmonitored / disconnected.
  if (pinVoltage < 0.2f) {
    batteryVoltage = -1.0f;
    batteryPercent = -1;
    batteryTelemetryAvailable = false;
    return;
  }
  // With a 100k:33k or similar divider, calibrate divider ratio:
  float measuredVoltage = pinVoltage * 1.3f; 
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

void calibrateSensors()
{
  isCalibrated = false; badPosture = false; alertActive = false;
  badPostureStartTime = 0; lastAlertTime = 0; currentBuzz = BUZZ_NONE; currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);

  SensorData neckData{}, backData{};
  bool neckReadOK = true;
#if SPINEALIGN_DUAL_IMU
  neckReadOK = mpuReadRaw(NECK_MPU_ADDRESS, neckData);
#endif
  const uint8_t backAddress = SPINEALIGN_DUAL_IMU ? BACK_MPU_ADDRESS : NECK_MPU_ADDRESS;
  const bool backReadOK = mpuReadRaw(backAddress, backData);
  if (!neckReadOK || !backReadOK) {
    Serial.println("CALIBRATION FAILED");
    sendBroadcastLine("CALIBRATION FAILED");
    if (displayAvailable) {
      display.clearDisplay(); display.setTextSize(1); display.setCursor(0, 0);
      display.println("Calibration failed"); display.println("Check sensors"); display.display();
    }
    return;
  }

#if SPINEALIGN_DUAL_IMU
  const float neckInitialPitch = calculatePitchAngle(neckData);
  const float neckInitialRoll = calculateRollAngle(neckData);
  neckPitchZero = neckInitialPitch; neckRollZero = neckInitialRoll;
  neckPitchFilter.reset(neckInitialPitch); neckRollFilter.reset(neckInitialRoll);
#else
  neckPitchZero = neckRollZero = 0.0f;
  neckPitchFilter.reset(0.0f); neckRollFilter.reset(0.0f);
  neckPitch = neckRoll = neckAngle = 0.0f;
#endif
  const float backInitialPitch = calculatePitchAngle(backData);
  const float backInitialRoll = calculateRollAngle(backData);
  backPitchZero = backInitialPitch; backRollZero = backInitialRoll;
  backPitchFilter.reset(backInitialPitch); backRollFilter.reset(backInitialRoll);
#if SPINEALIGN_DUAL_IMU
  neckPitch = neckRoll = neckAngle = 0.0f;
#endif
  backPitch = backRoll = backAngle = 0.0f;
  badPosture = false; alertActive = false; badPostureStartTime = 0; lastAlertTime = 0;
  isCalibrated = true; currentBuzz = BUZZ_NONE; currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);
  Serial.println("CALIBRATED");
  sendBroadcastLine("CALIBRATED");
  if (displayAvailable) {
    display.clearDisplay(); display.setTextSize(1); display.setCursor(0, 0);
    display.println("Calibration complete"); display.println("Posture reference set"); display.display();
  }
  delay(500);
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
  if (!isCalibrated) return;
  if (!backAvailable
#if SPINEALIGN_DUAL_IMU
      || !neckAvailable
#endif
  ) {
    if (badPosture || alertActive || currentBuzz != BUZZ_NONE)
      Serial.println("POSTURE MONITORING PAUSED - SENSOR ERROR");
    badPosture = false; alertActive = false; badPostureStartTime = 0; lastAlertTime = 0;
    currentBuzz = BUZZ_NONE; currentBuzzStep = BUZZ_IDLE; digitalWrite(ALERT_PIN, LOW);
    return;
  }
  float maximumDeviation = fabsf(backAngle);
#if SPINEALIGN_DUAL_IMU
  maximumDeviation = max(maximumDeviation, fabsf(neckAngle));
#endif
  const unsigned long currentTime = millis();
  if (!badPosture) {
    if (maximumDeviation >= POSTURE_THRESHOLD_DEG) {
      badPosture = true; alertActive = false; badPostureStartTime = currentTime;
    }
    return;
  }
  if (!alertActive) {
    if (maximumDeviation < POSTURE_THRESHOLD_DEG) {
      badPosture = false; badPostureStartTime = 0; lastAlertTime = 0;
      Serial.println("POSTURE RECOVERED BEFORE ALERT"); return;
    }
    if (currentTime - badPostureStartTime >= BAD_POSTURE_HOLD_MS) {
      startAlert(BUZZ_DOUBLE); alertActive = true; lastAlertTime = currentTime;
      Serial.println("BAD POSTURE ALERT");
    }
    return;
  }
  if (maximumDeviation < RECOVER_THRESHOLD_DEG) {
    badPosture = false; alertActive = false; badPostureStartTime = 0; lastAlertTime = 0;
    currentBuzz = BUZZ_NONE; currentBuzzStep = BUZZ_IDLE; digitalWrite(ALERT_PIN, LOW);
    Serial.println("POSTURE RECOVERED"); return;
  }
  if (currentTime - lastAlertTime >= ALERT_REPEAT_MS) {
    startAlert(BUZZ_SINGLE); lastAlertTime = currentTime; Serial.println("REPEATED POSTURE ALERT");
  }
}

String serialCommand = "";

void handleSerialCommands()
{
  while (Serial.available() > 0)
  {
    char receivedCharacter = (char)Serial.read();
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

void printFixedAngle(float value)
{
  char buf[8];
  dtostrf(value, 6, 1, buf);
  display.print(buf);
}

void updateOLED()
{
  if (!displayAvailable) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SpineAlign NodeMCU");
  display.setCursor(0, 13);
  display.print("Neck:");
#if SPINEALIGN_DUAL_IMU
  printFixedAngle(neckAngle);
#else
  display.print(" N/A");
#endif
  display.println((char)247);
  display.setCursor(0, 25);
  display.print("Back:");
  printFixedAngle(backAngle);
  display.println((char)247);

  if (!backAvailable
#if SPINEALIGN_DUAL_IMU
      || !neckAvailable
#endif
  ) {
    display.setTextSize(1);
    display.setCursor(0, 44);
    display.println("SENSOR ERROR");
  } else if (!isCalibrated) {
    display.setTextSize(1);
    display.setCursor(0, 44);
    display.println("Press CALIBRATE");
  } else {
    display.setTextSize(2);
    display.setCursor(38, 40);
    display.println(badPosture ? "ALERT" : "GOOD");
  }
  display.display();
}

String buildTelemetryLine() {
  String line; line.reserve(160);
  line += "N:" + String(neckAngle, 1);
  line += ",B:" + String(backAngle, 1);
  line += ",NP:" + String(neckPitch, 1);
  line += ",NR:" + String(neckRoll, 1);
  line += ",BP:" + String(backPitch, 1);
  line += ",BR:" + String(backRoll, 1);
  line += ",MODE:" + String(SPINEALIGN_DUAL_IMU ? 2 : 1);
  line += ",ALERT:" + String(badPosture ? 1 : 0);
  line += ",CAL:" + String(isCalibrated ? 1 : 0);
  line += ",NS:" + String(neckAvailable ? 1 : 0);
  line += ",BS:" + String(backAvailable ? 1 : 0);
  line += ",BAT:" + String(batteryTelemetryAvailable ? batteryVoltage : -1.0f, 2);
  line += ",PCT:" + String(batteryTelemetryAvailable ? batteryPercent : -1);
  line += ",CHG:-1";
  line += ",FULL:-1";
  return line;
}

void sendTelemetry() {
  const String line = buildTelemetryLine();
  Serial.println(line);
  sendBroadcastLine(line);
}

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
      while (digitalRead(CALIBRATION_BUTTON_PIN) == LOW) {
        delay(5);
        yield();
      }
      lastButtonState = HIGH;
    }
  }
#endif
}

void setupWebServer() {
  // CORS enabled status endpoint
  httpServer.on("/status", HTTP_GET, []() {
    String json = "{";
    json += "\"device\":\"SpineAlign-NodeMCU\",";
    json += "\"mode\":" + String(SPINEALIGN_DUAL_IMU ? 2 : 1) + ",";
    json += "\"ap\":" + String(apModeActive ? "true" : "false") + ",";
    json += "\"ip\":\"" + (apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString()) + "\",";
    json += "\"wsPort\":81,";
    json += "\"calibrated\":" + String(isCalibrated ? "true" : "false") + ",";
    json += "\"badPosture\":" + String(badPosture ? "true" : "false") + ",";
    json += "\"neckAngle\":" + String(neckAngle, 1) + ",";
    json += "\"backAngle\":" + String(backAngle, 1);
    json += "}";
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", json);
  });

  // HTTP calibration endpoint
  httpServer.on("/calibrate", HTTP_GET, []() {
    calibrationRequested = true;
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"calibrating\"}");
  });

  // Embedded lightweight dashboard landing page
  httpServer.on("/", HTTP_GET, []() {
    String html = F("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>SpineAlign NodeMCU</title><style>"
      ":root{--bg:#f3f5ef;--surface:#fffefb;--ink:#29372e;--primary:#66836d;--coral:#c77f72;--good:#4a8068;}"
      "body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,sans-serif;}"
      ".card{max-width:540px;margin:20px auto;background:var(--surface);border:1px solid #e1e7dc;border-radius:16px;padding:24px;box-shadow:0 3px 12px rgba(42,61,43,.04);}"
      "h1{margin:0 0 8px;font-size:22px;color:#29382e;}p{color:#55645a;font-size:13px;line-height:1.6;margin:0 0 16px;}"
      ".pill{display:inline-block;padding:5px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#eef0ff;color:#5d69dc;margin-bottom:16px;}"
      ".angles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;}"
      ".angle-box{background:#f6f8f4;border-radius:12px;padding:14px;text-align:center;}"
      ".val{font-size:28px;font-weight:800;color:#29382e;margin-top:4px;}"
      "button{width:100%;padding:13px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-weight:700;font-size:13px;cursor:pointer;margin-top:8px;}"
      "button:hover{background:#4f6e57;} .status{margin-top:14px;font-size:11px;color:#7f8a80;text-align:center;}"
      "</style></head><body><div class='card'>"
      "<h1>SpineAlign NodeMCU</h1><p>Wi-Fi Posture Companion streaming over WebSockets on port 81.</p>"
      "<div class='pill' id='linkStatus'>Connecting WebSocket...</div>"
      "<div class='angles'>"
      "<div class='angle-box'><div>Neck Angle</div><div class='val' id='neckVal'>--°</div></div>"
      "<div class='angle-box'><div>Back Angle</div><div class='val' id='backVal'>--°</div></div>"
      "</div>"
      "<button id='calBtn' onclick='sendCalibrate()'>Calibrate Posture</button>"
      "<div class='status' id='postureStatus'>Posture Good</div>"
      "</div><script>"
      "const wsUrl='ws://'+location.hostname+':81/';"
      "let ws=null;"
      "function connect(){"
      "  ws=new WebSocket(wsUrl);"
      "  ws.onopen=()=>{document.getElementById('linkStatus').innerText='WebSocket Connected';document.getElementById('linkStatus').style.background='#e5efe1';document.getElementById('linkStatus').style.color='#4b7955';};"
      "  ws.onclose=()=>{document.getElementById('linkStatus').innerText='Disconnected. Reconnecting...';setTimeout(connect,2000);};"
      "  ws.onmessage=(e)=>{"
      "    const l=e.data.trim();"
      "    if(l.includes('N:')&&l.includes('B:')){"
      "      const parts=l.split(',');const d={};"
      "      parts.forEach(p=>{const s=p.split(':');if(s.length===2)d[s[0]]=s[1];});"
      "      if(d.N)document.getElementById('neckVal').innerText=d.N+'°';"
      "      if(d.B)document.getElementById('backVal').innerText=d.B+'°';"
      "      if(d.ALERT==='1'){document.getElementById('postureStatus').innerText='Posture Alert!';document.getElementById('postureStatus').style.color='#c77f72';}"
      "      else{document.getElementById('postureStatus').innerText='Posture In Range';document.getElementById('postureStatus').style.color='#4a8068';}"
      "    }"
      "  };"
      "}"
      "function sendCalibrate(){if(ws&&ws.readyState===1)ws.send('CALIBRATE');}"
      "connect();"
      "</script></body></html>");
    httpServer.send(200, "text/html", html);
  });

  httpServer.begin();
  Serial.println("HTTP Web Server ready on port 80");
}

void setupWiFi() {
  WiFi.mode(WIFI_STA);
  if (wifiCredentialsPresent()) {
    Serial.printf("Connecting to Wi-Fi SSID: %s...\n", SPINEALIGN_WIFI_SSID);
    WiFi.begin(SPINEALIGN_WIFI_SSID, SPINEALIGN_WIFI_PASSWORD);

    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
      delay(250);
      Serial.print(".");
    }
    Serial.println();
  }

  if (WiFi.status() == WL_CONNECTED) {
    apModeActive = false;
    Serial.print("Connected to Wi-Fi! IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    // Fallback to Access Point (AP) mode
    apModeActive = true;
    WiFi.mode(WIFI_AP);
    IPAddress apIP(192, 168, 4, 1);
    IPAddress netMsk(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, apIP, netMsk);
    WiFi.softAP("SpineAlign-NodeMCU");
    Serial.print("Started Access Point 'SpineAlign-NodeMCU'. IP: ");
    Serial.println(WiFi.softAPIP());
  }

  // Setup mDNS responder (spinealign.local)
  if (MDNS.begin("spinealign")) {
    Serial.println("mDNS responder started: http://spinealign.local");
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
  }

  // Start WebSocket Server on port 81
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server ready on port 81");

  // Start HTTP Server
  setupWebServer();

  // Setup ArduinoOTA if password is configured
  if (!isPlaceholderCredential(SPINEALIGN_OTA_PASSWORD) && strlen(SPINEALIGN_OTA_PASSWORD) >= 12) {
    ArduinoOTA.setHostname("spinealign-nodemcu");
    ArduinoOTA.setPassword(SPINEALIGN_OTA_PASSWORD);
    ArduinoOTA.onStart([]() { Serial.println("OTA update started"); });
    ArduinoOTA.onEnd([]() { Serial.println("OTA update finished"); });
    ArduinoOTA.onError([](ota_error_t error) { Serial.printf("OTA Error[%u]\n", error); });
    ArduinoOTA.begin();
    otaStarted = true;
    Serial.println("ArduinoOTA ready for over-the-air updates");
  }
}

void setup() {
  pinMode(ALERT_PIN, OUTPUT);
  digitalWrite(ALERT_PIN, LOW);
#if CALIBRATION_BUTTON_PIN >= 0
  pinMode(CALIBRATION_BUTTON_PIN, INPUT_PULLUP);
#endif

  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("==================================================");
  Serial.println("SpineAlign NodeMCU ESP8266 (Wi-Fi + WebSockets)");
  Serial.println("==================================================");

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  displayAvailable = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (displayAvailable) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("SpineAlign NodeMCU");
    display.println("Starting Wi-Fi...");
    display.display();
  } else {
    Serial.println("OLED not detected; continuing without display");
  }

#if SPINEALIGN_DUAL_IMU
  neckAvailable = mpuInit(NECK_MPU_ADDRESS);
  backAvailable = mpuInit(BACK_MPU_ADDRESS);
  Serial.printf("Dual IMU mode; neck 0x68: %s\n", neckAvailable ? "OK" : "FAILED");
  Serial.printf("Dual IMU mode; back 0x69: %s\n", backAvailable ? "OK" : "FAILED");
#else
  neckAvailable = false;
  backAvailable = mpuInit(NECK_MPU_ADDRESS);
  Serial.printf("Single IMU mode; back sensor on 0x68: %s\n", backAvailable ? "OK" : "FAILED");
#endif

  setupWiFi();

  lastSensorTime = lastOLEDTime = lastSerialTime = lastBatteryRead = millis();
}

void loop() {
  webSocket.loop();
  httpServer.handleClient();
  MDNS.update();
  if (otaStarted) ArduinoOTA.handle();

  handleSerialCommands();
  checkCalibrationButton();
  updateAlert();

  if (calibrationRequested) {
    calibrationRequested = false;
    calibrateSensors();
  }

  updateBatteryTelemetry();

  const unsigned long currentTime = millis();
  if (currentTime - lastSensorTime >= SENSOR_INTERVAL_MS) {
    float dt = (currentTime - lastSensorTime) / 1000.0f;
    lastSensorTime = currentTime;
    if (dt <= 0.0f || dt > 0.5f) dt = 0.01f;

#if SPINEALIGN_DUAL_IMU
    updateSensor(NECK_MPU_ADDRESS, neckPitchFilter, neckRollFilter, neckPitch, neckRoll,
                 neckPitchZero, neckRollZero, neckAvailable, dt);
    updateSensor(BACK_MPU_ADDRESS, backPitchFilter, backRollFilter, backPitch, backRoll,
                 backPitchZero, backRollZero, backAvailable, dt);
    neckAngle = sqrtf((neckPitch * neckPitch) + (neckRoll * neckRoll));
#else
    neckAvailable = false;
    neckPitch = neckRoll = neckAngle = 0.0f;
    updateSensor(NECK_MPU_ADDRESS, backPitchFilter, backRollFilter, backPitch, backRoll,
                 backPitchZero, backRollZero, backAvailable, dt);
#endif
    backAngle = sqrtf((backPitch * backPitch) + (backRoll * backRoll));
    updatePosture();
  }

  if (currentTime - lastOLEDTime >= OLED_INTERVAL_MS) {
    lastOLEDTime = currentTime;
    updateOLED();
  }

  if (currentTime - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = currentTime;
    sendTelemetry();
  }

  yield();
}
