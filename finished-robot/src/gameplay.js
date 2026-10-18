export const LANES = Object.freeze([-1.32, 0, 1.32]);
export const TILE_SIZE = 0.66;
export const APERTURE_ROWS = Object.freeze([3, 4, 5, 5, 4, 3]);

export function chooseWallLane(random = Math.random) {
  return Math.min(LANES.length - 1, Math.floor(random() * LANES.length));
}

export function isAligned(playerX, openingX) {
  return Math.abs(playerX - openingX) <= 0.33;
}

export function poseLean(landmarks) {
  if (!landmarks || landmarks.length < 25) return null;
  const visible = index => {
    const point = landmarks[index];
    return point && Number.isFinite(point.x) && (point.visibility ?? 1) > 0.45;
  };
  if (![11, 12, 23, 24].every(visible)) return null;

  const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
  if (shoulderWidth < 0.08) return null;
  const shoulderCenter = (landmarks[11].x + landmarks[12].x) / 2;
  const hipCenter = (landmarks[23].x + landmarks[24].x) / 2;
  return (shoulderCenter - hipCenter) / shoulderWidth;
}

export function laneFromLean(lean) {
  if (!Number.isFinite(lean)) return null;
  if (lean > 0.18) return 0;
  if (lean < -0.18) return 2;
  return 1;
}
