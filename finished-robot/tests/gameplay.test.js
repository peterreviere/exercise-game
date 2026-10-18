import test from 'node:test';
import assert from 'node:assert/strict';
import { APERTURE_ROWS, LANES, TILE_SIZE, chooseWallLane, isAligned, laneFromLean, poseLean } from '../src/gameplay.js';

test('wall openings fit the robot and form a narrowing silhouette', () => {
  assert.ok(APERTURE_ROWS.every(width => width >= 3));
  assert.equal(APERTURE_ROWS[0], APERTURE_ROWS.at(-1));
  assert.ok(APERTURE_ROWS[2] > APERTURE_ROWS[0]);
  assert.ok(APERTURE_ROWS[0] * TILE_SIZE > 1.7);
});

test('lane selection stays within the three available positions', () => {
  assert.equal(chooseWallLane(() => 0), 0);
  assert.equal(chooseWallLane(() => 0.5), 1);
  assert.equal(chooseWallLane(() => 0.999), 2);
  assert.equal(chooseWallLane(() => 1), 2);
});

test('a pass requires the robot to line up with the opening', () => {
  assert.equal(isAligned(LANES[1], LANES[1]), true);
  assert.equal(isAligned(LANES[1] + 0.33, LANES[1]), true);
  assert.equal(isAligned(LANES[0], LANES[1]), false);
});

test('body lean steers toward the matching screen lane', () => {
  assert.equal(laneFromLean(0.2), 0);
  assert.equal(laneFromLean(-0.2), 2);
  assert.equal(laneFromLean(0), 1);
  assert.equal(laneFromLean(null), null);
});

test('pose lean uses shoulder and hip centers and ignores incomplete poses', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, visibility: 1 }));
  landmarks[11].x = 0.50;
  landmarks[12].x = 0.70;
  landmarks[23].x = 0.45;
  landmarks[24].x = 0.55;
  assert.ok(Math.abs(poseLean(landmarks) - 0.5) < 0.001);
  landmarks[24].visibility = 0.1;
  assert.equal(poseLean(landmarks), null);
  assert.equal(poseLean([]), null);
});
