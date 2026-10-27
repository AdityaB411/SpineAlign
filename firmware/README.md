# Physical ESP32-CAM firmware

This folder is for the AI-Thinker ESP32-CAM build only. The root `SpineAlign.ino` remains the Wokwi simulation.

## Build

```sh
python -m pip install --upgrade platformio
pio run -d firmware/SpineAlign_ESP32CAM
```

The project explicitly selects `partitions.csv` for OTA updates and expects 4 MB flash. Copy `config.example.h` to `config.h` and enter the local Wi-Fi SSID/password plus a unique OTA password of at least 12 characters. Do not commit `config.h`.

Required I²C components: two IMUs at 0x68/0x69, optional SSD1306 at 0x3C, ADS1115 at 0x48. The battery divider connects to ADS1115 A0 and TP4056 CHRG to A1 with a 10k pull-up to 3V3. GPIO14/15 are I²C, so microSD cannot be used simultaneously. Review `docs/Hardware_Orientation_Battery.md` before wiring.
