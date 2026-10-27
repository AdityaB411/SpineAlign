# SpineAlign scenario test plan

Use this as the release checklist. Software test results are separate from physical hardware results.

## Automated software scenarios

Run `npm test` and `npm run check` locally.

| Scenario | Expected behavior |
|---|---|
| Full valid frame | All angles, alert/calibration flags and battery fields parse. |
| Minimal legacy frame | Required N/B values parse; absent optional values remain absent, not zero. |
| Battery unavailable | BAT/PCT/CHG/FULL sentinel values of -1 remain unavailable, not “0%”. |
| Corrupt partial field | The whole frame is rejected without mutating dashboard state. |
| Duplicate or unknown field | The frame is rejected. |
| Invalid flags / impossible percentage | The frame is rejected. |
| Oversized line | The frame is rejected. |
| BLE bridge loaded | Bridge loads before telemetry protocol and app parser. |
| USB transport selected | `?transport=usb` leaves native Web Serial in control. |
| Physical sketch contract | BLE, OTA and separated ADS1115 channels remain present. |
| OTA layout | OTA0 and OTA1 exist, partitions do not overlap and end at or before 4 MB. |
| Secrets hygiene | Config is ignored and sample credentials are placeholders. |

## Hardware acceptance, to run later

1. Cold boot with sensors, OLED, ADS1115 and alert driver attached; confirm no boot-strap problem.
2. Scan I²C and confirm both IMUs (0x68, 0x69), OLED if fitted (0x3C), and ADS1115 (0x48).
3. Place the wearable upright and recalibrate. Tilt each sensor separately and validate pitch/roll signs.
4. Disconnect each IMU individually; confirm the matching validity flag drops and posture alerts pause.
5. Compare ADS1115 battery voltage with a multimeter across several charge levels.
6. Verify TP4056 CHRG is low while charging and released when not actively charging. Confirm the dashboard describes FULL as an estimate.
7. Connect from a supported browser over HTTPS/localhost; verify live BLE frames, 3D movement, battery, stale data, and calibration command.
8. Confirm a BLE drop returns the UI to disconnected/demo state and advertising restarts.
9. Confirm Wi-Fi connects without breaking BLE data or sensor sampling.
10. Perform an OTA update; verify reported IP, password authentication, reboot into the new firmware, and keep wired recovery available.
11. Repeat with Wi-Fi unavailable; BLE posture monitoring should continue and OTA should report unavailable rather than blocking.
12. Test with low battery and charger attached; verify sensor stream remains responsive.

## Explicit limitations

- Physical firmware assumes two IMUs; one-sensor hardware needs a specified mode.
- Battery percentage is a voltage estimate, not coulomb counting.
- TP4056 CHRG alone cannot separate charger unplugged from charge complete.
- OTA and electrical behavior cannot be certified by source inspection or unit tests.
