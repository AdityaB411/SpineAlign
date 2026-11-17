#ifndef SPINEALIGN_NODEMCU_CONFIG_H
#define SPINEALIGN_NODEMCU_CONFIG_H

// Copy this file to config.h and customize for your setup.
// config.h is ignored by git to protect credentials.

#define SPINEALIGN_WIFI_SSID "REPLACE_ME_SSID"
#define SPINEALIGN_WIFI_PASSWORD "REPLACE_ME_PASSWORD"

// Unique password for ArduinoOTA updates (12+ characters recommended)
#define SPINEALIGN_OTA_PASSWORD "REPLACE_ME_12_CHAR_OTA_PASSWORD"

// 0 = Single IMU mounted on back (0x68, MODE:1)
// 1 = Dual IMU: Neck on 0x68, Back on 0x69 (MODE:2)
#define SPINEALIGN_DUAL_IMU 0

#endif // SPINEALIGN_NODEMCU_CONFIG_H
