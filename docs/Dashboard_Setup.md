# Dashboard and device setup

## Run locally

    python3 -m http.server 8000

Open http://localhost:8000. Demo mode works without hardware. ble-serial-bridge.js loads before app.js. BLE is the default live path; add ?transport=usb to use native Web Serial. Web Bluetooth needs HTTPS/localhost and a compatible browser; Web Serial needs desktop Chromium.

## Telemetry and calibration

Fields are N, B, NP, NR, BP, BR, ALERT, CAL, NS, BS, BAT, PCT, CHG and FULL. The app decodes native byte chunks correctly, reassembles partial lines, detects stale telemetry, and checks sensor-validity flags. Calibration writes CALIBRATE plus newline over USB or BLE.

## Physical hardware

Use firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino. It expects two IMUs at 0x68 and 0x69, optional OLED at 0x3C and ADS1115 at 0x48. GPIO14/15 are shared I²C; leave microSD unused. GPIO2 is boot-sensitive and must only drive a transistor/MOSFET input after cold-boot testing.

Battery voltage goes to ADS1115 A0 through a 100k/100k divider. TP4056 CHRG goes to ADS1115 A1 with 10k pull-up to 3V3. Do not connect CHRG to GPIO13. ADS1115 avoids the ESP32 ADC2/Wi-Fi conflict.

## Wi-Fi OTA

Copy config.example.h to config.h and set non-placeholder 2.4 GHz credentials and a unique OTA password of at least 12 characters. The custom partitions.csv defines two OTA slots for a 4 MB flash board. Upload once over FTDI, then use the network port when the computer and ESP32 are on the same LAN. Keep FTDI recovery access.

See docs/Hardware_Orientation_Battery.md for detailed wiring and validation.
