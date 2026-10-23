# SpineAlign Lite — Code Review and Fix Log

## Automated checks

- GitHub Actions compiles the Wokwi/ESP32 DevKit profile and the physical AI-Thinker ESP32-CAM profile.
- JavaScript syntax checks run for `app.js` and the ES module `orientation3d.js`.
- These builds do not replace physical sensor, battery, charging, boot, or haptic-output validation.

## Issues fixed in this revision

1. **Battery pin mismatch:** firmware and documentation agree on GPIO13 for the battery divider (ADC2, Wi-Fi disabled) and GPIO33 for TP4056 CHRG on the selected ESP32-CAM profile.
2. **Sensor failure visibility:** serial telemetry now includes `NS` and `BS` flags. The dashboard reports sensor faults instead of treating retained previous angles as healthy current data.
3. **Stale serial stream:** the dashboard marks live data as stale after 2.5 seconds without valid telemetry and updates connection/status UI.
4. **3D preview-to-live handoff:** entering live mode clears the manual preview lock, allowing real orientation readings to drive the torso and head.
5. **Calibration feedback:** the dashboard handles firmware `CALIBRATED` and `CALIBRATION FAILED` messages and indicates when calibration is needed.
6. **Firmware I²C write errors:** MPU initialization stops if register writes fail and rechecks sensor identity after configuration.
7. **Battery/charger wording:** the UI describes `FULL` as a near-full-voltage estimate, not confirmed charge completion; missing charger-state fields are not presented as definitive “not charging.”
8. **Workflow permissions:** Pages workflow no longer tries to enable or create a Pages site using the workflow token. Enable Pages once in repository Settings → Pages → GitHub Actions.
9. **CI coverage:** the build workflow compiles both board profiles.
10. **Circuit protection:** the Wokwi diagram includes a 220 Ω resistor in series with the status LED.
11. **Asset stability and styling:** external model asset is pinned to a source commit, and 3D point colors match the muted dashboard palette.
12. **Documentation:** removed duplicate README sections and corrected battery/charger pin information.

## Remaining physical verification

- Confirm the exact ESP32-CAM board revision, boot-strapping behavior for GPIO2/GPIO15, GPIO33 pad access, and isolation from any onboard indicator LED.
- Confirm IMU register compatibility, axis directions, and mounting orientation.
- Measure the divider against a multimeter and calibrate battery percentage for the actual cell/load.
- Confirm TP4056 CHRG wiring and pull-up implementation.
- Verify the transistor/MOSFET driver and protection for the haptic motor.
- Browser-test serial connect/disconnect/calibration on desktop Chromium and confirm GitHub Pages after enabling it.
- The Android app/Bluetooth link and full physical wearable integration remain out of scope for this repository.
