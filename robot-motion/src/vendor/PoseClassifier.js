const IDX = Object.freeze({
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
});

export const POSE_LIBRARY = Object.freeze([
  { id: 'overhead_reach', name: 'Overhead Reach', group: 'Upper-body stretches', cue: 'Raise one arm straight above your head.', target: 'Shoulders and side body' },
  { id: 'double_overhead_reach', name: 'Double Overhead Reach', group: 'Upper-body stretches', cue: 'Raise both arms straight above your head.', target: 'Shoulders and upper back' },
  { id: 'cross_body_shoulder', name: 'Cross-Body Shoulder Stretch', group: 'Upper-body stretches', cue: 'Bring one straight arm across your chest.', target: 'Rear shoulder' },
  { id: 't_pose', name: 'T-Pose', group: 'Upper-body stretches', cue: 'Extend both arms horizontally to your sides.', target: 'Chest and shoulders' },
  { id: 'y_pose', name: 'Y-Pose', group: 'Upper-body stretches', cue: 'Reach both arms diagonally upward.', target: 'Shoulders and upper back' },
  { id: 'chest_opener', name: 'Chest Opener', group: 'Upper-body stretches', cue: 'Make a goalpost shape and open your elbows outward.', target: 'Chest and shoulders' },
  { id: 'side_stretch', name: 'Side Stretch', group: 'Upper-body stretches', cue: 'Reach one arm overhead and lean gently away.', target: 'Side body' },
  { id: 'forward_arm_extension', name: 'Forward Arm Extension', group: 'Upper-body stretches', cue: 'Reach both arms forward at shoulder height.', target: 'Upper back and shoulders' },
  { id: 'triceps_stretch', name: 'Triceps Stretch', group: 'Upper-body stretches', cue: 'Bend one raised elbow and bring your hand behind your head.', target: 'Triceps and shoulder' },
  { id: 'neck_side_stretch', name: 'Neck Side Stretch', group: 'Upper-body stretches', cue: 'Tilt your head gently toward one shoulder.', target: 'Side of neck' },
  { id: 'arm_circles', name: 'Arm Circles', group: 'Upper-body mobility', cue: 'Keep your arms long and trace controlled circles.', target: 'Shoulder mobility', dynamic: true },
  { id: 'shoulder_shrugs', name: 'Shoulder Shrugs', group: 'Upper-body mobility', cue: 'Lift both shoulders toward your ears, then release.', target: 'Neck and shoulders', dynamic: true },
  { id: 'torso_side_bend', name: 'Torso Side Bend', group: 'Upper-body mobility', cue: 'Lean your upper body gently left or right.', target: 'Trunk mobility' },
  { id: 'elbow_flexion', name: 'Elbow Flexion', group: 'Upper-body mobility', cue: 'Bend one elbow and bring your hand toward your shoulder.', target: 'Elbow and biceps' },
  { id: 'alternating_arm_raises', name: 'Alternating Arm Raises', group: 'Upper-body mobility', cue: 'Raise one arm as the other lowers, then switch.', target: 'Shoulder coordination', dynamic: true },
  { id: 'diagonal_arm_reach', name: 'Diagonal Arm Reach', group: 'Upper-body mobility', cue: 'Reach one arm long on a diagonal.', target: 'Shoulder and trunk' },
  { id: 'overhead_arm_pulses', name: 'Overhead Arm Pulses', group: 'Upper-body mobility', cue: 'Pulse both raised arms slowly up and down.', target: 'Shoulder mobility', dynamic: true },
  { id: 'seated_row', name: 'Seated Row Motion', group: 'Upper-body mobility', cue: 'Pull both elbows back beside your ribs.', target: 'Upper back' },
  { id: 'x_pose', name: 'X-Pose', group: 'Gameplay poses', cue: 'Reach your arms diagonally and stand wide to form an X.', target: 'Full-body coordination' },
  { id: 'hands_together', name: 'Hands Together', group: 'Gameplay poses', cue: 'Bring both hands together in front of your chest.', target: 'Coordination' },
]);

