# SpineAlign Dashboard

A responsive browser dashboard for SpineAlign. It shows neck/back angles, posture status, recent history, connection state, a particle-style two-sensor 3D posture view, and battery / charging telemetry.

## Run locally

Open `index.html` in a browser for the demo dashboard. For live USB serial, serve this directory from localhost or HTTPS and use a desktop Chromium-based browser with Web Serial enabled.

```sh
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## 3D model

The dashboard loads `human_posed.glb` from [UMRAM-Bilkent/supine-human-model](https://github.com/UMRAM-Bilkent/supine-human-model), a CC0 1.0 adaptation of a Quaternius character. The existing mesh surface is sampled into a point cloud. The back IMU drives the torso and the neck IMU drives the head relative to the torso. If the external model cannot be fetched, a built-in point figure is used. Four sliders allow a demo of forward/backward and sideways movement.

Current telemetry fields: `N`, `B`, `NP`, `NR`, `BP`, `BR`, `ALERT`, `CAL`, `BAT`, `PCT`, `CHG`, and `FULL`. `N/B` are scalar tilt magnitudes for the existing alert cards. `NP/NR` and `BP/BR` are pitch/roll.

## Battery / TP4056

For the physical ESP32-CAM profile, set `SPINEALIGN_TARGET_ESP32_CAM` to `1` in `SpineAlign.ino`. The profile assumes I²C SDA=GPIO14, SCL=GPIO15, battery ADC=GPIO34, TP4056 CHRG=GPIO13, and alert transistor input=GPIO2. GPIO14/15 assume the microSD interface is unused; GPIO15 is a strapping pin, so verify boot behavior on your exact board revision.

Use an equal resistor divider (e.g. 100 kΩ + 100 kΩ) from battery-positive to GND with its midpoint to GPIO34. A 4.2 V cell gives about 2.1 V at the ADC. Never connect cell voltage directly to an ESP32 GPIO or 3V3 rail. Pull the TP4056 active-low, open-drain CHRG signal up to 3.3 V. The percentage is a rough voltage-based estimate, and a high-impedance CHRG signal cannot distinguish “charger unplugged” from “charge complete”; firmware only reports a near-full voltage estimate in that case. Use a suitable regulator / protected cell arrangement; a TP4056 is not a regulated boost converter or load-sharing controller. Drive any haptic motor through a properly rated transistor/MOSFET, never directly from a GPIO.

The current Wokwi/DevKit profile keeps battery monitoring disabled and sends unavailable battery values. Actual battery measurements require the physical wiring and profile.

## Local dependencies

Three.js modules load from jsDelivr and the CC0 human asset is loaded from jsDelivr. Internet access is therefore required to display the source model; the dashboard includes a local particle fallback.