#pragma once

// Set to 1 for dual-sensor setup (Neck MPU6050 at 0x68 + Back MPU6050 at 0x69)
// Set to 0 for single-sensor setup (Back MPU6050 at 0x68)
#define SPINEALIGN_DUAL_IMU 0

// Optional battery voltage monitoring (0 to disable)
#define BATTERY_MONITOR_ENABLED 0
#define BATTERY_ADC_PIN 34