const META = new Map(POSE_LIBRARY.map((item) => [item.id, item]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
const visible = (...points) => points.every((point) => point && (point.visibility ?? 1) >= 0.4);

function angle(a, b, c) {
  const first = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const second = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const denominator = Math.hypot(...first) * Math.hypot(...second);
  if (!denominator) return 180;
  const cosine = Math.max(-1, Math.min(1, first.reduce((sum, value, index) => sum + value * second[index], 0) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

function detection(id, confidence) {
  return { ...META.get(id), confidence: Math.min(0.99, Number(confidence.toFixed(3))) };
}

export function classifyPose(landmarks, worldLandmarks = []) {
  if (!landmarks || landmarks.length < 29) return [];
  const p = (name) => landmarks[IDX[name]];
  const ls = p('leftShoulder'); const rs = p('rightShoulder');
  const lh = p('leftHip'); const rh = p('rightHip');
  if (!visible(ls, rs, lh, rh)) return [];
  const le = p('leftElbow'); const re = p('rightElbow');
  const lw = p('leftWrist'); const rw = p('rightWrist');
  const la = p('leftAnkle'); const ra = p('rightAnkle');
  const nose = p('nose'); const leftEar = p('leftEar'); const rightEar = p('rightEar');
  const shoulderWidth = Math.max(distance(ls, rs), 0.02);
  const shoulderMid = midpoint(ls, rs); const hipMid = midpoint(lh, rh);
  const torso = Math.max(distance(shoulderMid, hipMid), shoulderWidth);
  const leftAngle = visible(ls, le, lw) ? angle(ls, le, lw) : 0;
  const rightAngle = visible(rs, re, rw) ? angle(rs, re, rw) : 0;
  const leftUp = visible(ls, le, lw) && lw.y < ls.y - torso * 0.22 && leftAngle > 138;
  const rightUp = visible(rs, re, rw) && rw.y < rs.y - torso * 0.22 && rightAngle > 138;
  const leftOut = visible(ls, lw) && Math.abs(lw.x - ls.x) > shoulderWidth * 0.52;
  const rightOut = visible(rs, rw) && Math.abs(rw.x - rs.x) > shoulderWidth * 0.52;
  const lean = (shoulderMid.x - hipMid.x) / shoulderWidth;
  const candidates = [];

  if (leftUp !== rightUp) candidates.push(detection('overhead_reach', 0.84));
  if (leftUp && rightUp) {
    candidates.push(detection('double_overhead_reach', 0.88));
    if (leftOut && rightOut) candidates.push(detection('y_pose', 0.93));
  }

  const leftHorizontal = visible(ls, le, lw) && Math.abs(lw.y - ls.y) < torso * 0.30 && leftOut && leftAngle > 145;
  const rightHorizontal = visible(rs, re, rw) && Math.abs(rw.y - rs.y) < torso * 0.30 && rightOut && rightAngle > 145;
  if (leftHorizontal && rightHorizontal) candidates.push(detection('t_pose', 0.94));

  const leftCross = visible(lw, le) && lw.x < shoulderMid.x - shoulderWidth * 0.08
    && Math.abs(lw.y - shoulderMid.y) < torso * 0.55 && leftAngle > 120;
  const rightCross = visible(rw, re) && rw.x > shoulderMid.x + shoulderWidth * 0.08
    && Math.abs(rw.y - shoulderMid.y) < torso * 0.55 && rightAngle > 120;
  if (leftCross || rightCross) candidates.push(detection('cross_body_shoulder', 0.92));

  const leftGoalpost = visible(le, lw) && Math.abs(le.y - ls.y) < torso * 0.30
    && lw.y < le.y - torso * 0.12 && leftAngle > 62 && leftAngle < 120;
  const rightGoalpost = visible(re, rw) && Math.abs(re.y - rs.y) < torso * 0.30
    && rw.y < re.y - torso * 0.12 && rightAngle > 62 && rightAngle < 120;
  if (leftGoalpost && rightGoalpost && distance(le, re) > shoulderWidth * 1.15) {
    candidates.push(detection('chest_opener', 0.94));
  }

  if ((leftUp || rightUp) && Math.abs(lean) > 0.20) candidates.push(detection('side_stretch', 0.96));
  if (Math.abs(lean) > 0.22) candidates.push(detection('torso_side_bend', 0.88 + Math.min(0.08, Math.abs(lean) * 0.12)));

  const leftTriceps = visible(le, lw, nose) && le.y < ls.y - torso * 0.08 && leftAngle < 105
    && distance(lw, nose) < shoulderWidth * 1.05;
  const rightTriceps = visible(re, rw, nose) && re.y < rs.y - torso * 0.08 && rightAngle < 105
    && distance(rw, nose) < shoulderWidth * 1.05;
  if (leftTriceps || rightTriceps) candidates.push(detection('triceps_stretch', 0.93));

  if ((leftAngle > 0 && leftAngle < 100) || (rightAngle > 0 && rightAngle < 100)) {
    candidates.push(detection('elbow_flexion', 0.82));
  }

  const leftDiagonal = visible(ls, lw) && leftAngle > 140 && leftOut && Math.abs(lw.y - ls.y) > torso * 0.24;
  const rightDiagonal = visible(rs, rw) && rightAngle > 140 && rightOut && Math.abs(rw.y - rs.y) > torso * 0.24;
  if (leftDiagonal !== rightDiagonal) candidates.push(detection('diagonal_arm_reach', 0.90));

  if (visible(leftEar, rightEar)) {
    const earTilt = Math.abs(Math.atan2(rightEar.y - leftEar.y, Math.abs(rightEar.x - leftEar.x)) * 180 / Math.PI);
    const shoulderTilt = Math.abs(Math.atan2(rs.y - ls.y, Math.abs(rs.x - ls.x)) * 180 / Math.PI);
    if (earTilt > 10 && shoulderTilt < 9) candidates.push(detection('neck_side_stretch', 0.86 + Math.min(0.08, earTilt / 180)));
  }

  const handsTogether = visible(lw, rw) && distance(lw, rw) < shoulderWidth * 0.48
    && (lw.y + rw.y) / 2 > shoulderMid.y - torso * 0.15
    && (lw.y + rw.y) / 2 < hipMid.y + torso * 0.15;
  if (handsTogether) candidates.push(detection('hands_together', 0.95));

  const bothBent = leftAngle > 55 && leftAngle < 120 && rightAngle > 55 && rightAngle < 120;
  const elbowsLevel = visible(le, re) && Math.abs(le.y - ls.y) < torso * 0.55 && Math.abs(re.y - rs.y) < torso * 0.55;
  if (bothBent && elbowsLevel && distance(le, re) > distance(lw, rw) * 1.12) candidates.push(detection('seated_row', 0.88));

  if (worldLandmarks.length >= 17 && visible(lw, rw)) {
    const wls = worldLandmarks[IDX.leftShoulder]; const wrs = worldLandmarks[IDX.rightShoulder];
    const wlw = worldLandmarks[IDX.leftWrist]; const wrw = worldLandmarks[IDX.rightWrist];
    const forwardDepth = ((wls.z - wlw.z) + (wrs.z - wrw.z)) / 2;
    if (forwardDepth > 0.16 && Math.abs(lw.y - shoulderMid.y) < torso * 0.45
      && Math.abs(rw.y - shoulderMid.y) < torso * 0.45 && leftAngle > 135 && rightAngle > 135) {
      candidates.push(detection('forward_arm_extension', 0.91));
    }
  }

  const wideFeet = visible(la, ra) && distance(la, ra) > shoulderWidth * 1.45;
  const leftDownDiagonal = visible(ls, lw) && lw.y > ls.y + torso * 0.30 && leftOut && leftAngle > 140;
  const rightDownDiagonal = visible(rs, rw) && rw.y > rs.y + torso * 0.30 && rightOut && rightAngle > 140;
  if (wideFeet && ((leftUp && rightUp && leftOut && rightOut) || (leftDownDiagonal && rightDownDiagonal))) {
    candidates.push(detection('x_pose', 0.98));
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

export class PoseClassifier {
  constructor() {
    this.history = [];
  }

  reset() {
    this.history = [];
  }

  update(landmarks, worldLandmarks, timestamp) {
    const staticDetections = classifyPose(landmarks, worldLandmarks);
    if (!landmarks?.length) return staticDetections;
    const ls = landmarks[IDX.leftShoulder]; const rs = landmarks[IDX.rightShoulder];
    const lh = landmarks[IDX.leftHip]; const rh = landmarks[IDX.rightHip];
    const lw = landmarks[IDX.leftWrist]; const rw = landmarks[IDX.rightWrist];
    const le = landmarks[IDX.leftEar]; const re = landmarks[IDX.rightEar];
    if (!visible(ls, rs, lh, rh, lw, rw)) return staticDetections;
    const shoulderMid = midpoint(ls, rs); const hipMid = midpoint(lh, rh);
    const scale = Math.max(distance(ls, rs), distance(shoulderMid, hipMid), 0.02);
    const leftUp = lw.y < ls.y - scale * 0.22;
    const rightUp = rw.y < rs.y - scale * 0.22;
    this.history.push({
      timestamp,
      leftWrist: { x: (lw.x - shoulderMid.x) / scale, y: (lw.y - shoulderMid.y) / scale },
      rightWrist: { x: (rw.x - shoulderMid.x) / scale, y: (rw.y - shoulderMid.y) / scale },
      wristY: ((lw.y + rw.y) / 2 - shoulderMid.y) / scale,
      shoulderEar: visible(le, re) ? (distance(ls, le) + distance(rs, re)) / (2 * scale) : null,
      leftOnly: leftUp && !rightUp,
      rightOnly: rightUp && !leftUp,
      bothUp: leftUp && rightUp,
    });
    this.history = this.history.filter((sample) => timestamp - sample.timestamp <= 2200);
    if (this.history.length < 4) return staticDetections;

    const dynamic = [];
    const recent = this.history.filter((sample) => timestamp - sample.timestamp <= 1700);
    if (recent.some((sample) => sample.leftOnly) && recent.some((sample) => sample.rightOnly)) {
      dynamic.push(detection('alternating_arm_raises', 0.97));
    }
    if (recent.every((sample) => sample.bothUp)) {
      const wristValues = recent.map((sample) => sample.wristY);
      if (Math.max(...wristValues) - Math.min(...wristValues) > 0.16) dynamic.push(detection('overhead_arm_pulses', 0.96));
    }
    const shoulderEarValues = recent.map((sample) => sample.shoulderEar).filter((value) => value !== null);
    if (shoulderEarValues.length >= 4 && Math.max(...shoulderEarValues) - Math.min(...shoulderEarValues) > 0.10) {
      dynamic.push(detection('shoulder_shrugs', 0.94));
    }
    const circleScore = ['leftWrist', 'rightWrist'].some((key) => {
      const points = recent.map((sample) => sample[key]);
      const xRange = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
      const yRange = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
      const path = points.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
      return xRange > 0.30 && yRange > 0.30 && path > 1.15;
    });
    if (circleScore) dynamic.push(detection('arm_circles', 0.95));

    const merged = [...dynamic, ...staticDetections];
    return merged.filter((item, index) => merged.findIndex((other) => other.id === item.id) === index)
      .sort((a, b) => b.confidence - a.confidence);
  }
}
