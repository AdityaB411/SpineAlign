# SpineAlign

SpineAlign is a wearable posture-monitoring system powered by **NodeMCU ESP8266** streaming real-time telemetry over **Wi-Fi WebSockets (25 Hz)**, paired with a real-time 3D human spine browser dashboard supporting both **Wi-Fi** (default) and **Bluetooth (BLE)** with Kalman-filtered angle tracking and slouch alert feedback.

---

## Architecture & Directory Structure

- `firmware/SpineAlign_NodeMCU/`: NodeMCU ESP8266 Wi-Fi firmware (`SpineAlign_NodeMCU.ino`, `platformio.ini`, `config.example.h`, wiring guide).
- `index.html`, `styles.css`, `app.js`, `orientation3d.js`: Real-time dashboard with interactive 3D sculpted human spine model, dual-joint kinematics, and Wi-Fi / Bluetooth connection switcher.
- `ble-serial-bridge.js`, `telemetry-protocol.js`: Web Bluetooth bridge and strict shared telemetry parser.
- `tests/`: Automated unit and integration test suite (`npm test`).
- `docs/`: Dashboard setup guide and project/research documentation.

---

## NodeMCU ESP8266 Hardware Pinout

Both MPU6050 sensors use separate, boot-safe `D` pins so neither sensor requires an `AD0 → 3V3` jumper:

| NodeMCU Pin | GPIO | Function | Connected Peripheral |
| :--- | :--- | :--- | :--- |
| **D2** | `GPIO 4` | MPU #1 (Neck) SDA | Neck MPU6050 SDA *(or Single IMU SDA)* |
| **D1** | `GPIO 5` | MPU #1 (Neck) SCL | Neck MPU6050 SCL *(or Single IMU SCL)* |
| **D6** | `GPIO 12` | MPU #2 (Back) SDA | Back MPU6050 SDA *(or Single IMU SDA)* |
| **D7** | `GPIO 13` | MPU #2 (Back) SCL | Back MPU6050 SCL *(or Single IMU SCL)* |
| **D5** | `GPIO 14` | Alert Buzzer / LED | Active buzzer `(+)` or alert LED (`-` to `GND`) |
| **D3** | `GPIO 0` | Calibrate Button | Push-button to `GND` (or onboard **FLASH** button) |
| **A0** | `ADC0` | Battery Sense (Opt) | Voltage divider from 1S Li-ion battery `(+)` |
| **3V3 / GND** | Power | Supply | MPU6050 `VCC` / `GND` and buzzer `(-)` |

---

## Quick Start

### 1. Flash NodeMCU Firmware
1. Open `firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino` in Arduino IDE (or run `pio run -d firmware/SpineAlign_NodeMCU`).
2. Select Board: **NodeMCU 1.0 (ESP-12E Module)** and install `WebSockets` by Markus Sattler (`links2004`).
3. Optionally copy `config.example.h` to `config.h` with your 2.4 GHz Wi-Fi credentials; otherwise NodeMCU boots into Access Point **`SpineAlign-NodeMCU`** at `192.168.4.1`.
4. Upload to the NodeMCU.

### 2. Run the Dashboard Locally
```sh
python -m http.server 8000
```
Open `http://localhost:8000` in Chrome or Edge:
- **Wi-Fi (Default)**: Pick `spinealign.local` or `192.168.4.1 (AP)` on port `81` and click **Connect Wi-Fi**.
- **Bluetooth**: Switch to the **Bluetooth** tab in the header or connection card to pair any compatible BLE device.

---

## Tests

```sh
npm run check
npm test
```
