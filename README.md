# Sahil’s robot motion prototype

A rigged blue robot that follows webcam movement using the tracking implementation from this repository’s `main` branch.

## Run on Windows or Mac

1. Install Node.js 22.12 or newer.
2. Open `robot-motion/`.
3. Windows: double-click `Start-Windows.cmd`. Mac: double-click `Start-Mac.command`.
4. In the browser, choose **Start camera** or **Try demo**.

See [the app README](robot-motion/README.md) for terminal commands, camera permissions, troubleshooting, and verification limits.

## Contents

- [`robot-motion/`](robot-motion/): runnable browser app, robot export, bundled tracking assets, launchers, and tests.
- [`assets/blue-robot/`](assets/blue-robot/): editable Blender model, GLB, render, and reproducible modeling script.

No Python or Blender installation is needed to run the app. Live tracking stays on the device. This branch contains a motion prototype; no game has been added yet.
