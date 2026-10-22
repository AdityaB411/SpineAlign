#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

#define SDA_PIN 21
#define SCL_PIN 23
#define ALERT_PIN 25
#define CALIBRATION_BUTTON_PIN 14
#define NECK_MPU_ADDRESS 0x68
#define BACK_MPU_ADDRESS 0x69
#define OLED_ADDRESS 0x3C
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

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

KalmanFilter neckFilter, backFilter;
float neckAngle = 0.0f, backAngle = 0.0f;
float neckZero = 0.0f, backZero = 0.0f;
bool neckAvailable = false, backAvailable = false;
bool isCalibrated = false;
bool badPosture = false, alertActive = false;
unsigned long badPostureStartTime = 0, lastAlertTime = 0;
unsigned long lastSensorTime = 0, lastOLEDTime = 0, lastSerialTime = 0;
bool lastButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;
const unsigned long BUTTON_DEBOUNCE_MS = 50;

enum BuzzType { BUZZ_NONE, BUZZ_DOUBLE, BUZZ_SINGLE };
enum BuzzStep { BUZZ_IDLE, BUZZ_ON_1, BUZZ_OFF_1, BUZZ_ON_2 };
BuzzType currentBuzz = BUZZ_NONE;
BuzzStep currentBuzzStep = BUZZ_IDLE;
unsigned long buzzStepStartTime = 0;
const unsigned long BUZZ_ON_TIME = 150;
const unsigned long BUZZ_OFF_TIME = 150;

void mpuWriteRegister(uint8_t address, uint8_t reg, uint8_t value)
{
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
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
  return whoAmI == 0x68;
}

bool mpuInit(uint8_t address)
{
  if (!mpuPresent(address))
    return false;

  mpuWriteRegister(address, MPU_PWR_MGMT_1, 0x00);
  mpuWriteRegister(address, MPU_SMPLRT_DIV, 9);
  mpuWriteRegister(address, MPU_CONFIG, 0x03);
  mpuWriteRegister(address, MPU_GYRO_CONFIG, 0x00);
  mpuWriteRegister(address, MPU_ACCEL_CONFIG, 0x00);
  delay(100);
  return true;
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

float calculateAccelerometerAngle(const SensorData &data)
{
  float ax = (float)data.ax;
  float ay = (float)data.ay;
  float az = (float)data.az;
  float denominator = sqrtf((ax * ax) + (az * az));
  return atan2f(ay, denominator) * 180.0f / PI;
}

float calculateGyroscopeRate(const SensorData &data)
{
  return (float)data.gx / 131.0f;
}

void updateSensor(uint8_t address, KalmanFilter &filter, float &outputAngle,
                  float zeroAngle, bool &available, float dt)
{
  SensorData data;
  if (!mpuReadRaw(address, data))
  {
    available = false;
    return;
  }

  available = true;
  float accelerometerAngle = calculateAccelerometerAngle(data);
  float gyroRate = calculateGyroscopeRate(data);
  float filteredAngle = filter.update(accelerometerAngle, gyroRate, dt);
  outputAngle = filteredAngle - zeroAngle;
}

void calibrateSensors()
{
  SensorData neckData, backData;
  bool neckReadOK = mpuReadRaw(NECK_MPU_ADDRESS, neckData);
  bool backReadOK = mpuReadRaw(BACK_MPU_ADDRESS, backData);

  if (!neckReadOK || !backReadOK)
  {
    Serial.println("CALIBRATION FAILED");
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("Calibration failed");
    display.println("Check sensors");
    display.display();
    return;
  }

  float neckInitialAngle = calculateAccelerometerAngle(neckData);
  float backInitialAngle = calculateAccelerometerAngle(backData);
  neckZero = neckInitialAngle;
  backZero = backInitialAngle;
  neckFilter.reset(neckInitialAngle);
  backFilter.reset(backInitialAngle);
  neckAngle = 0.0f;
  backAngle = 0.0f;
  badPosture = false;
  alertActive = false;
  badPostureStartTime = 0;
  lastAlertTime = 0;
  isCalibrated = true;
  currentBuzz = BUZZ_NONE;
  currentBuzzStep = BUZZ_IDLE;
  digitalWrite(ALERT_PIN, LOW);

  Serial.println("CALIBRATED");
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Calibration complete");
  display.println("Posture reference set");
  display.display();
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

void sendSerialData()
{
  Serial.print("N:");
  Serial.print(neckAngle, 1);
  Serial.print(",B:");
  Serial.print(backAngle, 1);
  Serial.print(",ALERT:");
  Serial.println(badPosture ? 1 : 0);
}

void checkCalibrationButton()
{
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
}

void setup()
{
  pinMode(ALERT_PIN, OUTPUT);
  digitalWrite(ALERT_PIN, LOW);
  pinMode(CALIBRATION_BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("SpineAlign Lite - Wokwi Simulation");
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS))
  {
    Serial.println("OLED initialization failed");
  }
  else
  {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("SpineAlign Lite");
    display.println("Starting...");
    display.display();
  }

  neckAvailable = mpuInit(NECK_MPU_ADDRESS);
  backAvailable = mpuInit(BACK_MPU_ADDRESS);
  Serial.print("Neck sensor: ");
  Serial.println(neckAvailable ? "OK" : "FAILED - check wiring/address");
  Serial.print("Back sensor: ");
  Serial.println(backAvailable ? "OK" : "FAILED - check wiring/address");
  Serial.println("Press CALIBRATE button or type CALIBRATE + Enter");
  Serial.println();
  lastSensorTime = millis();
  lastOLEDTime = millis();
  lastSerialTime = millis();
}

void loop()
{
  unsigned long currentTime = millis();
  handleSerialCommands();
  checkCalibrationButton();
  updateAlert();

  if (currentTime - lastSensorTime >= SENSOR_INTERVAL_MS)
  {
    float dt = (currentTime - lastSensorTime) / 1000.0f;
    lastSensorTime = currentTime;
    if (dt <= 0.0f || dt > 0.5f)
      dt = 0.01f;

    updateSensor(NECK_MPU_ADDRESS, neckFilter, neckAngle, neckZero, neckAvailable, dt);
    updateSensor(BACK_MPU_ADDRESS, backFilter, backAngle, backZero, backAvailable, dt);
    updatePosture();
  }

  if (currentTime - lastOLEDTime >= OLED_INTERVAL_MS)
  {
    lastOLEDTime = currentTime;
    updateOLED();
  }

  if (currentTime - lastSerialTime >= SERIAL_INTERVAL_MS)
  {
    lastSerialTime = currentTime;
    sendSerialData();
  }
}
