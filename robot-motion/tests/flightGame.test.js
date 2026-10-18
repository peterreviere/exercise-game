import test from 'node:test';
import assert from 'node:assert/strict';
import { flightInput, FlightRace, WingFlightController } from '../src/flightGame.js';

function landmarks({ lean = 0, wristY = 0.5, wide = false } = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[11] = { x: 0.4 + lean, y: 0.35, visibility: 1 };
  points[12] = { x: 0.6 + lean, y: 0.35, visibility: 1 };
  points[13] = { x: wide ? 0.29 : 0.41, y: wide ? 0.35 : 0.48, visibility: 1 };
  points[14] = { x: wide ? 0.71 : 0.59, y: wide ? 0.35 : 0.48, visibility: 1 };
  points[23] = { x: 0.45, y: 0.65, visibility: 1 };
  points[24] = { x: 0.55, y: 0.65, visibility: 1 };
  points[15] = { x: wide ? 0.18 : 0.42, y: wristY, visibility: 1 };
  points[16] = { x: wide ? 0.82 : 0.58, y: wristY, visibility: 1 };
  return points;
}

test('maps body lean and wings-out pose to flight controls', () => {
  const left = flightInput(landmarks({ lean: 0.08 }));
  assert.ok(left.x < -0.9);
  assert.ok(flightInput(landmarks({ wristY: 0.15 })).wingHeight > 0.6);
  assert.ok(flightInput(landmarks({ wristY: 0.7 })).wingHeight < -1);
  assert.equal(flightInput(landmarks({ wristY: 0.35, wide: true })).gliding, true);
});

test('keeps left and right arm height separate for the rear-view wings', () => {
  const points = landmarks();
  points[15].y = 0.15;
  points[16].y = 0.65;
  const input = flightInput(points);
  assert.ok(input.leftWingHeight > 0.6);
  assert.ok(input.rightWingHeight < -0.9);
});

test('returns neutral inactive controls when core landmarks are hidden', () => {
  const points = landmarks();
  points[15].visibility = 0;
  assert.deepEqual(flightInput(points), { x: 0, wingHeight: 0, wingReach: 0, dive: 0, gliding: false, active: false });
});

test('rejects a bent-arm near-T pose and reads forward torso pitch as a dive', () => {
  const bent = landmarks({ wristY: 0.35, wide: true });
  bent[13] = { x: 0.36, y: 0.5, visibility: 1 };
  assert.equal(flightInput(bent).gliding, false);

  const image = landmarks({ wristY: 0.35, wide: true });
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  world[11] = { x: -0.2, y: 0.5, z: -0.25, visibility: 1 };
  world[12] = { x: 0.2, y: 0.5, z: -0.25, visibility: 1 };
  world[23] = { x: -0.15, y: 0, z: 0, visibility: 1 };
  world[24] = { x: 0.15, y: 0, z: 0, visibility: 1 };
  assert.ok(flightInput(image, world).dive > 0.7);
});

test('detects a deliberate downward flap but not a held pose', () => {
  const controller = new WingFlightController();
  assert.equal(controller.update(landmarks({ wristY: 0.15, wide: true }), 1000).flap, false);
  assert.equal(controller.update(landmarks({ wristY: 0.58, wide: true }), 1240).flap, true);
  assert.equal(controller.update(landmarks({ wristY: 0.58, wide: true }), 1300).flap, false);
});

test('scores rings with combo bonuses and resets combo on a miss', () => {
  const race = new FlightRace();
  race.start(0);
  assert.equal(race.recordRing(true), 100);
  assert.equal(race.recordRing(true), 125);
  assert.equal(race.score, 225);
  race.recordRing(false);
  assert.equal(race.combo, 0);
  assert.equal(race.recordRing(true), 100);
});

test('finishes on time and reports the final solo run', () => {
  const race = new FlightRace({ durationMs: 1000 });
  race.start(200);
  race.recordRing(true);
  assert.equal(race.update(1199), null);
  assert.deepEqual(race.update(1200), { score: 100, rings: 1 });
});
