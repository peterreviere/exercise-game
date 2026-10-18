export const BOXING_MOVES = Object.freeze([
  { id: 'move-left', label: 'LEAN LEFT', cue: 'Lean your torso to the left', opponentLabel: 'DODGE THE RIGHT SWING', opponentAction: 'swing-right', mark: '↶' },
  { id: 'move-right', label: 'LEAN RIGHT', cue: 'Lean your torso to the right', opponentLabel: 'DODGE THE LEFT SWING', opponentAction: 'swing-left', mark: '↷' },
  { id: 'punch-left', label: 'LEFT PUNCH', cue: 'Extend your left fist forward', opponentLabel: 'COUNTER · LEFT OPENING', opponentAction: 'stagger-left', mark: 'L' },
  { id: 'punch-right', label: 'RIGHT PUNCH', cue: 'Extend your right fist forward', opponentLabel: 'COUNTER · RIGHT OPENING', opponentAction: 'stagger-right', mark: 'R' },
  { id: 'duck', label: 'DUCK', cue: 'Bend your knees and lower down', opponentLabel: 'DUCK UNDER THE HIGH HOOK', opponentAction: 'high-hook', mark: '↓' },
  { id: 'block', label: 'BLOCK', cue: 'Bring both fists up to guard your face', opponentLabel: 'BLOCK THE STRAIGHT PUNCH', opponentAction: 'straight-punch', mark: '▣' },
]);

