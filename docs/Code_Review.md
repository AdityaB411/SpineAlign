# SpineAlign Lite — code review and fix log

## Repository parts

- Simulation: root `SpineAlign.ino`, `diagram.json`, and `wokwi.toml`. This remains the Wokwi ESP32 DevKit build and was not modified by the physical-firmware port.
- Dashboard: `index.html`, `styles.css`, `app.js`, `orientation3d.js`.
- Protocol/transport: `ble-serial-bridge.js` adapts Web Bluetooth; `telemetry-protocol.js` validates the shared data format.
- Physical device: `firmware/SpineAlign_ESP32CAM/` contains the separate firmware, configuration template, PlatformIO build and OTA partition layout.
- Tests: `tests/` contains parser scenario and repository wiring tests.

## Fixes implemented

1. Fixed Web Serial byte decoding before line buffering.
2. Integrated the BLE bridge ahead of the dashboard and retained `?transport=usb`.
3. Added one strict parser shared by the UI and Node tests.
4. Added tests for full/minimal telemetry, malformed numbers, duplicates, invalid flags, sensor modes, battery sentinel values and invalid ranges.
5. Created a separate physical sketch without changing the Wokwi sketch.
6. Fixed battery averaging to divide by the actual four readings and use 860 SPS conversion rate to reduce blocking.
7. Added selectable one-IMU (default, `MODE:1`) and dual-IMU (`MODE:2`) physical modes. The UI hides the unmeasured neck panel in one-IMU mode.
8. Moved battery/charger measurements to ADS1115 A0/A1 to avoid the ADC2/Wi-Fi conflict and the previous GPIO overlap.
9. Added the PlatformIO build so the custom OTA partition table is selected, plus placeholder-credential guards and an OTA password requirement.
10. Paged BLE notifications at a more conservative interval and included the telemetry parser in GitHub Pages deployment.

## Automated status and physical limitations

Local parser scenarios passed 10/10. JavaScript syntax and repository consistency checks passed on the current files. GitHub Actions were deliberately not run; the workflow now contains the scenario tests and physical PlatformIO build for a future normal validation run.

Physical testing is still required for sensor direction, battery voltage calibration, CHRG behavior, power integrity, GPIO2/GPIO15 boot behavior, BLE/Wi-Fi coexistence and OTA recovery. The ADS1115 battery percentage is voltage-derived and TP4056 CHRG cannot distinguish charger unplugged from charge complete. Keep the wired update path available.

SpineAlign is a student prototype, not a medical diagnostic device.
