# SpineAlign Dashboard

A responsive, single-page dashboard for the SpineAlign dual-sensor posture prototype. It shows neck and back angles, current posture status, a small recent-history chart, connection status, and the future two-sensor 3D view plan.

## Run locally

Open `index.html` in a browser to explore the demo dashboard. For live USB serial communication, serve the files from `http://localhost` or HTTPS, then use a desktop Chromium-based browser that supports Web Serial.

A quick local server from this folder:

```sh
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Live device protocol

The current firmware streams lines in this format at 115200 baud:

```text
N:5.2,B:8.7,ALERT:0
```

The dashboard reads the `N` and `B` angle values and can send `CALIBRATE` followed by a newline when the device is connected. The displayed values are relative to the firmware's calibration reference.

## Demo controls

- **Connect device:** asks the browser for an ESP32 serial port.
- **Calibrate sensors:** sends `CALIBRATE` in live mode or resets the demo reference in demo mode.
- **Simulate slouch:** raises the demo readings above the 15° threshold so the warning state can be previewed.

## Deploy

The repository includes `.github/workflows/pages.yml` to publish just `index.html`, `styles.css`, and `app.js` to GitHub Pages. If Pages is not yet enabled for the repository, enable it under **Settings → Pages** and select **GitHub Actions** as the build and deployment source. The workflow then runs on dashboard changes and can also be started manually.

The 3D posture model is a planned extension, not a current feature. It will need independent orientation data for both the neck and back sensors before model joints can follow pitch/roll movement accurately.