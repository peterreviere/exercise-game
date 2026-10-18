export const visible = (point, minimum = .48) => Boolean(point && (point.visibility ?? 1) >= minimum);
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// MediaPipe coordinates are camera-oriented. x is flipped here to match the
// mirrored preview and the game world that the player sees.
export function screenPoint(point) {
  return point ? { x: 1 - point.x, y: point.y, visibility: point.visibility ?? 1 } : null;
}

export function wristPositions(points) {
  if (!points) return [];
  return [15, 16].filter(index => visible(points[index])).map(index => ({
    index,
    side: index === 15 ? 'right' : 'left',
    ...screenPoint(points[index]),
  }));
}

export function wristNear(points, target, radius = .14, wristIndex = null) {
  return wristPositions(points)
    .filter(wrist => wristIndex === null || wrist.index === wristIndex)
    .find(wrist => distance(wrist, target) <= radius) || null;
}

export function bodyMetrics(points) {
  const missing = { valid: false, lean: 0, armsWide: false, diagonal: false, neutral: false,
    leftKnee: false, rightKnee: false, leftHandUp: false, rightHandUp: false, squat: 0 };
  if (!points || ![11, 12, 23, 24].every(index => visible(points[index], .35))) return missing;
  const shoulders = midpoint(points[11], points[12]);
  const hips = midpoint(points[23], points[24]);
  const shoulderWidth = Math.max(distance(points[11], points[12]), .08);
  const torso = Math.max(distance(shoulders, hips), .12);
  const lean = (hips.x - shoulders.x) / shoulderWidth;
  const wrists = wristPositions(points);
  const armsWide = wrists.length === 2
    && Math.abs(wrists[0].x - wrists[1].x) > shoulderWidth * 2.15
    && wrists.every(wrist => Math.abs(wrist.y - shoulders.y) < torso * .7);
  const diagonal = wrists.some(wrist => wrist.y < shoulders.y - torso * .25
    && Math.abs(wrist.x - (1 - shoulders.x)) > shoulderWidth * .7);
  const kneeLift = index => visible(points[index], .35)
    && points[index].y < hips.y + torso * .7;
  const handUp = index => visible(points[index], .35)
    && points[index].y < shoulders.y - torso * .12;
  return {
    valid: true,
    lean,
    armsWide,
    diagonal,
    neutral: Math.abs(lean) < .15,
    leftKnee: kneeLift(25),
    rightKnee: kneeLift(26),
    rightHandUp: handUp(15),
    leftHandUp: handUp(16),
    squat: (hips.y - shoulders.y) / shoulderWidth,
  };
}

export function crossedThreshold(value, previous, threshold) {
  return value >= threshold && previous < threshold;
}

export function movementThreshold(rangeSetting) {
  return [0.72, 1, 1.23][Number(rangeSetting) || 0];
}
