# SpineAlign Lite — Full Project Overview

## Project objective

SpineAlign Lite is a student wearable posture-monitoring prototype. It compares sensor-derived tilt against an upright calibration reference, waits for sustained deviation before triggering an alert, and presents current readings and recent history in a browser dashboard. It is not a medical diagnostic device.

## Three distinct repository parts

### 1. Wokwi simulation

The root `SpineAlign.ino`, `diagram.json` and `wokwi.toml` represent an ESP32 DevKit simulation. It retains the two-IMU neck/back model, OLED, calibration button, resistor-protected status LED, and USB serial telemetry. This is the logic-validation/simulation path; its wiring is not the physical ESP32-CAM wiring.

### 2. Dashboard

The browser dashboard provides demo readings, angle history, battery-status presentation and the 3D orientation view. The shared `telemetry-protocol.js` validates complete telemetry lines. `ble-serial-bridge.js` adapts BLE notifications into the same line stream; `?transport=usb` preserves the wired/Wokwi development path.

### 3. Physical AI-Thinker ESP32-CAM

The separate sketch in `firmware/SpineAlign_ESP32CAM/` carries the posture logic plus BLE GATT telemetry, calibration commands, Wi-Fi ArduinoOTA updates and ADS1115-based battery/charger monitoring.

The default wearable profile uses **one MPU6050 at I²C address 0x68 mounted on the back**. Telemetry uses `MODE:1`; the dashboard hides neck measurements because a single sensor cannot measure neck motion independently. To build the two-IMU variant, set `SPINEALIGN_DUAL_IMU 1` in a private `config.h`; then use a second IMU at address 0x69 and `MODE:2` telemetry.

## Main components

- AI-Thinker ESP32-CAM with 4 MB flash (verify exact board revision).
- One MPU6050 by default; optional second MPU6050 for dual mode.
- Optional SSD1306 OLED at I²C address 0x3C.
- ADS1115 external ADC at 0x48 for battery voltage and charge-status signals.
- TP4056 charging module and protected single-cell Li-ion/LiPo battery.
- Suitable regulator/power path and transistor/MOSFET alert driver.
- Web Bluetooth dashboard and Wi-Fi OTA for later firmware updates.

## Power and charging measurement

Battery positive is read through a 100k/100k divider into ADS1115 A0. TP4056 CHRG is read separately on ADS1115 A1 with a 10k pull-up to 3V3. The readings share ground. ADS1115 sampling avoids relying on ESP32 ADC2 when Wi-Fi OTA is active.

The displayed percentage is estimated from battery voltage, not a fuel gauge. TP4056 CHRG by itself cannot distinguish charger unplugged from charge complete. The TP4056 is a charger, not a boost converter or load-sharing regulator. Use a suitable regulated power path and protected cell.

## Test status

The software test suite covers telemetry parsing and repository integration assumptions. Physical testing is required to validate sensor axis signs, calibration, battery accuracy, charger signal, boot-strapping behavior, BLE/Wi-Fi coexistence and OTA recovery. The initial flash must be wired through FTDI; keep wired recovery available until OTA has passed.
