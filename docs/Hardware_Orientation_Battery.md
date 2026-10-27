# Physical hardware, orientation and battery notes

## Firmware modes

The root `SpineAlign.ino` is the unchanged two-IMU Wokwi simulation. Physical ESP32-CAM firmware lives at `firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino`.

- Default physical mode: one MPU6050 at `0x68), mounted on the back; `MODE:1`.
- Optional dual mode: set `SPINEALIGN_DUAL_IMU 1` in private `config.h`; neck is `0x68), back is `0x69); `MODE:2`.
- Optional SSD1306 OLED: `0x3C).
- ADS1115: `0x48).

GPIO14 SDA and GPIO15 SCL are shared I²C and overlap with microSD. Keep SD unused. GPIO15 and GPIO2 are boot-sensitive, so test cold boot with the final circuits attached.

## Battery and charging

Cell/TP4056 BAT+ → 100k resistor → ADS1115 A0 node → second 100k resistor → common GND. A 4.2 V cell yields about 2.1 V at A0. Power ADS1115 at 3V3. TP4056 CHRG connects to ADS1115 A1 with a 10k pull-up to 3V3; CHRG is open-drain and active-low. Never connect CHRG to GPIO13.

Battery sampling uses four fast ADS1115 conversions and averages by four. Battery percentage is a rough voltage estimate, not a fuel gauge. CHRG cannot distinguish charger unplugged from charge complete; `FULL:1` only means CHRG is released and the measured voltage is near full.

## Power and alert output

TP4056 is a charger, not a boost converter or load-sharing regulator. Use a protected cell and suitable power input/regulator. Never connect battery positive directly to GPIO or 3V3. GPIO2 must drive only a suitable transistor/MOSFET input; never drive a motor directly.

## BLE and OTA

BLE telemetry is newline-delimited and paced into small notifications for the browser bridge. BLE bonding/encrypted characteristic access is enabled. Web Bluetooth needs HTTPS/localhost, user permission and a compatible browser.

Wi-Fi OTA requires non-placeholder SSID/password and a unique OTA password of 12+ characters in `config.h`. The custom `partitions.csv` defines two OTA slots for 4 MB flash; confirm the exact board flash size. Upload once by FTDI, test OTA and keep wired recovery.

## Validation checklist

1. Confirm I²C addresses for the selected IMU mode, OLED, and ADS1115.
2. Calibrate upright and validate pitch/roll signs after mounting.
3. Disconnect the active IMU and verify posture monitoring pauses.
4. Compare ADS1115 A0 voltage with a multimeter at several battery levels.
5. Check A1/CHRG is low during charging and released when inactive.
6. Verify BLE telemetry, mode label, dashboard history, and calibration command.
7. Verify Wi-Fi/OTA and confirm the board boots after an update.
8. Confirm GPIO2/GPIO15 do not block startup or FTDI flashing.
