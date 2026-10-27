# SpineAlign Lite — code review and fix log

## Layout

- Root `SpineAlign.ino`, `diagram.json`, `wokwi.toml`: unchanged Wokwi / ESP32 DevKit simulation.
- Dashboard: `index.html`, `styles.css`, `app.js`, `orientation3d.js`.
- Transport/protocol: `ble-serial-bridge.js` and `telemetry-protocol.js`.
- Physical sketch: `firmware/SpineAlign_ESP32CAM/`, with BLE, Wi-Fi OTA, ADS1115 and custom OTA partitions.
- Automated scenarios: `tests/`; run with `npm test`.

## Important fixes

1. Corrected native Web Serial byte decoding before line parsing.
2. Integrated the BLE bridge before the dashboard and retained `?transport=usb`.
3. Added a dedicated physical ESP32-CAM sketch without rewriting the root simulation.
4. Moved physical battery and charging measurement to ADS1115 A0/A1 to avoid ADC2/Wi-Fi incompatibility and eliminate the contradictory GPIO assignment.
5. Added PlatformIO build configuration to actually select the custom OTA partition CSV.
6. Added placeholder credential checks and a unique 12+ character OTA password requirement.
7. Enabled BLE bonding and encrypted characteristic access.
8. Added one strict telemetry parser shared by the dashboard and unit tests.
9. Added tests for malformed inputs, duplicate fields, optional/older telemetry, invalid flags, unavailable battery data, OTA partition bounds and repository wiring.
10. Updated CI to validate JavaScript, run tests and compile the physical sketch, and updated Pages deployment to publish the protocol module.

## Physical acceptance still required

Node tests validate telemetry parsing and repository assumptions. They do not establish physical sensor alignment, power integrity, battery calibration, charger behavior, radio coexistence, boot strap behavior or OTA recovery. Keep FTDI available until OTA succeeds on the actual board. The current physical firmware expects two IMUs at 0x68 and 0x69; a one-sensor design needs a deliberate firmware/dashboard mode.

SpineAlign is a student prototype, not a medical diagnostic device.
