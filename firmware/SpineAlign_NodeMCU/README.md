# SpineAlign NodeMCU ESP8266 Firmware

Wi-Fi and WebSocket posture monitoring firmware for NodeMCU (ESP8266 ESP-12E / ESP-12F).

---

## Features

- **Wi-Fi Connectivity**:
  - Connects to your local 2.4 GHz Wi-Fi router (Station mode).
  - Automatic fallback to Standalone Access Point (`SpineAlign-NodeMCU` at `192.168.4.1`) if Wi-Fi is unconfigured or unavailable.
  - mDNS hostname: `http://spinealign.local`.
- **Real-Time WebSockets**:
  - WebSocket Server on port `81` broadcasts telemetry frames at 5 Hz (200 ms).
  - Full bidirectional support: accepts `CALIBRATE` command from the dashboard.
- **Embedded Web Server**:
  - Built-in HTTP server on port `80` serving an instant lightweight dashboard at `http://192.168.4.1` or `http://spinealign.local`.
  - Also integrates with the primary SpineAlign desktop dashboard over WebSocket (`ws://<ip>:81`).
- **Concurrent USB Serial**:
  - Standard 115200 baud serial telemetry stream is preserved simultaneously with Wi-Fi.
- **Single or Dual IMU**:
  - Default: **Single MPU6050 mounted on the back (address `0x68`)** (`MODE:1`).
  - Optional: Set `SPINEALIGN_DUAL_IMU 1` in `config.h` for neck (`0x68`) + back (`0x69`) (`MODE:2`).
- **OTA Updates**:
  - ArduinoOTA enabled when configured with a password.

---

## Pinout & Wiring

| NodeMCU Pin | GPIO | Function | Connect To |
|-------------|------|----------|------------|
| **D2** | GPIO4 | I2C SDA | MPU6050 SDA (and optional OLED SDA) |
| **D1** | GPIO5 | I2C SCL | MPU6050 SCL (and optional OLED SCL) |
| **D5** | GPIO14 | Posture Alert | Active Buzzer (+) or Alert LED |
| **D3** | GPIO0 | Calibration Button | Optional push-button to GND (uses internal pull-up) |
| **A0** | ADC0 | Battery Sense | Voltage divider from 1S Li-ion battery (optional) |
| **3V3** | 3.3V | Power | MPU6050 VCC, OLED VCC |
| **GND** | GND | Ground | MPU6050 GND, OLED GND, Buzzer (-) |

> [!NOTE]
> For single IMU mode (default), leave the MPU6050 **AD0** pin disconnected or tied to GND (address `0x68`). For dual IMU mode, the second MPU6050 **AD0** pin must be tied to VCC (address `0x69`).

---

## Configuration

1. Copy `config.example.h` to `config.h`:
   ```sh
   cp config.example.h config.h
   ```
2. Open `config.h` and specify your Wi-Fi credentials:
   ```c
   #define SPINEALIGN_WIFI_SSID "Your_WiFi_SSID"
   #define SPINEALIGN_WIFI_PASSWORD "Your_WiFi_Password"
   #define SPINEALIGN_OTA_PASSWORD "your_unique_ota_password"
   #define SPINEALIGN_DUAL_IMU 0
   ```
3. If Wi-Fi credentials are left as placeholders, the NodeMCU will automatically broadcast its own access point named **`SpineAlign-NodeMCU`** with IP `192.168.4.1`.

---

## Flashing the Firmware

### Option A: Using Arduino IDE
1. Install the **ESP8266 Board Package** via Boards Manager (`http://arduino.esp8266.com/stable/package_esp8266com_index.json`).
2. Select Board: **NodeMCU 1.0 (ESP-12E Module)**.
3. Install required libraries from Library Manager:
   - `WebSockets` by Markus Sattler
   - `Adafruit SSD1306`
   - `Adafruit GFX Library`
4. Open `SpineAlign_NodeMCU.ino` and click **Upload**.

### Option B: Using PlatformIO
```sh
cd firmware/SpineAlign_NodeMCU
pio run --target upload
```

---

## Connecting to the Web Dashboard

1. Power on the NodeMCU.
2. In your browser, open the SpineAlign Dashboard (e.g. `http://localhost:8000`).
3. Under **Device Connection**, choose **Wi-Fi (NodeMCU)**:
   - If connected to the NodeMCU Access Point: enter `192.168.4.1`.
   - If connected to your home Wi-Fi: enter `spinealign.local` (or the NodeMCU's assigned IP).
   - Port: `81`.
4. Click **Connect over Wi-Fi**. Live posture telemetry and 3D orientation will stream instantly!
