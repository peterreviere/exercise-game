import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoxingRound,
  PunchMotionDetector,
  calibrateBoxingPose,
  detectBoxingMove,
  generateBoxingSequence,
} from '../src/boxingGame.js';
import { BoxingOpponent } from '../src/boxingOpponent.js';
import { Vector3 } from 'three';

function neutralPose() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  points[0] = { x: 0.5, y: 0.16, z: 0, visibility: 1 };
  points[11] = { x: 0.42, y: 0.3, z: 0, visibility: 1 };
  points[12] = { x: 0.58, y: 0.3, z: 0, visibility: 1 };
  points[13] = { x: 0.38, y: 0.43, z: 0, visibility: 1 };
  points[14] = { x: 0.62, y: 0.43, z: 0, visibility: 1 };
  points[15] = { x: 0.42, y: 0.5, z: 0, visibility: 1 };
  points[16] = { x: 0.58, y: 0.5, z: 0, visibility: 1 };
  points[23] = { x: 0.45, y: 0.65, z: 0, visibility: 1 };
  points[24] = { x: 0.55, y: 0.65, z: 0, visibility: 1 };
  return points;
}

test('boxing pose calibration requires visible shoulders and hips', () => {
  const pose = neutralPose();
  assert.ok(calibrateBoxingPose(pose));
  pose[23].visibility = 0;
  assert.equal(calibrateBoxingPose(pose), null);
});

test('boxing move detector recognizes torso leans without whole-body side steps and a duck', () => {
  const pose = neutralPose();
  const baseline = calibrateBoxingPose(pose);
  pose[11].x += 0.04;
  pose[12].x += 0.04;
  assert.equal(detectBoxingMove(pose, [], baseline), 'move-left');

  const leanRight = neutralPose();
  leanRight[11].x -= 0.04;
  leanRight[12].x -= 0.04;
  assert.equal(detectBoxingMove(leanRight, [], baseline), 'move-right');

  const sideStep = neutralPose();
  for (const index of [11, 12, 13, 14, 15, 16, 23, 24]) sideStep[index].x += 0.12;
  assert.equal(detectBoxingMove(sideStep, [], baseline), null);

  const duck = neutralPose();
  duck[11].y += 0.08;
  duck[12].y += 0.08;
  assert.equal(detectBoxingMove(duck, [], baseline), 'duck');
});

test('boxing move detector recognizes a two-hand guard', () => {
  const baselinePose = neutralPose();
  const baseline = calibrateBoxingPose(baselinePose);
  const guard = neutralPose();
  guard[13] = { x: 0.35, y: 0.28, visibility: 1 };
  guard[14] = { x: 0.65, y: 0.28, visibility: 1 };
  guard[15] = { x: 0.34, y: 0.18, visibility: 1 };
  guard[16] = { x: 0.66, y: 0.18, visibility: 1 };
  assert.equal(detectBoxingMove(guard, [], baseline), 'block');

});

function punchWorldPose() {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  for (const [shoulder, elbow, wrist, side] of [[11, 13, 15, -1], [12, 14, 16, 1]]) {
    points[shoulder] = { x: side * 0.2, y: 0, z: 0, visibility: 1 };
    points[elbow] = { x: side * 0.42, y: -0.02, z: 0, visibility: 1 };
    points[wrist] = { x: side * 0.56, y: -0.16, z: 0, visibility: 1 };
  }
  return points;
}

test('punch detector calibrates a bent guard and detects relative forward wrist travel once per punch', () => {
  const detector = new PunchMotionDetector();
  const guard = punchWorldPose();
  for (let index = 0; index < 8; index++) assert.equal(detector.update(guard), null);
  assert.equal(detector.update(guard), null);

  const punch = punchWorldPose();
  punch[15].z = -0.16;
  assert.equal(detector.update(punch), 'punch-left');
  assert.equal(detector.update(punch), null);

  punch[15].z = 0;
  for (let index = 0; index < 8; index++) detector.update(punch);
  assert.equal(detector.update(punch), null);
  punch[15].z = -0.16;
  assert.equal(detector.update(punch), 'punch-left');
});

test('punch detector recognizes either arm and ignores invisible wrist landmarks', () => {
  const detector = new PunchMotionDetector();
  const guard = punchWorldPose();
  for (let index = 0; index < 8; index++) detector.update(guard);
  const punch = punchWorldPose();
  punch[16].z = -0.16;
  assert.equal(detector.update(punch), 'punch-right');
  detector.reset();
  for (let index = 0; index < 8; index++) detector.update(guard);
  punch[16].z = 0;
  punch[15].visibility = 0;
  punch[15].z = -0.16;
  assert.equal(detector.update(punch), null);
});

test('boxing round scores a matching cue once and expires missed cues', () => {
  const round = new BoxingRound();
  round.start(1000, ['punch-left', 'block']);
  assert.equal(round.tick(2500).cues[0].state, 'upcoming');
  const recorded = round.tick(4100, 'punch-left');
  assert.equal(recorded.score, 100);
  assert.equal(recorded.recordedMove, 'punch-left');
  assert.equal(recorded.recordedCueIndex, 0);
  const repeated = round.tick(4200, 'punch-left');
  assert.equal(repeated.score, 100);
  assert.equal(repeated.recordedMove, null);
  assert.equal(repeated.recordedCueIndex, null);
  const missed = round.tick(9801);
  assert.equal(missed.streak, 0);
  assert.match(missed.feedback, /Hit/);
});

test('boxing round awards streak bonuses and ends at its fixed duration', () => {
  const round = new BoxingRound();
  round.start(0, ['move-left', 'move-right']);
  round.tick(3000, 'move-left');
  const second = round.tick(6000, 'move-right');
  assert.equal(second.score, 210);
  assert.equal(second.bestStreak, 2);
  assert.equal(round.tick(45000).active, false);
});

test('boxing round reports a hit only when a defensive move was missed', () => {
  const round = new BoxingRound();
  round.start(0, ['duck', 'punch-left']);
  const hit = round.tick(5701);
  assert.deepEqual(hit.missedCues, [{ index: 0, move: 'duck', wasHit: true }]);
  assert.match(hit.feedback, /Hit/);
  const punchMiss = round.tick(8701);
  assert.deepEqual(punchMiss.missedCues, [{ index: 1, move: 'punch-left', wasHit: false }]);
});

test('boxing sequence avoids adjacent duplicate cues', () => {
  const sequence = generateBoxingSequence(100, () => 0);
  assert.equal(sequence.length, 100);
  for (let index = 1; index < sequence.length; index++) {
    assert.notEqual(sequence[index], sequence[index - 1]);
  }
});

test('boxing opponent faces the player, telegraphs scripted attacks, and resets to guard', () => {
  const opponent = new BoxingOpponent();
  const facing = opponent.group.getWorldDirection(new Vector3());
  assert.ok(facing.z < -0.99);

  opponent.update(1000, 0.1, 'high-hook', false);
  assert.ok(opponent.arms[1].rotation.x > 0.9);
  opponent.update(1200, 0.1, 'idle', false);
  assert.ok(opponent.arms[1].rotation.x < 0.9);
  assert.equal(opponent.action, 'idle');

  opponent.receiveHit(1300, 'punch-left');
  opponent.update(1400, 0.1, 'idle', false);
  assert.ok(opponent.group.position.z > opponent.baseZ, 'a landed player punch knocks the opponent back');
  opponent.dodgeAttack(1500, 'move-left');
  opponent.update(1600, 0.1, 'idle', false);
  assert.ok(opponent.group.position.x > 0, 'a successful left dodge makes the opponent swing past');
});
