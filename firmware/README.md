# SpineAlign NodeMCU Firmware

This folder contains the NodeMCU ESP8266 Wi-Fi firmware in `firmware/SpineAlign_NodeMCU/`.

- Build with PlatformIO: `pio run -d firmware/SpineAlign_NodeMCU`
- Or open `firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino` in Arduino IDE (`NodeMCU 1.0 (ESP-12E Module)`).
- Copy `firmware/SpineAlign_NodeMCU/config.example.h` to `config.h` to set Wi-Fi credentials, or omit it to boot into AP mode (`SpineAlign-NodeMCU` at `192.168.4.1`).

See `firmware/SpineAlign_NodeMCU/README.md` for full wiring and flashing instructions.
