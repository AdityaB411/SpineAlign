# Dashboard and device setup

## Run locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Demo mode works without hardware. The script order is `ble-serial-bridge.js`, `telemetry-protocol.js`, then `app.js`. BLE is the default live transport; use `?transport=usb` for native USB/Web Serial with Wokwi or a wired board.

Web Bluetooth needs HTTPS or localhost, browser permission and a compatible Chrome/Edge browser. Native Web Serial is primarily supported in desktop Chromium.

## Telemetry contract

The shared parser validates `N`, `B`, `NP`, `NR`, `BP`, `BR`, `MODE`, `ALERT`, `CAL`, `NS`, `BS`, `BAT`, `PCT`, `CHG`, and `FULL`. It rejects malformed numbers, duplicate/unknown fields, invalid flags and oversized lines. The UI updates only after a complete valid telemetry line, tracks stale input and uses sensor-validity flags.

- `MODE:1`: one back-mounted IMU. The dashboard hides the unmeasured neck panels.
- `MODE:2`: two IMUs; neck and back panels appear separately.
- `BAT/PCT/CHG/FULL=-1`: battery or charging reading unavailable.
- Calibration sends `CALIBRATE\n` over USB or writes the same command to the BLE characteristic.

## Physical ESP32-CAM

Use `firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino`, not the root simulation sketch.

The physical build defaults to one MPU6050 on I²C address `0x68), mounted on the back. Copy `config.example.h` to `config.h` and set credentials. For the dual-IMU variant, change `SPINEALIGN_DUAL_IMU 0` to `SPINEALIGN_DUAL_IMU 1`; the second IMU is then required at `0x69`.

The physical design also expects:
- Optional SSD1306 OLED at `0x3C`.
- ADS1115 at `0x48`, powered at 3V3.
- Battery positive through a 100k/100k divider to ADS1115 A0.
- TP4056 CHRG to ADS1115 A1, with a 10k pull-up to 3V3.

GPIO14/15 are shared I²C and microSD must remain unused. Do not connect TP4056 CHRG to GPIO13. GPIO2 is boot-sensitive; it must only drive a suitable transistor/MOSFET input after cold-boot testing.

## Wi-Fi OTA

The custom `partitions.csv` and `platformio.ini` are set up for OTA with two application slots on a 4 MB flash module. Verify the actual flash size. Upload the first build through FTDI, then use the network OTA port on the same LAN. OTA is disabled when configuration values are blank or placeholders. Keep FTDI recovery until physical OTA has passed.

Run software scenarios with `npm test`, syntax checks with `npm run check`, and the physical build with `pio run -d firmware/SpineAlign_ESP32CAM`. These do not replace physical sensor, charger, power and OTA testing.
