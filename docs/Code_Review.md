# SpineAlign Lite — code review and fix log

## Layout

- Root SpineAlign.ino, diagram.json and wokwi.toml: unchanged Wokwi simulation.
- Dashboard files: index.html, styles.css, app.js, orientation3d.js and ble-serial-bridge.js.
- Physical sketch: firmware/SpineAlign_ESP32CAM/ with BLE, Wi-Fi OTA, ADS1115 battery and charging telemetry.

## Important fixes

1. Corrected native Web Serial byte decoding before line parsing.
2. Integrated the BLE bridge ahead of app.js and retained ?transport=usb for the simulation.
3. Added a separate physical firmware sketch without rewriting the simulation source.
4. Moved battery/charger sensing to ADS1115 A0/A1 to avoid ADC2/Wi-Fi incompatibility.
5. Added 4 MB OTA partition table with two OTA app slots.
6. Prevented placeholder credentials from enabling Wi-Fi/OTA; required a unique 12+ character OTA password.
7. Enabled BLE bonding and encrypted characteristic access.
8. Updated deployment to include the bridge and CI to compile the physical sketch with ADS1115.
9. Removed contradictory battery wiring directions and documented GPIO boot/power risks.

## Physical verification still required

CI cannot validate sensor axes, power integrity, battery calibration, charging signals, RF coexistence, boot straps or OTA recovery. The physical sketch expects two IMUs at 0x68 and 0x69; if the intended wearable uses one sensor, an explicit single-sensor mode is required rather than accepting a missing sensor. Retain FTDI recovery until OTA succeeds physically.

SpineAlign is a student prototype, not a medical diagnostic device.
