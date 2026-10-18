export const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

const visible = point => point && (point.visibility ?? 1) > 0.45;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function armIsLevelAndStraight(shoulder, elbow, wrist, shoulderWidth, torsoHeight) {
  if (![shoulder, elbow, wrist].every(visible)) return false;
  const upper = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
  const lower = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
  const upperLength = Math.hypot(upper.x, upper.y);
  const lowerLength = Math.hypot(lower.x, lower.y);
  if (upperLength < 0.01 || lowerLength < 0.01) return false;
  const elbowCosine = (upper.x * lower.x + upper.y * lower.y) / (upperLength * lowerLength);
  return elbowCosine < -0.92
    && Math.abs(elbow.y - shoulder.y) < torsoHeight * 0.2
    && Math.abs(wrist.y - shoulder.y) < torsoHeight * 0.28
    && Math.abs(wrist.x - shoulder.x) > shoulderWidth * 0.95;
}

function forwardDive(worldLandmarks) {
  const leftShoulder = worldLandmarks?.[11];
  const rightShoulder = worldLandmarks?.[12];
  const leftHip = worldLandmarks?.[23];
  const rightHip = worldLandmarks?.[24];
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every(visible)) return 0;
  const shoulder = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  };
  const hip = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
    z: (leftHip.z + rightHip.z) / 2,
  };
  const torsoLength = Math.max(0.12, Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y, shoulder.z - hip.z));
  // MediaPipe world Z becomes more negative toward the camera. Shoulders moving
  // toward the camera relative to the hips are treated as pitching downward.
  return clamp((hip.z - shoulder.z) / (torsoLength * 0.55), 0, 1);
}

export function flightInput(landmarks, worldLandmarks = null) {
  const leftShoulder = landmarks?.[11];
  const rightShoulder = landmarks?.[12];
  const leftWrist = landmarks?.[15];
  const rightWrist = landmarks?.[16];
  const leftElbow = landmarks?.[13];
  const rightElbow = landmarks?.[14];
  const leftHip = landmarks?.[23];
  const rightHip = landmarks?.[24];
  if (![leftShoulder, rightShoulder, leftWrist, rightWrist, leftHip, rightHip].every(visible)) {
    return { x: 0, wingHeight: 0, wingReach: 0, dive: 0, gliding: false, active: false };
  }

  const shoulders = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  const shoulderWidth = Math.max(0.08, Math.abs(leftShoulder.x - rightShoulder.x));
  const torsoHeight = Math.max(0.1, Math.abs(hips.y - shoulders.y));
  const wristY = (leftWrist.y + rightWrist.y) / 2;
  const leftExtension = Math.abs(leftWrist.x - leftShoulder.x) / shoulderWidth;
  const rightExtension = Math.abs(rightWrist.x - rightShoulder.x) / shoulderWidth;
  const leftReach = Math.hypot(leftWrist.x - leftShoulder.x, leftWrist.y - leftShoulder.y) / shoulderWidth;
  const rightReach = Math.hypot(rightWrist.x - rightShoulder.x, rightWrist.y - rightShoulder.y) / shoulderWidth;
  const leftWingHeight = clamp((leftShoulder.y - leftWrist.y) / torsoHeight, -1.5, 1.5);
  const rightWingHeight = clamp((rightShoulder.y - rightWrist.y) / torsoHeight, -1.5, 1.5);
  const wingHeight = (leftWingHeight + rightWingHeight) / 2;

  return {
    // Camera input is mirrored on screen, so invert the image-space lean.
    x: clamp((hips.x - shoulders.x) / shoulderWidth * 3.4),
    wingHeight,
    leftWingHeight,
    rightWingHeight,
    wingReach: (leftReach + rightReach) / 2,
    dive: forwardDive(worldLandmarks),
    gliding: leftExtension > 0.95
      && rightExtension > 0.95
      && armIsLevelAndStraight(leftShoulder, leftElbow, leftWrist, shoulderWidth, torsoHeight)
      && armIsLevelAndStraight(rightShoulder, rightElbow, rightWrist, shoulderWidth, torsoHeight),
    active: true,
  };
}

export class WingFlightController {
  constructor({ flapSpeed = 2.4, flapCooldownMs = 280 } = {}) {
    this.flapSpeed = flapSpeed;
    this.flapCooldownMs = flapCooldownMs;
    this.reset();
  }

  reset() {
    this.previous = null;
    this.previousAt = 0;
    this.lastFlapAt = -Infinity;
  }

  update(landmarks, now, worldLandmarks = null) {
    const input = flightInput(landmarks, worldLandmarks);
    let flap = false;
    if (input.active && this.previous?.active) {
      const elapsed = Math.max(0.04, (now - this.previousAt) / 1000);
      const downstrokeSpeed = (this.previous.wingHeight - input.wingHeight) / elapsed;
      const wingsEngaged = input.wingReach > 0.65 && this.previous.wingReach > 0.65;
      flap = wingsEngaged
        && downstrokeSpeed > this.flapSpeed
        && input.wingHeight < 0.35
        && now - this.lastFlapAt >= this.flapCooldownMs;
      if (flap) this.lastFlapAt = now;
    }
    this.previous = input;
    this.previousAt = now;
    return { ...input, flap };
  }
}

export class FlightRace {
  constructor({ durationMs = 60_000 } = {}) {
    this.durationMs = durationMs;
    this.reset();
  }

  reset() {
    this.phase = 'ready';
    this.startedAt = 0;
    this.finishedAt = 0;
    this.score = 0;
    this.combo = 0;
    this.rings = 0;
  }

  start(now) {
    this.reset();
    this.phase = 'flying';
    this.startedAt = now;
  }

  timeLeft(now) {
    if (this.phase === 'ready') return this.durationMs;
    const edge = this.phase === 'finished' ? this.finishedAt : now;
    return Math.max(0, this.durationMs - (edge - this.startedAt));
  }

  recordRing(hit) {
    if (this.phase !== 'flying') return 0;
    if (!hit) {
      this.combo = 0;
      return 0;
    }
    this.combo += 1;
    this.rings += 1;
    const points = 100 + Math.min(this.combo - 1, 4) * 25;
    this.score += points;
    return points;
  }

  update(now) {
    if (this.phase !== 'flying' || this.timeLeft(now) > 0) return null;
    this.phase = 'finished';
    this.finishedAt = now;
    return { score: this.score, rings: this.rings };
  }
}
