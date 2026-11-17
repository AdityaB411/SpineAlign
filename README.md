# SpineAlign

SpineAlign is a wearable posture-monitoring system designed for the **ESP32-WROOM** module with Bluetooth Low Energy (BLE), coupled with a real-time browser dashboard featuring 3-axis bioluminescent particle human skeleton kinematics (bending and sideways twisting), Kalman-filtered angle tracking, and automated slouch alert feedback.

---

## Architecture & Directory Structure

- [SpineAlign.ino](file:///e:/SpineAlign/SpineAlign.ino): Direct-flash ESP32-WROOM / ESP32 DevKit Bluetooth (BLE) sketch for Arduino IDE.
- `firmware/SpineAlign_ESP32WROOM/`: Dedicated ESP32-WROOM firmware package with PlatformIO configuration (`board = esp32dev`).
- `firmware/SpineAlign_NodeMCU/`: Legacy NodeMCU ESP8266 Wi-Fi firmware with WebSocket streaming.
- `firmware/SpineAlign_ESP32CAM/`: Legacy ESP32-CAM wireless firmware with custom OTA partition tables.
- `index.html`, `styles.css`, `app.js`, `orientation3d.js`: Dashboard with 3D human particle skeleton, dual-joint kinematics, and multi-transport selector.
- `ble-serial-bridge.js`, `telemetry-protocol.js`: Web Bluetooth bridge and strict shared telemetry parser.
- `tests/`: Automated unit and integration test suite (`npm test`).
- `docs/`: Setup guide, research paper overview, hardware pinouts, and system design specifications.

---

## ESP32-WROOM (Bluetooth Low Energy — Primary)

The primary physical configuration targets the standard **ESP32-WROOM / ESP32 DevKit v1** board streaming real-time telemetry over Bluetooth Low Energy (BLE).

### Standard ESP32-WROOM Pinout
| Pin | ESP32-WROOM GPIO | Connected Peripheral |
| :--- | :--- | :--- |
| **SDA** | `GPIO 21` | MPU6050 I²C Data & SSD1306 OLED SDA |
| **SCL** | `GPIO 22` | MPU6050 I²C Clock & SSD1306 OLED SCL |
| **Alert** | `GPIO 18` | Posture buzzer / LED driver (active HIGH) |
| **Calibrate** | `GPIO 0` | Onboard **BOOT** button (active LOW, momentary zero calibration) |
| **Status LED** | `GPIO 2` | Onboard Blue LED (Blink = Adv, Solid ON = Connected, Flash = Calibrated) |
| **Battery ADC** | `GPIO 34` | Optional battery voltage divider (ADC1 channel) |

### Bluetooth Specifications
- **Device Name**: `SpineAlign-ESP32`
- **Service UUID**: `67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101`
- **Telemetry Characteristic UUID**: `67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101`
- **Capabilities**: Telemetry notification stream (10 Hz, 100 ms) & incoming calibration command (`CALIBRATE`).

### Quick Flash Instructions (Arduino IDE)
1. Open [SpineAlign.ino](file:///e:/SpineAlign/SpineAlign.ino) in Arduino IDE.
2. Select Board: **ESP32 Dev Module** and choose your COM port.
3. Install `Adafruit SSD1306` and `Adafruit GFX Library` via Library Manager.
4. Click **Upload**.
5. Open the dashboard at `http://localhost:8000`, select **Bluetooth (ESP32)**, and click **Connect Bluetooth**.

---

## NodeMCU ESP8266 (Wi-Fi WebSockets)

Located in `firmware/SpineAlign_NodeMCU/`.

### Pinout
- **D2 (GPIO4)**: SDA (MPU6050 & SSD1306 OLED)
- **D1 (GPIO5)**: SCL (MPU6050 & SSD1306 OLED)
- **D5 (GPIO14)**: Alert Buzzer / LED
- **D3 (GPIO0)**: Physical calibration button (active LOW)

### Wi-Fi & WebSockets
1. Copy `firmware/SpineAlign_NodeMCU/config.example.h` to `config.h` and configure 2.4 GHz Wi-Fi credentials.
2. If unconfigured, the NodeMCU automatically starts an Access Point **`SpineAlign-NodeMCU`** at `192.168.4.1`.
3. In the dashboard, switch to **Wi-Fi (NodeMCU)**, enter `spinealign.local` (or `192.168.4.1`), and click **Connect NodeMCU**.

---

## Dashboard & Visualizer

Start local server:
```sh
python -m http.server 8000
```
Open `http://localhost:8000` in Google Chrome or Microsoft Edge.
- **Hero 3D Visualizer**: Real-time bioluminescent particle human skeleton with independent torso (teal) and neck (amber) articulation.
- **Transports Supported**: Web Bluetooth (ESP32-WROOM, default), WebSockets (NodeMCU ESP8266), and Web Serial (USB, 115200 baud).
- **Demo Mode**: Built-in interactive demo sliders and slouch simulation available without hardware.

---

## Software Tests

Run the complete automated test suite:
```sh
npm test
npm run check
```
All 34 automated tests validate strict telemetry parsing, Bluetooth adapter chunking, 2nd-order critically damped 3D kinematics with 1:1 angular fidelity, NodeMCU/ESP32 pinouts, and credential protection.
