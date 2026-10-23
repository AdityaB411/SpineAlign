# SpineAlign Lite

SpineAlign Lite is a dual-IMU posture-monitoring prototype. The firmware reads neck and back sensors, filters pitch/roll, compares deviation against a session calibration reference, and gives a local alert after sustained deviation. This repository includes the Wokwi ESP32 DevKit simulation and a browser dashboard with demo and USB-serial live modes.

## Run the dashboard locally

From the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Demo mode works without hardware. Live USB serial requires a desktop Chromium-based browser supporting Web Serial over a secure context (localhost or HTTPS). Close Arduino Serial Monitor before connecting from the browser.

## Firmware profiles

- **Wokwi / ESP32 DevKit:** default `SPINEALIGN_TARGET_ESP32_CAM=0`; I²C SDA 21, SCL 23; calibration button GPIO14; alert LED GPIO25.
- **Physical AI-Thinker ESP32-CAM:** set `SPINEALIGN_TARGET_ESP32_CAM=1`; I²C SDA 14, SCL 15; alert-driver input GPIO2; battery ADC GPIO34; TP4056 CHRG GPIO13; calibration via USB serial `CALIBRATE`.

The physical profile uses GPIO34 (ADC1) for the battery divider and GPIO13 for the active-low, open-drain TP4056 CHRG signal. Use [the hardware notes](docs/Hardware_Orientation_Battery.md) as the wiring reference. GPIOs 13/14/15 share pins with the ESP32-CAM microSD interface, which must remain unused. GPIO2 and GPIO15 can affect boot, so verify the exact board revision and boot behavior before soldering. Use the recommended divider, a suitable regulator, and a protected cell. Never connect a Li-ion cell directly to a GPIO or 3V3 input; never drive a haptic motor directly from a GPIO.

## Live serial protocol

Firmware streams at 115200 baud, for example:

```text
N:5.2,B:8.7,NP:4.1,NR:1.0,BP:7.2,BR:-2.1,ALERT:0,CAL:1,NS:1,BS:1,BAT:3.87,PCT:78,CHG:0,FULL:0
```

- `N` / `B`: combined pitch/roll deviation magnitude for neck/back.
- `NP` / `NR`, `BP` / `BR`: pitch/roll values used by the 3D view.
- `ALERT`: firmware posture-threshold state; `CAL`: calibration flag.
- `NS` / `BS`: latest sensor-read validity flags. A zero indicates that the latest raw sensor read failed.
- `BAT` / `PCT`: approximate single-cell voltage and voltage-derived percentage; `CHG` / `FULL`: TP4056 CHRG state and a near-full-voltage estimate. `FULL:1` does not prove that the charger is connected or charging has completed.

The dashboard sends `CALIBRATE\n` over USB. Firmware responds with `CALIBRATED` or `CALIBRATION FAILED`, and the dashboard displays the result.

## CI, deployment, and limitations

GitHub Actions validates dashboard JavaScript and compiles both the Wokwi DevKit profile and physical ESP32-CAM profile. These checks do not validate sensor axis orientation, boot-strapping behavior, battery voltage accuracy, charging, or haptic electronics on physical hardware.

Enable GitHub Pages once under **Settings → Pages → Build and deployment → Source → GitHub Actions**. After it is enabled, the deployment workflow publishes the dashboard when web assets change.

The 3D view samples a CC0 human mesh and animates approximate torso/head rotations from the two IMUs. Check the pose and axis signs against the final sensor mounts. This is a student prototype, not a medical diagnostic device. The Android companion app/Bluetooth link and full physical wearable integration are not implemented in this repository yet.
