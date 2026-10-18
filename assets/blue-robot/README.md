# Blue companion robot

A 3D interpretation of the supplied blue-and-white robot reference. Built procedurally in headless Blender; no external textures or add-ons required.

- `blue_robot.blend`: editable character, rigid-weighted skeleton, and studio lighting/camera.
- `blue_robot.glb`: character and skeleton only, with embedded materials, for later game integration.
- `preview.png`: studio render.
- `build_robot.py`: reproducible source.
- `model_stats.json`: geometry counts.

## Open or rebuild

Open the `.blend` in Blender. To rebuild from a terminal:

```sh
blender --background --python build_robot.py
```

Run that command in this directory. Outputs are written beside the script.

## Coordinate and rig conventions

Blender coordinates: Z up, front toward negative Y. Height is approximately 2.83 Blender units; use meters if importing at physical scale. The GLB exporter converts to glTF's Y-up convention.

The 15-bone `BlueRobot_Rig` has hips, chest, head, and paired upper-arm, forearm, hand, thigh, shin, and foot bones. `.L` and `.R` indicate the robot's own left and right. Each mesh is rigidly weighted to one bone so mechanical panels retain their shape. Pose the skeleton in Pose Mode. The initial pose is a relaxed A-pose. Hands have modeled fingers, but no individual finger bones. Facial expression is static. No animation clips or game integration are included.

Shared PBR materials use solid colors, including emissive cyan details; no texture files are needed. This is a detailed prototype asset, not yet an optimized mobile-game mesh. Reduce geometry for a specific performance budget before deployment.
