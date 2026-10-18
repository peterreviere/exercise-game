import { MathUtils } from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Drives the separate Game 2 wing GLB from the player's arm height and flap events. */
export class RobotWingRig {
  constructor(root, { response = 13, range = 0.72, flapKick = 0.22 } = {}) {
    this.root = root;
    this.left = root.getObjectByName('WingPivotLeft');
    this.right = root.getObjectByName('WingPivotRight');
    if (!this.left || !this.right) throw new Error('The wing GLB is missing its left or right pivot node.');
    this.response = response;
    this.range = range;
    this.flapKickStrength = flapKick;
    this.leftBase = this.left.rotation.z;
    this.rightBase = this.right.rotation.z;
    this.leftValue = 0;
    this.rightValue = 0;
    this.flapKick = 0;
    this.apply();
  }

  apply() {
    // Positive values lift each wing; the mirrored pivots rotate oppositely.
    this.left.rotation.z = this.leftBase + this.leftValue;
    this.right.rotation.z = this.rightBase - this.rightValue;
  }

  update(input, deltaSeconds) {
    const dt = clamp(deltaSeconds || 0, 0, 0.05);
    let leftTarget = 0;
    let rightTarget = 0;
    if (input?.active) {
      // MediaPipe's anatomical sides map directly to a robot viewed from behind.
      leftTarget = clamp((input.leftWingHeight ?? input.wingHeight) / 1.15, -1, 1) * this.range;
      rightTarget = clamp((input.rightWingHeight ?? input.wingHeight) / 1.15, -1, 1) * this.range;
      if (input.flap) this.flapKick = -this.flapKickStrength;
    }
    this.flapKick *= Math.exp(-9 * dt);
    const leftDesired = clamp(leftTarget + this.flapKick, -this.range * 1.2, this.range);
    const rightDesired = clamp(rightTarget + this.flapKick, -this.range * 1.2, this.range);
    const alpha = 1 - Math.exp(-this.response * dt);
    this.leftValue = MathUtils.lerp(this.leftValue, leftDesired, alpha);
    this.rightValue = MathUtils.lerp(this.rightValue, rightDesired, alpha);
    this.apply();
    return { left: this.leftValue, right: this.rightValue };
  }

  reset(immediate = false) {
    this.flapKick = 0;
    if (immediate) {
      this.leftValue = 0;
      this.rightValue = 0;
      this.apply();
    }
  }
}
