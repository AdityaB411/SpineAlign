# SpineAlign Lite

SpineAlign Lite is a posture-monitoring prototype split into Wokwi simulation, browser dashboard, and physical ESP32-CAM firmware.

## Structure

- `SpineAlign.ino`, `diagram.json`, `wokwi.toml`: unchanged Wokwi ESP32 DevKit simulation (two IMUs).
- `index.html`, `styles.css`, `app.js`, `orientation3d.js`: browser dashboard and visualization.
- `ble-serial-bridge.js`, `telemetry-protocol.js`: BLE adapter and strict shared telemetry parser.
- `firmware/SpineAlign_ESP32CAM/`: physical firmware, PlatformIO configuration, OTA partitions and credential template.
- `tests/`: parser scenario tests and repository integration checks.
- `docs/`: setup, hardware and scenario test plan.

## Dashboard

Run `python3 -m http.server 8000` and open `http://localhost:8000`. Demo mode works without hardware. The dashboard defaults to BLE; use `?transport=usb` for the existing USB/Wokwi workflow. Web Bluetooth requires HTTPS or localhost and compatible Chrome/Edge.

## Software tests

With Node.js 20+ installed and no additional npm dependencies:

```sh
npm test
npm run check
```

Tests cover valid and malformed telemetry, older frames, unavailable battery/charger status, duplicate/unknown fields, invalid flags, mode selection, partition bounds, dashboard script ordering, and repository firmware separation.

## Physical ESP32-CAM

Use `firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino`, not the root simulation sketch. Build with `pio run -d firmware/SpineAlign_ESP32CAM`. The PlatformIO project explicitly selects the custom 4 MB OTA partition table.

Copy `config.example.h` to `config.h` and set 2.4 GHz Wi-Fi credentials plus a unique OTA password (12+ characters). The example values disable Wi-Fi/OTA and `config.h` is ignored by Git.

### Sensor configuration

The physical build defaults to **one MPU6050 at address 0x68 mounted on the back**. Its telemetry includes `MODE:1`; the dashboard hides the unmeasured neck panels rather than displaying fabricated data. To use two IMUs like Wokwi, set `SPINEALIGN_DUAL_IMU 1` in `config.h`; the second sensor is address 0x69 and telemetry uses `MODE:2`.

The optional OLED is at 0x3C and ADS1115 at 0x48. Battery voltage goes via a 100k/100k divider to ADS1115 A0; TP4056 CHRG goes to A1 with a 10k pull-up to 3V3. GPIO14/15 are shared I²C, so microSD is unavailable. GPIO2 is boot-sensitive and only drives a properly designed transistor/MOSFET input after boot testing. A TP4056 is a charger, not a boost converter/regulator.

Battery percentage and FULL are rough estimates. Compare measured voltage with a multimeter. Keep FTDI recovery available until a real OTA update is verified. Automated checks do not validate sensor alignment, electrical safety, charging, RF coexistence or physical OTA recovery. SpineAlign is a student prototype, not a medical diagnostic device.
