# Physical ESP32-CAM firmware

This folder contains the physical firmware only. The root `SpineAlign.ino` remains the Wokwi simulation.

Build with `pio run -d firmware/SpineAlign_ESP32CAM`. `platformio.ini` selects the local OTA partition CSV. The layout is for 4 MB flash; check the exact module before flashing.

Copy `config.example.h` to `config.h`, then set Wi-Fi credentials and a unique 12+ character OTA password. Default physical mode uses one MPU6050 at 0x68 mounted on the back. Set `SPINEALIGN_DUAL_IMU 1` to enable neck 0x68 and back 0x69 sensors.

Battery measurement requires ADS1115 at 0x48: A0 takes a 100k/100k battery divider and A1 reads TP4056 CHRG through a 10k pull-up to 3V3. Review `docs/Hardware_Orientation_Battery.md` before wiring.
