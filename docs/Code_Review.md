# SpineAlign Lite — Code Review Notes

## Changes applied before the initial project commit

1. **Sustained-deviation timer:** the first alert requires the maximum absolute neck/back deviation to remain at or above 15° for the full 3-second hold. A dip below 15° before the first alert cancels the hold, matching the stated state-machine behavior.
2. **Sensor-read failure handling:** posture decisions pause if either MPU6050 read fails. The posture state and reminder timer are cleared, and the LED turns off, so stale angles do not continue driving alerts.
3. **Recovery behavior:** after the first alert, the 12° recovery threshold is used. Any unfinished LED pattern is canceled as soon as posture recovers.
4. **Wokwi local configuration:** added `wokwi.toml` and documented an Arduino CLI build path. A GitHub Actions workflow compiles the sketch on pushes and pull requests.
5. **Documentation consistency:** the literature survey and presentation content now consistently say ten prior systems were reviewed; nine design gaps remain identified.

## Remaining verification

- Confirm the GitHub Actions firmware-build workflow passes on the target ESP32 Arduino core version.
- Run the Wokwi simulation after importing the repository, including calibration, short posture excursions, sustained deviation, recovery, and sensor-read failure.
- Validate sensor axis orientation and thresholds on physical hardware before relying on real-world angle values.
- The Android app/Bluetooth link, physical haptic driver, battery/charging hardware, and physical-device validation remain outside the implementation scope of this simulation repository.