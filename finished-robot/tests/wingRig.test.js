import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RobotWingRig } from '../src/wingRig.js';

async function loadExportedWings() {
  const bytes = readFileSync(new URL('../public/robot/robot_wings.glb', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return (await new GLTFLoader().parseAsync(buffer, '')).scene;
}

function wingFixture() {
  const root = new Group();
  const left = new Object3D();
  const right = new Object3D();
  left.name = 'WingPivotLeft';
  right.name = 'WingPivotRight';
  left.rotation.z = 0.08;
  right.rotation.z = -0.06;
  root.add(left, right);
  return { root, left, right };
}

test('raises the two wing pivots symmetrically with the player arms', () => {
  const { root, left, right } = wingFixture();
  const rig = new RobotWingRig(root);
  rig.update({ active: true, wingHeight: 1, flap: false }, 0.05);
  assert.ok(left.rotation.z > 0.08);
  assert.ok(right.rotation.z < -0.06);
  assert.ok(Math.abs((left.rotation.z - 0.08) + (right.rotation.z + 0.06)) < 1e-9);
});

test('a detected downstroke visibly drives the wings down', () => {
  const { root, left, right } = wingFixture();
  const rig = new RobotWingRig(root);
  rig.update({ active: true, wingHeight: -0.9, flap: true }, 0.05);
  assert.ok(left.rotation.z < 0.08);
  assert.ok(right.rotation.z > -0.06);
});

test('rear-view left and right player arms drive their matching wings', () => {
  const { root, left, right } = wingFixture();
  const rig = new RobotWingRig(root);
  const values = rig.update({
    active: true,
    wingHeight: 0,
    leftWingHeight: 1,
    rightWingHeight: -1,
    flap: false,
  }, 0.05);
  assert.ok(values.left > 0);
  assert.ok(values.right < 0);
  assert.ok(left.rotation.z > 0.08);
  assert.ok(right.rotation.z > -0.06);
});

test('inactive tracking eases the wings back to their authored pose', () => {
  const { root, left, right } = wingFixture();
  const rig = new RobotWingRig(root);
  rig.update({ active: true, wingHeight: 1, flap: false }, 0.05);
  for (let frame = 0; frame < 120; frame += 1) rig.update({ active: false }, 1 / 60);
  assert.ok(Math.abs(left.rotation.z - 0.08) < 1e-6);
  assert.ok(Math.abs(right.rotation.z + 0.06) < 1e-6);
});

test('rejects a wing asset without both named hinge nodes', () => {
  assert.throws(() => new RobotWingRig(new Group()), /pivot node/);
});

test('the exported wing asset exposes both animated hinge nodes', async () => {
  const root = await loadExportedWings();
  const rig = new RobotWingRig(root);
  assert.equal(rig.left.name, 'WingPivotLeft');
  assert.equal(rig.right.name, 'WingPivotRight');
  assert.ok(root.getObjectByName('WingPivotLeft').children.length > 0);
  assert.ok(root.getObjectByName('WingPivotRight').children.length > 0);
});
