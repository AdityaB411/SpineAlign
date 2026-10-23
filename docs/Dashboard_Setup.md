# SpineAlign Dashboard Setup

## Run locally

From the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Demo mode and preview controls work without hardware. Live USB serial requires desktop Chromium, Web Serial support, a secure context, and firmware at 115200 baud. Close Arduino Serial Monitor before connecting.

## Telemetry

The firmware sends `N`, `B`, `NP`, `NR`, `BP`, `BR`, `ALERT`, `CAL`, `NS`, `BS`, `BAT`, `PCT`, `CHG`, and `FULL`. Sensor-validity flags (`NS` and `BS`) let the dashboard distinguish a real low angle from a sensor read failure. The dashboard also detects a serial stream that has stopped arriving. Calibration responses are shown as dashboard messages.

## 3D model

The dashboard loads the CC0 `human_posed.glb` model from a pinned source revision, then samples its surface into a point cloud. Back pitch/roll move the torso; neck pitch/roll adjust the head relative to the torso. A built-in point-figure fallback is used if the model asset fails to load. An internet connection is required for Three.js and the model asset.

## Physical ESP32-CAM battery wiring

Set `SPINEALIGN_TARGET_ESP32_CAM` to `1` in `SpineAlign.ino`. The firmware pin mapping is:

| Function | GPIO |
|---|---:|
| I²C SDA | 14 |
| I²C SCL | 15 |
| Alert / driver input | 2 |
| Battery ADC | 13 |
| TP4056 CHRG | 33 |

GPIO13 is an ADC2 input for battery voltage, so keep Wi-Fi disabled (the intended physical profile is Bluetooth-only). GPIO13, GPIO14 and GPIO15 overlap with the microSD interface, so the SD slot must remain unused. GPIO33 may be connected to an onboard indicator and is not brought out on every revision; confirm the exact schematic/pad and isolate any LED load before using it for TP4056 CHRG. GPIO15 and GPIO2 are boot-sensitive, so verify the exact board revision before connecting them.

Use an equal resistor divider, for example 100 kΩ from BAT+ to the ADC node and 100 kΩ from that node to common GND. Connect the node to GPIO13. A 4.2 V cell then produces about 2.1 V at the ADC. Connect TP4056 CHRG to GPIO13 with a pull-up to 3.3 V; it is active-low and open-drain. Never connect cell voltage directly to a GPIO or 3V3 rail. A TP4056 is a charger, not a regulated boost converter or load-sharing controller. Use a protected cell and a suitable regulator for the selected board. Drive a vibration motor through a suitable transistor/MOSFET and protection components, not directly from a GPIO.

Battery percentage is only a rough voltage estimate and changes with load and cell characteristics. `FULL:1` means voltage suggests near-full while CHRG is inactive; it cannot distinguish charger-unplugged from charge-complete.

## Physical validation checklist

1. Confirm both IMUs initialize at addresses `0x68` and `0x69`.
2. Check neck/back pitch and roll signs with controlled movements after final mounting.
3. Disconnect one sensor and confirm the dashboard shows a sensor fault.
4. Stop the serial stream and confirm the dashboard reports stale data.
5. Compare battery voltage against a multimeter over the operating range.
6. Observe CHRG during charging, unplugged, and near completion.
7. Verify boot with GPIO2/15 and the alert-driver circuit connected.
