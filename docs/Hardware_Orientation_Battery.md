# Physical hardware, orientation and battery notes

## Firmware separation

The root SpineAlign.ino is the unchanged Wokwi ESP32 DevKit simulation. The dedicated physical firmware is firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino and supports BLE, Wi-Fi OTA and ADS1115 monitoring. Do not use the old GPIO13 battery ADC profile for the wearable.

## I²C

Physical firmware expects two IMUs at 0x68 (neck, AD0 low) and 0x69 (back, AD0 high), optional SSD1306 OLED at 0x3C, and ADS1115 at 0x48. All share GPIO14 SDA / GPIO15 SCL at 100 kHz. Disable microSD while using GPIO14/15. GPIO15 and GPIO2 are boot-strapping sensitive; verify cold boot with all circuits attached. Check pitch/roll signs after final mounting.

## Battery and charging

Cell/TP4056 BAT+ → 100k resistor → ADS1115 A0 node → second 100k resistor → common GND. This gives about 2.1 V at A0 when the cell is at 4.2 V. Power ADS1115 from 3V3. TP4056 CHRG connects to ADS1115 A1 with a 10k pull-up from A1/CHRG to 3V3. CHRG is open-drain and active-low. Do not wire CHRG to GPIO13.

Battery percentage is a rough voltage estimate. CHRG cannot distinguish an unplugged charger from charge-complete; FULL=1 only indicates released CHRG plus near-full measured cell voltage. Compare A0 measurements against a multimeter across multiple cell levels.

## Power and alert output

TP4056 is a charger, not a boost converter or load-sharing regulator. Use a protected cell and suitable regulator/power input. Never feed the battery directly to GPIO or 3V3. GPIO2 drives only a suitable transistor/MOSFET input for the alert; never power a haptic motor directly from a GPIO. Test boot and programming mode with final wiring.

## BLE and OTA setup

The device advertises BLE GATT notifications with newline telemetry. Firmware enables BLE bonding and encrypted characteristic access. Web Bluetooth requires a compatible browser, HTTPS/localhost and user permission.

Wi-Fi OTA activates only when config.h contains valid non-placeholder credentials and a unique 12+ character OTA password. partitions.csv provides OTA data and two OTA slots on 4 MB flash; verify the module's actual flash size. Upload first over FTDI, verify OTA, and keep wired recovery available.

## Validation

1. Confirm IMU 0x68/0x69, OLED 0x3C if installed, ADS1115 0x48.
2. Validate sensor orientation and calibration reference.
3. Compare A0 battery voltage with a multimeter at multiple levels.
4. Verify A1/CHRG low during charge and high when released.
5. Confirm BLE telemetry, battery fields, calibration and stale-link handling.
6. Test OTA and verify the new image restarts.
7. Disconnect each IMU in turn and verify its validity flag.
8. Test cold boot and FTDI programming with GPIO2 and I²C wiring attached.
