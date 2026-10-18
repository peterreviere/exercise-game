import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyMetrics, screenPoint, wristNear } from '../src/game-logic.js';

const pose = () => Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }));
function basePose() {
  const p = pose();
  Object.assign(p[11], { x: .4, y: .35, visibility: 1 });
  Object.assign(p[12], { x: .6, y: .35, visibility: 1 });
  Object.assign(p[23], { x: .43, y: .65, visibility: 1 });
  Object.assign(p[24], { x: .57, y: .65, visibility: 1 });
  return p;
}

test('screen points match the mirrored camera preview', () => {
  assert.deepEqual(screenPoint({ x: .2, y: .3, visibility: 1 }), { x: .8, y: .3, visibility: 1 });
});

test('wrist target matching can lock to the wrist that grabbed an object', () => {
  const p = basePose();
  Object.assign(p[15], { x: .82, y: .5, visibility: 1 });
  Object.assign(p[16], { x: .25, y: .3, visibility: 1 });
  assert.equal(wristNear(p, { x: .18, y: .5 }, .05)?.index, 15);
  assert.equal(wristNear(p, { x: .18, y: .5 }, .05, 16), null);
});

test('gesture metrics recognize wide arms, diagonal reaching, and neutral torso', () => {
  const p = basePose();
  Object.assign(p[15], { x: .88, y: .34, visibility: 1 });
  Object.assign(p[16], { x: .12, y: .34, visibility: 1 });
  let metrics = bodyMetrics(p);
  assert.equal(metrics.armsWide, true);
  assert.equal(metrics.neutral, true);
  p[15].y = .15;
  metrics = bodyMetrics(p);
  assert.equal(metrics.diagonal, true);
});

test('lean is normalized by shoulder width', () => {
  const p = basePose();
  p[11].x -= .08; p[12].x -= .08;
  assert.ok(bodyMetrics(p).lean > .35);
});
