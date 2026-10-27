# SpineAlign Lite

SpineAlign Lite is a dual-IMU posture-monitoring prototype split into three parts: Wokwi simulation, browser dashboard, and physical ESP32-CAM firmware.

## Repository structure

- `SpineAlign.ino`, `diagram.json`, `wokwi.toml`: existing Wokwi ESP32 DevKit simulation (kept separate and unchanged).
- `index.html`, `styles.css`, `app.js`, `orientation3d.js`: browser dashboard and visualization.
- `ble-serial-bridge.js`: Web Bluetooth adapter used by the physical firmware.
- `telemetry-protocol.js`: shared strict telemetry parser used in browser and Node tests.
- `firmware/SpineAlign_ESP32CAM/`: physical BLE, Wi-Fi OTA and ADS1115 battery/charger firmware, PlatformIO configuration and OTA partitions.
- `tests/`: Node scenario tests for telemetry values and repository integration.
- `docs/`: setup notes, physical wiring, code review and scenario checklist.

## Run the dashboard

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Demo mode works without hardware. The dashboard defaults to BLE for the physical firmware; use `http://localhost:8000/?transport=usb` for native USB serial / Wokwi testing. Web Bluetooth needs HTTPS or localhost and a compatible Chrome/Edge browser; Web Serial generally needs desktop Chromium.

## Run software tests locally

Requires Node.js 20+; no npm dependencies are needed.

```sh
npm test
npm run check
```

The tests exercise valid telemetry, older/minimal telemetry, missing sensors, unavailable battery values, corrupted input, duplicate fields, invalid state flags, oversized messages and firmware/dashboard integration assumptions.

## Physical ESP32-CAM firmware

Open `firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino`. Do not replace the root Wokwi sketch. The dedicated sketch reuses the posture logic and adds BLE notifications, calibration command, Wi-Fi ArduinoOTA and ADS1115 battery / TP4056 charge-signal monitoring.

Install PlatformIO and run:

```sh
python -m pip install --upgrade platformio
pio run -d firmware/SpineAlign_ESP32CAM
```

The PlatformIO config explicitly selects `partitions.csv` with two OTA app slots. This partition map is for 4 MB flash; verify the actual module before uploading. Copy `config.example.h` to `config.h` and enter 2.4 GHz Wi-Fi credentials plus a unique OTA password of at least 12 characters. `config.h` is ignored by Git and example/placeholder values disable Wi-Fi OTA. First flash is wired through FTDI/USB-UART; keep that recovery path available.

## Physical hardware expectations

The physical sketch expects two IMUs at I²C addresses `0x68` and `0x69`, optional SSD1306 OLED at `0x3C`, and ADS1115 at `0x48`. I²C uses GPIO14/15, so microSD must remain unused. Battery voltage goes through a 100k/100k divider to ADS1115 A0; TP4056 CHRG goes to A1 with a 10k pull-up to 3V3. Do not connect CHRG to GPIO13. GPIO2 is boot-sensitive and only suitable for a properly designed MOSFET/transistor driver after boot tests. TP4056 is a charger, not a regulator/boost converter. Battery percent and FULL are estimates, not a calibrated fuel gauge.

## Limits and sign-off

GitHub Actions has been configured to test and compile these paths, but it is not triggered by skipped-CI commits. Automated checks do not replace physical tests for sensor orientation, power integrity, charging, Wi-Fi/BLE coexistence, boot behavior or OTA recovery. Read `docs/Scenario_Test_Plan.md` before physical sign-off. SpineAlign is a student prototype, not a medical diagnostic device.
