# SpineAlign Lite — Presentation Outline

This document preserves the slide sequence and key talking points from the supplied 19-slide presentation.

1. **Title:** SpineAlign Lite — Wearable Posture Corrector and Ergonomic Analytics Dashboard.
2. **Problem and motivation:** poor sitting/standing posture and the goal of closing recurring limitations in prior monitoring designs.
3. **Literature survey:** ten systems reviewed, mixing papers and open-source hardware projects; compared by sensing, feedback, connectivity and limitations.
4. **Nine gaps in five categories:** sensing/data fusion; posture logic/calibration; communication/architecture; feedback/interface; hardware/sensing modality.
5. **Sensing and data fusion:** the Wokwi simulation uses two MPU6050 IMUs at 0x68/0x69 with independent filters. The physical wearable defaults to one back-mounted IMU; dual physical mode is selectable.
6. **Sensor-fusion pipeline:** raw accelerometer/gyroscope data → accelerometer angle → Kalman filter → per-sensor angle → calibrated baseline comparison.
7. **Posture logic and calibration:** 3-second sustained-deviation hold, 15° trigger, 12° recovery, and a calibration gate.
8. **Alert state machine:** boot → wait for calibration → monitor → sustained bad posture → first alert.
9. **Communication and architecture:** planned Bluetooth Classic SPP companion-app link; local decisions are intended to work without a cloud connection.
10. **System data flow:** sensors → ESP32 filtering/threshold logic → local haptic output; phone functions are optional.
11. **Feedback and interface:** silent haptic motor is planned for hardware; Wokwi uses an LED and provides OLED angles/status.
12. **Why Wokwi:** repeatable browser demonstration of sensing, calibration and alert logic without physical hardware.
13. **Hardware plan versus simulation:** explain differences between the planned wearable and the simulation.
14. **Hardware integration:** AI-Thinker ESP32-CAM, one back-mounted IMU by default (optional second IMU), TP4056, protected LiPo battery, ADS1115 and a properly driven haptic output.
15. **How the demo maps to hardware:** the Wokwi simulation validates posture logic over USB serial. The separate physical sketch adds BLE, Wi-Fi OTA and ADS1115 battery/charging telemetry; physical RF, power and alert behavior still require testing.
16. **Live demo:** sensor check, calibration, sensor tilting, sustained hold, LED alert and OLED status.
17. **Gap-to-solution summary:** recap the nine design responses.
18. **Conclusion and future work:** assemble hardware, complete Bluetooth/app communication, and add posture-history analytics.
19. **Thank you:** questions.

**Important scope note:** the current GitHub project contains the Wokwi firmware and its documentation. It does not yet include a working Android app or Bluetooth implementation.