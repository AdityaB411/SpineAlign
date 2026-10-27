# SpineAlign Lite

SpineAlign Lite is a dual-IMU posture-monitoring prototype. It reads neck and back IMUs, filters pitch/roll, compares deviations with a calibration reference, and provides local posture alerts. It is split into the Wokwi simulation, browser dashboard, and physical ESP32-CAM firmware.

## Wokwi simulation

The repository-root SpineAlign.ino, diagram.json, wokwi.toml and libraries.txt remain the simulation project. The root sketch is unchanged; default hardware is ESP32 DevKit with SDA 21, SCL 23, calibration button GPIO14 and alert LED GPIO25.

## Web dashboard

Run from the repository root with: python3 -m http.server 8000. Open http://localhost:8000. Demo mode works without hardware. The dashboard defaults to BLE for the physical firmware and uses Web Serial with ?transport=usb. Web Bluetooth needs HTTPS or localhost and compatible Chrome/Edge desktop or Android; Web Serial needs desktop Chromium.

ble-serial-bridge.js loads before app.js, adapts GATT notifications to the same newline-delimited parser, and preserves the USB simulation path.

## Physical AI-Thinker ESP32-CAM firmware

Open firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino. Do not replace the root simulation sketch. This separate firmware reuses the posture logic and adds BLE notifications, BLE CALIBRATE writes, Wi-Fi ArduinoOTA and ADS1115 battery/charger sensing. Install Adafruit GFX Library, Adafruit SSD1306 and Adafruit ADS1X15.

Copy firmware/SpineAlign_ESP32CAM/config.example.h to config.h and set a 2.4 GHz Wi-Fi SSID/password plus a unique OTA password of at least 12 characters. config.h is ignored by Git; example credentials intentionally disable Wi-Fi/OTA. The custom partitions.csv targets 4 MB flash with two OTA slots; confirm actual board flash size. First flash is wired via FTDI/USB-UART.

## Hardware notes

Physical firmware expects two IMUs at addresses 0x68 and 0x69 (AD0 low on neck, high on back), optional SSD1306 OLED, and ADS1115 at 0x48. I²C uses GPIO14/15, so microSD must remain unused. GPIO2 is boot-sensitive and should drive a properly designed transistor/MOSFET circuit only; never drive a motor directly from a GPIO.

Battery voltage goes through a 100k/100k divider to ADS1115 A0. TP4056 CHRG goes to ADS1115 A1 with a 10k pull-up to 3V3. Use common ground, a protected cell and suitable regulator/power path. TP4056 is a charger, not a boost converter/load-sharing regulator. Percentage and FULL are voltage/state estimates, not proof of charge completion.

## Telemetry and validation

Telemetry fields are N, B, NP, NR, BP, BR, ALERT, CAL, NS, BS, BAT, PCT, CHG and FULL. GitHub Actions syntax-checks the dashboard/bridge and compiles the unchanged Wokwi sketch plus dedicated ESP32-CAM sketch. These checks do not replace physical testing of sensors, battery readings, charging, boot stability, BLE/Wi-Fi coexistence and OTA recovery. Retain FTDI recovery until OTA is verified. SpineAlign is a student prototype, not a medical diagnostic device.
