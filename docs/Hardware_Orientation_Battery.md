# Orientation and Battery Hardware Notes

## Orientation and serial data

The dashboard uses a CC0 human mesh from a pinned source revision in `orientation3d.js`. The mesh is sampled into a dotted silhouette; back pitch/roll control the torso group while neck pitch/roll control the head relative to the torso.

The current firmware telemetry contains `N`, `B`, `NP`, `NR`, `BP`, `BR`, `ALERT`, `CAL`, `NS`, `BS`, `BAT`, `PCT`, `CHG`, and `FULL`. `NS` and `BS` report whether the latest raw read succeeded for the neck/back sensors. Validate pitch and roll signs after the sensors are mounted.

## AI-Thinker ESP32-CAM profile

Set `SPINEALIGN_TARGET_ESP32_CAM` to `1` in `SpineAlign.ino` for the physical profile; keep `0` for the Wokwi ESP32 DevKit simulation.

| Function | Suggested GPIO |
|---|---:|
| I²C SDA | 14 |
| I²C SCL | 15 |
| Alert / haptic-driver input | 2 |
| Battery ADC | 34 |
| TP4056 CHRG status | 13 |
| Calibration | USB serial `CALIBRATE` |

GPIO34 is ADC1 and input-only, making it suitable for the battery divider if it is available on the selected board/breakout. GPIO13/14/15 also belong to the ESP32-CAM microSD pin group, so the microSD interface must remain unused. GPIO15 and GPIO2 can affect boot on ESP32 boards; confirm the exact board variant, strapping requirements, and boot behavior before soldering. Confirm GPIO34 is actually accessible on your board; breakout availability varies.

## Battery voltage divider

- Battery positive / TP4056 BAT+ → **100 kΩ resistor** → ADC node.
- ADC node → GPIO34 and top of a second **100 kΩ resistor**.
- Second resistor → common battery/ESP32 GND.
- TP4056 CHRG → GPIO13 with a pull-up to **3.3 V**; active-low and open-drain.
- ESP32, charger, and battery must share ground.

An equal divider outputs half the cell voltage (about 2.1 V with a 4.2 V cell). Firmware multiplies the measured voltage by two and estimates charge percentage from a rough single-cell voltage curve. Calibrate against a multimeter with the chosen cell and representative loads; this is not a fuel gauge.

TP4056 CHRG is low during charging and high-impedance when charging is inactive. It cannot distinguish charger-unplugged from charge-complete. Firmware sets `FULL:1` when CHRG is inactive and measured cell voltage is approximately 4.15 V or above. Treat this only as a near-full-voltage estimate, not proof of charge completion.

## Power and haptic output

A TP4056 is a charger, not a regulated 5 V boost converter or load-sharing controller. A single-cell Li-ion pack varies around 3.0–4.2 V; do not connect it directly to the ESP32 3V3 rail. Confirm the board's power input and use a suitable regulator and protected cell. Drive a vibration motor through a suitably rated transistor/MOSFET and appropriate protection components—never directly from a GPIO. If using the simulation's indicator LED in physical hardware, add a current-limiting series resistor (typically 220–1,000 Ω, selected for LED and supply).

## Validation checklist

1. Confirm both IMUs respond at `0x68` and `0x69`.
2. Check pitch and roll signs independently with controlled movements.
3. Unplug each IMU in turn and verify its validity flag goes low and the dashboard shows a sensor fault.
4. Stop the serial stream and verify the dashboard marks data stale.
5. Compare ADC voltage against a multimeter across the battery range.
6. Observe TP4056 CHRG while charging, unplugged, and near completion.
7. Confirm boot with SDA/SCL on the chosen pins and the alert driver connected.
