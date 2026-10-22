# Orientation and Battery Hardware Notes

## Reused model and orientation

The dashboard uses `human_posed.glb` from [UMRAM-Bilkent/supine-human-model](https://github.com/UMRAM-Bilkent/supine-human-model), released under CC0 1.0. The existing mesh is sampled into a dotted silhouette instead of creating a new human mesh. Back pitch/roll move the torso; neck pitch/roll are applied relative to the torso to move the head independently.

Telemetry example:

```text
N:5.2,B:8.7,NP:4.1,NR:1.0,BP:7.2,BR:-2.1,ALERT:0,CAL:1,BAT:3.87,PCT:78,CHG:1,FULL:0
```

`N/B` remain scalar tilt magnitudes, `NP/NR` are neck pitch/roll, `BP/BR` are back pitch/roll. Validate signs with controlled forward/backward and sideways movements because sensor mounting determines the axes.

## AI-Thinker ESP32-CAM hardware profile

Set `SPINEALIGN_TARGET_ESP32_CAM` to `1` in `SpineAlign.ino` for the physical profile. Keep `0` for the existing Wokwi DevKit simulation.

| Function | Suggested pin |
|---|---|
| I²C SDA | GPIO14 |
| I²C SCL | GPIO15 |
| Haptic / alert driver input | GPIO2 |
| Battery ADC | GPIO34 |
| TP4056 CHRG status | GPIO13 |
| Calibration | USB serial command `CALIBRATE` (GPIO calibration button disabled in this profile) |

GPIO14/15 assume the microSD interface is unused; GPIO15 is a strapping pin. GPIO2 is also a boot-sensitive pin on ESP32 boards: use only a high-impedance driver input and verify boot on the exact board before soldering. Pin availability and circuit details vary between ESP32-CAM revisions.

## Battery voltage divider

- Battery positive / TP4056 BAT+ → **100 kΩ resistor** → ADC node.
- ADC node → GPIO34 and top of a second **100 kΩ resistor**.
- Second resistor → common battery/ESP32 GND.
- TP4056 CHRG → GPIO13 with a pull-up to **3.3 V**; active-low and open-drain.
- ESP32, charger, and battery must share ground.

The equal divider outputs half the battery voltage (about 2.1 V with a 4.2 V cell). Firmware multiplies by 2 and estimates state of charge from a rough single-cell voltage curve. Calibrate against a multimeter and the chosen cell at representative loads; this is not a fuel gauge.

TP4056 CHRG is low during charging and high-impedance when charging is inactive. That does not distinguish charger unplugged from charge complete. Firmware infers “near full” from approximately 4.15 V or above while CHRG is inactive. For definite completion detection, choose a charger/power-management module with a separate status output.

## Power / haptic notes

TP4056 is a charger, not a regulated 5 V boost converter or load-sharing controller. A single-cell Li-ion pack varies around 3.0–4.2 V; do not connect it directly to the ESP32 3V3 rail. Confirm the specific ESP32-CAM board's power input and use the right regulator and protected cell. Drive a vibration motor through a suitable transistor/MOSFET and protection components, not directly from a GPIO.

## Validation checklist

1. Confirm both IMUs respond at `0x68` and `0x69`.
2. Check pitch and roll signs independently with controlled movements.
3. Compare ADC voltage to a multimeter across the battery range.
4. Observe TP4056 CHRG while charging, unplugged, and near completion.
5. Confirm boot with SDA/SCL on the chosen pins and the alert driver connected.