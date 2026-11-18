#ifndef SPINEALIGN_NODEMCU_CONFIG_H
#define SPINEALIGN_NODEMCU_CONFIG_H

// Copy this file to config.h and customize for your setup.
// config.h is ignored by git to protect credentials.

#define SPINEALIGN_WIFI_SSID "REPLACE_ME_SSID"
#define SPINEALIGN_WIFI_PASSWORD "REPLACE_ME_PASSWORD"

// IMU Mode:
// -1 = Auto-detect (Dual IMU if 0x68 + 0x69 respond, else Single IMU on 0x68)
//  0 = Force Single IMU mounted on back (0x68, MODE:1)
//  1 = Force Dual IMU: Neck on 0x68, Back on 0x69 (MODE:2)
#define SPINEALIGN_DUAL_IMU -1

// Optional mounting axis overrides (only change if rotated 90 deg or mirrored):
#define SPINEALIGN_SWAP_PITCH_ROLL 0
#define SPINEALIGN_PITCH_SIGN 1
#define SPINEALIGN_ROLL_SIGN 1

#endif // SPINEALIGN_NODEMCU_CONFIG_H
