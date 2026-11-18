# SpineAlign NodeMCU ESP8266 Firmware (Wi-Fi Only)

Minimal Wi-Fi and WebSocket posture monitoring firmware for NodeMCU (ESP8266 ESP-12E / ESP-12F), supporting both **Single IMU** and **Dual IMU** setups.

---

## Features

- **Minimal Wi-Fi-Only Footprint**:
  - No BLE, OLED, OTA, or USB Serial telemetry overhead—only requires `links2004/WebSockets`.
  - Connects to your 2.4 GHz Wi-Fi router (Station mode) with automatic fallback to Access Point (`SpineAlign-NodeMCU` at `192.168.4.1`).
  - mDNS hostname: `http://spinealign.local`.
- **Dual & Single IMU Support (Auto-Detect or Forced)**:
  - Default (`SPINEALIGN_DUAL_IMU -1`): **Auto-detects** on boot and calibration.
    - **Dual IMU (`MODE:2`)**: Neck on `0x68` + Back on `0x69`.
    - **Single IMU (`MODE:1`)**: Back on `0x68` (or `0x69` if only `0x69` is connected).
  - Can also be forced via `config.h`: `0` = Single IMU, `1` = Dual IMU.
- **Real-Time WebSockets & Embedded Dashboard**:
  - WebSocket server on port `81` streams SpineAlign telemetry at 5 Hz (200 ms) and accepts `CALIBRATE`.
  - Built-in HTTP server on port `80` serves a lightweight dashboard (`/`), `/status`, and `/calibrate`.

---

## Pinout & Wiring

Both MPU6050 sensors use **separate, boot-safe `D` pins** so neither sensor requires an `AD0 → 3V3` address jumper (both stay at default `0x68`):

| NodeMCU Pin | GPIO | Function | Connect To |
|---|---|---|---|
| **D2** | GPIO4 | MPU #1 (Neck) SDA | Neck MPU6050 SDA *(or Single IMU SDA)* |
| **D1** | GPIO5 | MPU #1 (Neck) SCL | Neck MPU6050 SCL *(or Single IMU SCL)* |
| **D6** | GPIO12 | MPU #2 (Back) SDA | Back MPU6050 SDA *(or Single IMU SDA)* |
| **D7** | GPIO13 | MPU #2 (Back) SCL | Back MPU6050 SCL *(or Single IMU SCL)* |
| **D5** | GPIO14 | Posture Alert | Active Buzzer (+) or Alert LED |
| **D3** | GPIO0 | Calibration Button | Optional push-button to GND (or onboard **FLASH** button) |
| **A0** | ADC0 | Battery Sense | Voltage divider from 1S Li-ion battery (optional) |
| **3V3** | 3.3V | Power | Both MPU6050 VCC pins |
| **GND** | GND | Ground | Both MPU6050 GND pins, Buzzer (-) |

> [!NOTE]
> - **Dual IMU (`MODE:2`)**: Connect Neck MPU6050 to **D2/D1** and Back MPU6050 to **D6/D7** (leave `AD0` unconnected or tied to GND on both).
> - **Single IMU (`MODE:1`)**: Connect 1 MPU6050 to **either** `D2/D1` or `D6/D7` — auto-detected on boot and calibration.

---

## Configuration

1. Copy `config.example.h` to `config.h`:
   ```sh
   cp config.example.h config.h
   ```
2. Open `config.h` and set your Wi-Fi credentials and IMU mode:
   ```c
   #define SPINEALIGN_WIFI_SSID "Your_WiFi_SSID"
   #define SPINEALIGN_WIFI_PASSWORD "Your_WiFi_Password"
   #define SPINEALIGN_DUAL_IMU -1 // -1 = Auto, 0 = Single IMU, 1 = Dual IMU
   ```
3. Leave credentials as placeholders (or omit `config.h`) to boot directly into Access Point **`SpineAlign-NodeMCU`** (`192.168.4.1`).

---

## Flashing the Firmware

### Option A: Arduino IDE
1. Install the **ESP8266 Board Package** via Boards Manager (`http://arduino.esp8266.com/stable/package_esp8266com_index.json`).
2. Select Board: **NodeMCU 1.0 (ESP-12E Module)**.
3. Install library from Library Manager:
   - `WebSockets` by Markus Sattler
4. Open `SpineAlign_NodeMCU.ino` and click **Upload**.

### Option B: PlatformIO
```sh
cd firmware/SpineAlign_NodeMCU
pio run --target upload
```

---

## Connecting to the Web Dashboard

1. Power on the NodeMCU.
2. Open the SpineAlign Dashboard (`index.html`) or visit `http://192.168.4.1` / `http://spinealign.local`.
3. Under **Device Connection**, choose **Wi-Fi (NodeMCU)**:
   - AP mode: `192.168.4.1`, port `81`.
   - Router Wi-Fi: `spinealign.local` (or assigned IP), port `81`.
4. Click **Connect over Wi-Fi**.