const MOVE_BY_ID = new Map(BOXING_MOVES.map((move) => [move.id, move]));
const pointVisible = (point) => point && (point.visibility ?? 1) >= 0.45;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function jointAngle(a, b, c) {
  const first = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const second = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const denominator = Math.hypot(...first) * Math.hypot(...second);
  if (!denominator) return 0;
  const cosine = Math.max(-1, Math.min(1, first.reduce((sum, value, index) => sum + value * second[index], 0) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

export class PunchMotionDetector {
  constructor({ calibrationFrames = 8 } = {}) {
    if (!Number.isInteger(calibrationFrames) || calibrationFrames < 1) {
      throw new TypeError('Punch calibration frame count must be a positive integer');
    }
    this.calibrationFrames = calibrationFrames;
    this.reset();
  }

  reset() {
    this.arms = {
      left: { samples: [], baseline: null, smoothedForward: null, latched: false },
      right: { samples: [], baseline: null, smoothedForward: null, latched: false },
    };
  }

  update(worldLandmarks) {
    if (!worldLandmarks || worldLandmarks.length < 17) return null;
    const observations = [
      ['left', 'punch-left', 11, 13, 15],
      ['right', 'punch-right', 12, 14, 16],
    ];
    const detected = [];

    for (const [side, move, shoulderIndex, elbowIndex, wristIndex] of observations) {
      const shoulder = worldLandmarks[shoulderIndex];
      const elbow = worldLandmarks[elbowIndex];
      const wrist = worldLandmarks[wristIndex];
      if (![shoulder, elbow, wrist].every(pointVisible)) continue;

      const arm = this.arms[side];
      const forward = shoulder.z - wrist.z;
      const angle = jointAngle(shoulder, elbow, wrist);
      const upperArmLength = Math.hypot(
        shoulder.x - elbow.x,
        shoulder.y - elbow.y,
        shoulder.z - elbow.z,
      );

      if (!arm.baseline) {
        arm.samples.push({ forward, angle, upperArmLength });
        if (arm.samples.length >= this.calibrationFrames) {
          const average = (key) => arm.samples.reduce((sum, sample) => sum + sample[key], 0) / arm.samples.length;
          arm.baseline = {
            forward: average('forward'),
            angle: average('angle'),
            upperArmLength: average('upperArmLength'),
          };
          arm.smoothedForward = arm.baseline.forward;
        }
        continue;
      }

      arm.smoothedForward += (forward - arm.smoothedForward) * 0.5;
      const advance = arm.smoothedForward - arm.baseline.forward;
      const depthThreshold = Math.max(0.045, arm.baseline.upperArmLength * 0.18);
      const elbowExtended = angle >= 120
        || (angle >= 105 && angle - arm.baseline.angle >= 14);

      if (arm.latched) {
        if (advance < depthThreshold * 0.45 || angle < 95) arm.latched = false;
      } else if (advance >= depthThreshold && elbowExtended) {
        arm.latched = true;
        detected.push({ move, strength: advance / depthThreshold });
      }
    }

    detected.sort((a, b) => b.strength - a.strength);
    return detected[0]?.move || null;
  }
}

export function calibrateBoxingPose(landmarks) {
  if (!landmarks || landmarks.length < 25) return null;
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every(pointVisible)) return null;
  const shoulders = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  const torsoHeight = Math.max(Math.abs(hips.y - shoulders.y), 0.08);
  return {
    shoulderY: shoulders.y,
    hipY: hips.y,
    torsoHeight,
    shoulderWidth: Math.max(Math.abs(rightShoulder.x - leftShoulder.x), 0.08),
    torsoLean: (shoulders.x - hips.x) / Math.max(Math.abs(rightShoulder.x - leftShoulder.x), 0.08),
  };
}

export function detectBoxingMove(landmarks, worldLandmarks, baseline) {
  if (!landmarks || !baseline || landmarks.length < 25) return null;
  const ls = landmarks[11]; const rs = landmarks[12];
  const le = landmarks[13]; const re = landmarks[14];
  const lw = landmarks[15]; const rw = landmarks[16];
  const lh = landmarks[23]; const rh = landmarks[24];
  const nose = landmarks[0];
  if (![ls, rs, le, re, lw, rw, lh, rh].every(pointVisible)) return null;

  const torsoHeight = Math.max(Math.abs(midpoint(lh, rh).y - midpoint(ls, rs).y), baseline.torsoHeight * 0.55);
  const leftElbowAngle = jointAngle(ls, le, lw);
  const rightElbowAngle = jointAngle(rs, re, rw);
  const faceY = pointVisible(nose) ? nose.y : Math.min(ls.y, rs.y);
  const leftGuard = lw.y < faceY + torsoHeight * 0.12 && leftElbowAngle < 145;
  const rightGuard = rw.y < faceY + torsoHeight * 0.12 && rightElbowAngle < 145;
  if (leftGuard && rightGuard) return 'block';

  const shoulders = midpoint(ls, rs);
  if (shoulders.y > baseline.shoulderY + baseline.torsoHeight * 0.19) return 'duck';

  const hips = midpoint(lh, rh);
  const currentLean = (shoulders.x - hips.x) / Math.max(Math.abs(rs.x - ls.x), 0.08);
  const leanDelta = currentLean - baseline.torsoLean;
  if (leanDelta > 0.22) return 'move-left';
  if (leanDelta < -0.22) return 'move-right';
  return null;
}

export function generateBoxingSequence(length = 24, random = Math.random) {
  const sequence = [];
  while (sequence.length < length) {
    const choices = BOXING_MOVES.filter((move) => move.id !== sequence.at(-1));
    const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
    sequence.push(choices[index].id);
  }
  return sequence;
}

export class BoxingRound {
  constructor({ durationMs = 45000, leadInMs = 3000, intervalMs = 3000, responseMs = 2700 } = {}) {
    this.durationMs = durationMs;
    this.leadInMs = leadInMs;
    this.intervalMs = intervalMs;
    this.responseMs = responseMs;
    this.reset();
  }

  reset() {
    this.active = false;
    this.startedAt = 0;
    this.sequence = [];
    this.answered = new Set();
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.feedback = 'Start a round when you are ready';
  }

  start(now, sequence = generateBoxingSequence()) {
    if (!Number.isFinite(now)) throw new TypeError('Round start time must be finite');
    if (!Array.isArray(sequence) || sequence.length === 0 || sequence.some((id) => !MOVE_BY_ID.has(id))) {
      throw new TypeError('Round sequence must contain known boxing moves');
    }
    this.reset();
    this.active = true;
    this.startedAt = now;
    this.sequence = [...sequence];
    this.feedback = 'Get ready';
  }

  tick(now, detectedMove = null) {
    if (!Number.isFinite(now)) throw new TypeError('Round time must be finite');
    if (!this.active) return { ...this.snapshot(now), recordedMove: null, recordedCueIndex: null, missedCues: [] };

    let recordedMove = null;
    let recordedCueIndex = null;
    const missedCues = [];
    const elapsed = now - this.startedAt;
    const cueIndex = Math.floor((elapsed - this.leadInMs) / this.intervalMs);
    for (let index = 0; index < this.sequence.length; index++) {
      const cueStart = this.startedAt + this.leadInMs + index * this.intervalMs;
      if (now > cueStart + this.responseMs && !this.answered.has(index)) {
        this.answered.add(index);
        this.streak = 0;
        const move = this.sequence[index];
        const isDefense = ['move-left', 'move-right', 'duck', 'block'].includes(move);
        missedCues.push({ index, move, wasHit: isDefense });
        this.feedback = isDefense ? 'Hit! The opponent got through' : 'Missed — reset and catch the next move';
      }
    }

    if (cueIndex >= 0 && cueIndex < this.sequence.length && now <= this.startedAt + this.durationMs) {
      const cueStart = this.startedAt + this.leadInMs + cueIndex * this.intervalMs;
      if (now <= cueStart + this.responseMs && !this.answered.has(cueIndex)
        && detectedMove === this.sequence[cueIndex]) {
        this.answered.add(cueIndex);
        this.score += 100 + this.streak * 10;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.feedback = `Nice ${MOVE_BY_ID.get(detectedMove).label.toLowerCase()}!`;
        recordedMove = detectedMove;
        recordedCueIndex = cueIndex;
      }
    }

    if (elapsed >= this.durationMs) {
      this.active = false;
      this.feedback = `Round complete · ${this.score} points`;
    }
    return { ...this.snapshot(now), recordedMove, recordedCueIndex, missedCues };
  }

  snapshot(now) {
    const elapsed = this.active ? Math.max(0, now - this.startedAt) : this.durationMs;
    const cueIndex = Math.max(0, Math.floor((elapsed - this.leadInMs) / this.intervalMs));
    const firstCue = Math.min(cueIndex, this.sequence.length - 1);
    const cues = this.sequence.slice(firstCue, firstCue + 4).map((id, offset) => {
      const index = firstCue + offset;
      const startsAt = this.startedAt + this.leadInMs + index * this.intervalMs;
      const isCurrent = this.active && now >= startsAt && now <= startsAt + this.responseMs;
      return {
        ...MOVE_BY_ID.get(id),
        index,
        state: this.answered.has(index) ? 'done' : (isCurrent ? 'now' : 'upcoming'),
        inMs: Math.max(0, startsAt - now),
      };
    });
    return {
      active: this.active,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      remainingMs: Math.max(0, this.durationMs - elapsed),
      cues,
      feedback: this.feedback,
    };
  }
}
