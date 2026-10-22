# SpineAlign Lite — Literature Survey and Gap Analysis

## Introduction

This survey compares ten prior posture-monitoring systems and maps recurring limitations to SpineAlign Lite's design choices. Systems include peer-reviewed studies and open-source projects. The implementation does not reproduce or validate every claim from those external projects; references are provided for follow-up.

## Reviewed systems

1. **2026 — IoT-based posture monitoring (ESP32/Raspberry Pi).** Single MPU6050 and complementary filtering; limitation noted in the source survey: one sensing point and no explicit gyro-bias correction.  
   Source: https://link.springer.com/article/10.1007/s41872-026-00453-7
2. **2025 — IoT-Based Posture Detection and Feedback System.** Single MPU6050, buzzer/mobile notifications and Blynk cloud connectivity; internet/cloud dependency is a potential weakness.  
   Source: https://www.researchgate.net/publication/388067138_IoT-Based_Posture_Detection_and_Feedback_System_A_Wearable_Solution_for_Maintaining_Proper_Posture
3. **2025 — Posture Correction Device Using ESP32 and MPU6050.** Single MPU6050, buzzer and OLED, with no Bluetooth link.  
   Source: https://www.researchgate.net/publication/397170639_Posture_Correction_Device_Using_ESP32_and_MPU6050
4. **Open-source — ESP32-C3 posture-monitor firmware.** One MPU6050 and vibration/buzzer feedback; its project notes false alarms, gyro drift and actuator-feedback concerns.  
   Source: https://github.com/Hdchipeo/posture-monitor
5. **2026 — Dual-IMU posture-correction vest.** Two MPU6050s and buzzer feedback; the reviewed survey notes cloud logging in the companion device.  
   Source: https://www.sciencedirect.com/science/article/pii/S2352146526002140
6. **2026 — SpineSense.** MPU6050 plus flex sensor, BLE, haptic feedback and app trend analysis; the survey notes filter limitations and possible flex-sensor wear/drift.  
   Source: https://www.iistj.org/article.php?paperid=120336
7. **2025 — Cervical spine posture monitoring (flex + IMU + LSTM).** Flex sensors and MPU6050, with classification running on a PC via Bluetooth; not self-contained.  
   Source: https://www.techrxiv.org/doi/full/10.36227/techrxiv.174140797.74178003/v1
8. **2024 — Real-Time Forward Head Posture Detection.** Single MPU6050 and time-averaged measurements rather than a dedicated fusion filter.  
   Source: https://www.mdpi.com/2076-3417/14/19/9075
9. **2020 — Spine Cop.** Accelerometer, gyroscope, magnetometer and magnets; the source survey highlights calibration dependence and lower performance for accelerometer-only estimates.  
   Source: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7570645/
10. **Open-source — IEEE-VIT Smart Posture Monitoring System.** Flex sensor at the neck and MPU6050 at the back; the survey identifies mixed sensing modalities as a possible source of mechanical wear.  
    Source: https://github.com/IEEE-VIT/posture-correct

## Nine identified gaps and the corresponding design decisions

| # | Gap | SpineAlign Lite design response |
|---:|---|---|
| 1 | Single-point sensing cannot distinguish neck slouch from back curvature. | Two MPU6050 sensors, at I²C addresses 0x68 and 0x69, provide separate neck/back angles. |
| 2 | Simple filters may smooth noise without explicitly estimating gyro bias. | Independent two-state Kalman filters for angle and gyro bias. |
| 3 | Transient movement can trigger nuisance alerts. | Sustained 3-second hold before the first alert; it is canceled if deviation falls below the 15° trigger threshold. |
| 4 | A single threshold can make alert state flicker. | 15° trigger and 12° recovery thresholds (hysteresis) after the first alert. |
| 5 | Undefined calibration can cause misleading thresholds. | An explicit calibration gate blocks posture alerts until calibration succeeds. |
| 6 | Cloud dependency can make core behavior internet-dependent. | Intended physical architecture uses direct Bluetooth; posture decisions and feedback remain local. The Wokwi firmware does not implement Bluetooth. |
| 7 | Off-device classification can require a PC/server. | Core sensing and alert logic runs on the ESP32 in the simulation. |
| 8 | Audible buzzer feedback may be undesirable in shared settings. | Intended hardware uses a haptic motor; Wokwi demonstrates the alert pattern with an LED. |
| 9 | Mixing flex sensors and IMUs can complicate mechanical behavior. | Both measurement points use the same MPU6050 modality. |

## Summary

The design emphasizes dual-point sensing, angle/gyro-bias filtering, a calibration gate, sustained-deviation logic, hysteresis, and local feedback. These are engineering design choices, not evidence of clinical accuracy. Real-device measurements, threshold tuning, battery/haptic integration, Bluetooth integration, and app-side trend history remain future validation and implementation tasks.