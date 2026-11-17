# SpineAlign ESP32-WROOM Bluetooth (BLE) Firmware

Direct, physical firmware for **ESP32-WROOM / ESP32 DevKit v1** posture monitoring with Bluetooth Low Energy (BLE) telemetry streaming and local buzzer/OLED feedback.

---

## Hardware Pinout

| Function | ESP32-WROOM GPIO | Notes |
| :--- | :--- | :--- |
| **I2C SDA** | `GPIO 21` | Standard ESP32 I2C Data (MPU6050 & SSD1306 OLED) |
| **I2C SCL** | `GPIO 22` | Standard ESP32 I2C Clock (100 kHz) |
| **Alert Buzzer / LED** | `GPIO 18` | Active-high digital output (drive buzzer via NPN transistor / MOSFET) |
| **Calibration Button** | `GPIO 0` | Onboard **BOOT** button (active-low with internal pullup) |
| **Battery ADC (Optional)** | `GPIO 34` | ADC1 channel (input only, no internal pullup) |
| **Power** | `3V3` / `5V` (VIN) & `GND` | Power MPU6050 and OLED from regulated 3.3V rails |

### I2C Bus Addresses
- **Neck MPU6050**: `0x68` (AD0 pin connected to GND)
- **Back MPU6050**: `0x69` (AD0 pin connected to 3.3V) — in single-sensor mode, the single back sensor uses `0x68`.
- **SSD1306 128x64 OLED**: `0x3C`

---

## Bluetooth Low Energy (BLE) Specifications

- **Device Name**: `SpineAlign-ESP32`
- **Service UUID**: `67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101`
- **Telemetry Characteristic UUID**: `67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101`
- **Properties**: `NOTIFY` (telemetry stream at 5 Hz) and `WRITE` (calibration command `CALIBRATE`)
- **MTU & Chunking**: MTU set to 185; 20-byte serialized chunk streaming with flow-controlled queue for universal Web Bluetooth compatibility.

---

## Flashing Instructions

### Method A: Arduino IDE
1. Open the Arduino IDE.
2. Ensure you have the **esp32** board package installed via the Boards Manager:
   - *Tools* > *Board* > *Boards Manager* > search for `esp32` by Espressif Systems.
3. Select board: **ESP32 Dev Module** (or your specific ESP32-WROOM board).
4. Install required libraries via *Sketch* > *Include Library* > *Manage Libraries*:
   - `Adafruit SSD1306`
   - `Adafruit GFX Library`
5. Open `SpineAlign_ESP32WROOM.ino` (or [SpineAlign.ino](../../SpineAlign.ino) in root).
6. Connect your ESP32-WROOM via micro-USB, select the corresponding COM port, and click **Upload**.

### Method B: PlatformIO (VS Code / CLI)
1. Navigate to this directory:
   ```bash
   cd firmware/SpineAlign_ESP32WROOM
   ```
2. Build and flash:
   ```bash
   pio run --target upload
   ```
3. Open serial monitor:
   ```bash
   pio device monitor -b 115200
   ```

---

## Connecting to the Dashboard

1. Open `index.html` in Google Chrome, Microsoft Edge, or any Web Bluetooth-enabled browser over `http://localhost:8000` (or HTTPS).
2. The **Bluetooth (ESP32)** tab is selected by default.
3. Click **Connect Bluetooth**.
4. In the browser device picker dialog, choose **SpineAlign-ESP32** and click **Pair**.
5. Live telemetry, 3D bioluminescent skeleton articulation, and posture history charts will immediately stream in real time.
