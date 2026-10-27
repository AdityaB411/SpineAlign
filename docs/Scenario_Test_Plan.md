# SpineAlign scenario test plan

Run automated software tests with `npm test` and syntax checks with `npm run check`. These tests do not require hardware or GitHub Actions.

| Scenario | Expected outcome |
|---|---|
| Full valid telemetry | Angles, calibration, alert, battery and charger fields parse. |
| Minimal older telemetry | N/B parse; missing optional fields stay absent, not zero. |
| Battery unavailable | `BAT/PCT/CHG/FULL=-1` stays unavailable. |
| Malformed/corrupt frame | Whole frame rejected before dashboard state mutates. |
| Duplicated/unknown field | Frame rejected. |
| Invalid flags/percentage/angle | Frame rejected. |
| Oversized line | Frame rejected. |
| Single IMU mode (`MODE:1`) | Back reading works; neck panel is hidden and not falsely reported as faulty. |
| Dual IMU mode (`MODE:2`) | Neck and back panels are shown; each validity flag is respected. |
| USB path | `?transport=usb` uses native serial and byte decoding. |
| BLE path | Bridge joins notifications and sends calibration command. |
| OTA partitions | OTA0/OTA1 are non-overlapping and within 4 MB. |
| Credentials | Placeholder config doesn't enable Wi-Fi OTA. |
| OTA unavailable | BLE posture monitoring should continue while OTA is unavailable. |

## Physical acceptance (still required)

1. Cold boot with all final wiring; verify the boot strap pins.
2. Confirm I²C address scans for selected sensor mode, OLED and ADS1115.
3. Calibrate upright and verify orientation signs.
4. Disconnect the sensor and check the relevant validity flag plus alert pause.
5. Compare battery voltage to a multimeter and observe charging signal states.
6. Connect over BLE using HTTPS/localhost and test angles, battery, history, stale-data handling and calibration.
7. Test Wi-Fi reconnect and OTA upload/reboot; keep FTDI recovery available.
8. Repeat with Wi-Fi unavailable and check BLE/sensing remain responsive.

Limitations: battery percentage is voltage-derived, and TP4056 CHRG alone cannot distinguish charger unplugged from charge-complete. SpineAlign is a student prototype, not a medical diagnostic device.
