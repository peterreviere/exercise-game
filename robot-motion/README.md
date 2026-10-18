# Blue · Motion Studio

A local webcam-controlled 3D robot for Windows and macOS. Uses the actual tracking implementation from [peterreviere/exercise-game](https://github.com/peterreviere/exercise-game), plus the reference-inspired Blender robot.

## Requirements

- Node.js **22.12 or newer** (24 LTS is also suitable), from https://nodejs.org
- Current Chrome or Edge with hardware acceleration enabled
- A webcam for live movement; the demo works without one
- Internet on the first dependency installation

No Python, Blender, server account, or GPU driver toolkit is needed to run the app. Tracking uses GPU inference with the repository's CPU fallback.

## Windows

1. Extract the entire folder; do not run from inside a ZIP.
2. Install Node.js if needed, then double-click `Start-Windows.cmd`.
3. The launcher installs dependencies on the first run and opens the local app.

Or open a terminal in this folder:

```sh
npm ci
npm run dev -- --open
```

## macOS

1. Extract the entire folder and install Node.js if needed.
2. Double-click `Start-Mac.command`. If the executable bit was lost during copying, use Terminal:

```sh
cd /path/to/robot-motion
npm ci
npm run dev -- --open
```

Use the Local URL printed in the terminal, normally http://127.0.0.1:5173. If that port is occupied, Vite selects another one. Keep the terminal open while using the app; press Ctrl+C to shut it down. Do not open `index.html` directly.

## Using Blue

- **Try demo** moves the actual rig without accessing the camera.
- **Start camera** asks for webcam access, then loads the bundled MediaPipe model.
- Stand back far enough to show shoulders, elbows, wrists, and hips. Raise your arms, reach sideways or forward, bend your elbows, or lean.
- The robot follows in mirror mode, matching the mirrored camera preview. No calibration is needed.
- **Follow legs too** enables hip/knee/ankle tracking when your entire body is visible. Leave it off for seated or upper-body use.
- Low-confidence limbs ease back toward the rest pose. Tracking loss eases the robot back to neutral.
- **Stop** releases the webcam. The app never requests microphone access.

Camera processing stays in the browser. No frames or landmarks are uploaded or recorded. All runtime model/WASM/robot assets are bundled locally; there are no external fonts, CDNs or analytics.

## Troubleshooting

Camera denied: allow camera access for the localhost page. On Mac check System Settings → Privacy & Security → Camera; on Windows check Settings → Privacy & security → Camera. Close other webcam apps. If the embedded preview cannot grant webcam access, open the Local URL in Chrome or Edge.

Blank 3D view: enable browser hardware acceleration and reload. Slow tracking: improve lighting, close other graphics-heavy apps, and leave leg tracking off. This app follows a single person; it is not a medical form assessment tool.

Each teammate should run their own copy on their own computer. Visiting another computer's plain-HTTP network address will generally not allow webcam access; the launcher deliberately binds only to localhost.

## Build and checks

```sh
npm test
npm run build
npm run preview -- --open
```

`dist/` is the portable static build. It still needs an HTTP server on localhost or HTTPS for camera access. The source and production build were checked on macOS; native Windows execution and live human webcam tracking require a teammate/device check.

## Code map

- `src/main.js`: camera lifecycle, skeleton preview, rendering, demo, classifier status.
- `src/retarget.js`: maps body world landmarks to the robot's 15-bone rigid rig with smoothing and confidence checks. Mirror mapping swaps left/right before reflecting X. Blender/glTF bone bind orientations are preserved.
- `src/vendor/`: unmodified tracking source from repository `main`, commit `2dabbe9b8634c348a4d1c4790eef148f130f16e5`.
- `public/models/`, `public/mediapipe/wasm/`: original repository inference assets.
- `public/robot/blue_robot.glb`: rigged robot, embedded PBR materials, no animation clips.
- `tests/`: tests using the real exported robot and synthetic landmark input. These do not substitute for a human webcam trial.

This is a standalone motion demo, not a game. Head expression and fingers are static; arms, torso and optional legs follow tracking. The Blender source remains in the sibling `assets/blue-robot` directory in the workspace.
