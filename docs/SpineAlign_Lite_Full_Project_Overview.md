# SpineAlign Lite — Full Project Overview

## Concept

SpineAlign Lite is a wearable posture-monitoring prototype designed to track posture at two body locations: the neck and mid/lower back. It compares measured angles against an individual upright baseline, waits for sustained deviation before the first alert, and provides discreet feedback. The intended physical device connects to an Android companion app over Bluetooth Classic SPP for calibration controls, profiles, and posture history.

## Planned physical build

- ESP32-CAM module (camera unused; controller and intended Bluetooth link)
- Two MPU6050 IMUs: neck at I²C address 0x68 and back at 0x69
- TP4056 charging module
- 3.7 V Li-ion/LiPo battery
- Haptic vibration motor
- Android companion app, intended to receive state and provide calibration/profile/history UI

The firmware and real-device electrical design are prototypes and must be validated before hardware use.

## Sensing and filtering

Each MPU6050 supplies accelerometer and gyroscope data over I²C. The firmware calculates an accelerometer angle and fuses it with gyroscope rate through a two-state Kalman filter that estimates angle and gyro bias. The neck and back signals use independent filters. Both angles are measured relative to a session calibration baseline.

## Posture and alert logic

- Calibration sets the current neck/back angle as the upright reference.
- A maximum absolute deviation of 15° starts the first-alert hold timer.
- The deviation must remain at or above 15° continuously for 3 seconds to trigger the initial double LED pulse.
- After the first alert, posture recovers only when both deviations are below 12°.
- If poor posture continues, a single-pulse reminder repeats every 45 seconds.
- If either sensor read fails, posture decisions pause and the current LED alert is canceled.

## Wokwi simulation build

The simulation uses an ESP32 DevKit-C V4, two MPU6050 sensors, an SSD1306 OLED, one red LED, and a calibration button. The OLED is included to make the demo self-explanatory. The LED replaces the planned physical haptic motor, and the button/serial command replaces app-issued calibration.

The local firmware intentionally does not demonstrate Bluetooth, the Android app, battery charging, or a real vibration motor. Those are future hardware/app integration tasks; they should not be described as already implemented in this simulation.

## Demo flow

1. Start the simulation and verify both sensors initialize.
2. Place both simulated sensors in the reference position.
3. Press the calibration button or type `CALIBRATE` in the serial monitor.
4. Tilt either sensor enough to exceed 15° and hold it for 3 seconds.
5. Observe the LED alert and OLED `ALERT` state.
6. Bring both readings below 12° to clear the alert state.
7. Observe live neck/back angle telemetry in the serial monitor.

## Scope and limitations

SpineAlign Lite is a course-project prototype, not a medical diagnostic device. Thresholds and sensor axes need physical validation; the simulation is not proof of real-world ergonomic accuracy or clinical efficacy. Calibration is session-based and is not saved across reboots.