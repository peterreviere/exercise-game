import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DetailedPoseTracker, DETAILED_POSE_CONNECTIONS } from './vendor/DetailedPoseTracker.js';
import { MotionPipeline, ACTIONS, ACCESSIBILITY_PROFILES } from './vendor/MotionPipeline.js';
import { PoseClassifier } from './vendor/PoseClassifier.js';
import { RobotRetargeter } from './retarget.js';
import { GAMES_CONFIG } from './gamesConfig.js';
import { soundEffects } from './audioFeedback.js';
import { BoxingRound, PunchMotionDetector, calibrateBoxingPose, detectBoxingMove } from './boxingGame.js';
import { BoxingOpponent } from './boxingOpponent.js';
import { WingFlightController, FlightRace, flightInput } from './flightGame.js';
import { RobotWingRig } from './wingRig.js';
import { wristPositions, wristNear, bodyMetrics, movementThreshold } from './stretchingGame.js';

// DOM Utilities
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const miniOverlay = $('mini-overlay');
const miniCtx = miniOverlay.getContext('2d');

const status = (text) => {
  const el = $('status');
  if (el) el.textContent = text;
};

// ============================================================================
// Cookie & Preference Storage Helpers
// ============================================================================
function setCookie(name, value, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = '; expires=' + d.toUTCString();
  document.cookie = name + '=' + encodeURIComponent(value ?? '') + expires + '; path=/; SameSite=Lax';
}

function getCookie(name) {
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

function savePreference(key, value) {
  setCookie(key, value, 365);
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Ignore storage quota or security errors in iframe environments
  }
}

function getStoredPreference(key) {
  const cookieVal = getCookie(key);
  if (cookieVal !== null && cookieVal !== undefined && cookieVal !== '') {
    return cookieVal;
  }
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

// ============================================================================
// State Management
// ============================================================================
let activeCardIndex = 0;
let roundComplete = false;
let practiceDeadline = 0;
let gameCountdownTimer = null;
let gameCountdownActive = false;
let currentView = 'carousel'; // 'carousel' | 'details' | 'game'
let postureMode = 'standing'; // Standing mode only
let gripThreshold = Number(getStoredPreference('adaptmove_grip') || 0.32);
let clickSelectionMode = 'dwell'; // Always dwell mode
let dwellDurationMs = Number(getStoredPreference('adaptmove_dwell_time') || 1400); // 1000, 1400, 1800, 2300
const storedHand = getStoredPreference('adaptmove_active_hand');
let activeSelectingHand = (storedHand === 'left' || storedHand === 'right' || storedHand === 'both') ? storedHand : 'both'; // 'both' | 'right' | 'left'

let swipeCooldownUntil = 0;
let activeGame = GAMES_CONFIG[0];
const boxingRound = new BoxingRound();
const boxingPunchDetector = new PunchMotionDetector();
let boxingBaseline = null;
let boxingCueRenderKey = '';
let boxingRecordedCue = null;
let playerHitAt = -Infinity;
let playerHitSide = 0;
let playerRestPosition = null;
let playerRestRotationZ = 0;

// Hand Cursors State
const cursorLeftEl = $('hand-cursor-left');
const cursorRightEl = $('hand-cursor-right');
const stateTextLeft = $('hand-state-left');
const stateTextRight = $('hand-state-right');
const handDwellLeftEl = $('hand-dwell-left');
const handDwellRightEl = $('hand-dwell-right');

const cursorL = {
  x: -100, y: -100,
  visible: false,
  targetEl: null,
  isClosed: false,
  wasClosed: false,
  cooldownUntil: 0,
  dwellTarget: null,
  dwellStartTime: 0,
  dwellElapsed: 0,
  lastTargetSeenTime: 0,
};
const cursorR = {
  x: -100, y: -100,
  visible: false,
  targetEl: null,
  isClosed: false,
  wasClosed: false,
  cooldownUntil: 0,
  dwellTarget: null,
  dwellStartTime: 0,
  dwellElapsed: 0,
  lastTargetSeenTime: 0,
};

// Chest Pose State ("Back to Menu")
let chestPoseElapsed = 0;
let chestCooldownUntil = 0;

// ============================================================================
// Three.js 3D Setup (For Robot Motion Studio)
// ============================================================================
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  status('3D graphics unavailable. Enable hardware acceleration or try Chrome/Edge.');
  throw e;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
$('viewport').append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
const playerStage = new THREE.Group();
playerStage.name = 'Player Stage';
scene.add(playerStage);
const boxingOpponent = new BoxingOpponent();
scene.add(boxingOpponent.group);
boxingOpponent.group.visible = false;
const boxingImpact = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.22, 1),
  new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xff6b00,
    emissiveIntensity: 2.5,
    metalness: 0.25,
    roughness: 0.25,
    transparent: true,
    opacity: 0.95,
  }),
);
boxingImpact.position.set(0, 1.55, 0.05);
boxingImpact.visible = false;
scene.add(boxingImpact);
let boxingImpactAt = -Infinity;

// ============================================================================
// Flying Adventure 3D Scene Components
// ============================================================================
const flyingGroup = new THREE.Group();
flyingGroup.name = 'Flying Adventure Group';
flyingGroup.visible = false;
scene.add(flyingGroup);

const starCount = 460;
const starPositions = new Float32Array(starCount * 3);
for (let index = 0; index < starCount; index += 1) {
  starPositions[index * 3] = (Math.random() - 0.5) * 20;
  starPositions[index * 3 + 1] = Math.random() * 9 - 1;
  starPositions[index * 3 + 2] = Math.random() * -38 + 4;
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const flightStars = new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({ color: 0xbceaff, size: 0.045, transparent: true, opacity: 0.72 })
);
flyingGroup.add(flightStars);

const flightCloudMaterial = new THREE.MeshBasicMaterial({ color: 0x8dcfff, transparent: true, opacity: 0.055, depthWrite: false });
const flightClouds = Array.from({ length: 9 }, (_, index) => {
  const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + Math.random() * 1.7, 1), flightCloudMaterial);
  cloud.scale.set(2.8, 0.45, 1);
  cloud.position.set((Math.random() - 0.5) * 16, Math.random() * 6 - 0.5, -6 - index * 4.5);
  flyingGroup.add(cloud);
  return cloud;
});

const flightGateMaterial = new THREE.MeshBasicMaterial({ color: 0x2ab7ff, toneMapped: false });
const flightHaloMaterial = new THREE.MeshBasicMaterial({ color: 0x8ee6ff, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false });
const flightGates = [];
let flightGateSequence = 0;

function flightGateTarget(sequence) {
  return {
    x: Math.sin(sequence * 2.13) * 1.45,
    y: 1.5 + Math.sin(sequence * 1.37 + 0.5) * 0.95,
  };
}

function createFlightGate(index) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 18, 72), flightGateMaterial.clone());
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.14, 12, 72), flightHaloMaterial.clone());
  group.add(halo, ring);
  group.userData = { sequence: index, evaluated: false, flash: 0, ring, halo };
  flyingGroup.add(group);
  flightGates.push(group);
  return group;
}

function placeFlightGate(gate, sequence, z) {
  const target = flightGateTarget(sequence);
  gate.position.set(target.x, target.y, z);
  gate.userData.sequence = sequence;
  gate.userData.evaluated = false;
  gate.userData.flash = 0;
  gate.userData.ring.material.color.setHex(0x2ab7ff);
  gate.userData.halo.material.color.setHex(0x8ee6ff);
}

for (let index = 0; index < 6; index += 1) createFlightGate(index);

function resetFlightCourse() {
  flightGateSequence = flightGates.length;
  flightGates.forEach((gate, index) => placeFlightGate(gate, index, -7 - index * 8.2));
}
resetFlightCourse();

const engineGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 20, 12),
  new THREE.MeshBasicMaterial({ color: 0x69d9ff, transparent: true, opacity: 0.8, toneMapped: false }),
);
engineGlow.scale.set(1, 2.7, 1);
engineGlow.visible = false;
flyingGroup.add(engineGlow);

const flightRace = new FlightRace({ durationMs: 60_000 });
const wingController = new WingFlightController();
let robotWingRig = null;
let robotWingsModel = null;
let flightAltitude = 0.6;
let flightVerticalVelocity = 0;
let lastFlapVisualAt = -Infinity;
let currentFlightInput = { x: 0, wingHeight: 0, wingReach: 0, dive: 0, gliding: false, flap: false, active: false };

function renderFlightUI() {
  const timeLeftSec = Math.ceil(flightRace.timeLeft(performance.now()) / 1000);
  const mm = String(Math.floor(timeLeftSec / 60)).padStart(2, '0');
  const ss = String(timeLeftSec % 60).padStart(2, '0');
  if ($('flying-time')) $('flying-time').textContent = `${mm}:${ss}`;
  if ($('flying-score')) $('flying-score').textContent = String(flightRace.score);
  if ($('flight-score-number')) $('flight-score-number').textContent = String(flightRace.score).padStart(4, '0');
  if ($('flying-combo')) $('flying-combo').textContent = `${flightRace.combo}x`;
  if ($('flying-panel-rings')) $('flying-panel-rings').textContent = String(flightRace.rings);

  const boostPct = Math.round(((flightAltitude - (-0.35)) / (1.65 - (-0.35))) * 100);
  const clampedBoost = Math.max(8, Math.min(100, boostPct));
  if ($('flight-boost-fill')) $('flight-boost-fill').style.width = `${clampedBoost}%`;
  if ($('flight-boost-meter-fill')) $('flight-boost-meter-fill').style.width = `${clampedBoost}%`;

  if ($('pilot-state-badge')) {
    $('pilot-state-badge').textContent = flightRace.phase === 'flying'
      ? (currentFlightInput.gliding ? 'GLIDING' : 'AIRBORNE')
      : 'READY';
  }
  if ($('flying-launch-btn')) {
    $('flying-launch-btn').textContent = flightRace.phase === 'flying' ? 'In Flight…' : 'Start Flight Run';
  }
}

function showFlightEndScreen(result) {
  roundComplete = true;
  let best = result.score;
  try {
    best = Math.max(result.score, Number(localStorage.getItem('robot-skyway-best')) || 0);
    localStorage.setItem('robot-skyway-best', String(best));
  } catch {}
  if ($('flying-end-result')) {
    $('flying-end-result').textContent = `${result.rings} rings cleared · ${result.score} points · best: ${best}`;
  }
  if ($('flying-end-screen')) $('flying-end-screen').hidden = false;
}

function hideFlightEndScreen() {
  if ($('flying-end-screen')) $('flying-end-screen').hidden = true;
}

// ============================================================================
// Stretching Adventure 3D Scene Components (Fun Sunset Atmosphere)
// ============================================================================
const stretchingGroup = new THREE.Group();
stretchingGroup.name = 'Stretching Adventure Group';
stretchingGroup.visible = false;
scene.add(stretchingGroup);

// Sun on the horizon
const sunGroup = new THREE.Group();
sunGroup.position.set(4.5, 3.2, -32);
const sunOrb = new THREE.Mesh(
  new THREE.SphereGeometry(3.6, 32, 16),
  new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false })
);
const sunCorona = new THREE.Mesh(
  new THREE.RingGeometry(3.4, 5.8, 48),
  new THREE.MeshBasicMaterial({
    color: 0xff8833,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
);
const sunGlow = new THREE.Mesh(
  new THREE.RingGeometry(5.2, 12.0, 48),
  new THREE.MeshBasicMaterial({
    color: 0xff4444,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
);
sunGroup.add(sunOrb, sunCorona, sunGlow);
stretchingGroup.add(sunGroup);

// Twinkling Dusk Stars (Golden and Rose Tints)
const duskStarCount = 420;
const duskStarPositions = new Float32Array(duskStarCount * 3);
const duskStarColors = new Float32Array(duskStarCount * 3);
for (let i = 0; i < duskStarCount; i++) {
  duskStarPositions[i * 3] = (Math.random() - 0.5) * 40;
  duskStarPositions[i * 3 + 1] = Math.random() * 16 + 2;
  duskStarPositions[i * 3 + 2] = Math.random() * -45 + 5;
  const isRose = Math.random() > 0.5;
  duskStarColors[i * 3] = 1.0;
  duskStarColors[i * 3 + 1] = isRose ? 0.78 : 0.88;
  duskStarColors[i * 3 + 2] = isRose ? 0.85 : 0.65;
}
const duskStarGeo = new THREE.BufferGeometry();
duskStarGeo.setAttribute('position', new THREE.BufferAttribute(duskStarPositions, 3));
duskStarGeo.setAttribute('color', new THREE.BufferAttribute(duskStarColors, 3));
const duskStars = new THREE.Points(
  duskStarGeo,
  new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.75 })
);
stretchingGroup.add(duskStars);

// Peach Volumetric Clouds
const peachCloudMaterial = new THREE.MeshBasicMaterial({
  color: 0xff9f70,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});
const peachClouds = Array.from({ length: 8 }, (_, index) => {
  const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 + Math.random() * 2.2, 1), peachCloudMaterial);
  cloud.scale.set(2.8, 0.45, 1.1);
  cloud.position.set((Math.random() - 0.5) * 28, Math.random() * 6 + 1.2, -9 - index * 4);
  stretchingGroup.add(cloud);
  return cloud;
});

// Pedestal
const pedestalGeo = new THREE.RingGeometry(1.4, 1.55, 48);
const pedestalMat = new THREE.MeshBasicMaterial({
  color: 0xff9142,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.5,
});
const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
pedestal.rotation.x = Math.PI / 2;
pedestal.position.set(0, 0.02, 0);
stretchingGroup.add(pedestal);

// High-Tech Collectible Rig
const itemAuraGroup = new THREE.Group();
const beamGeo = new THREE.CylinderGeometry(0.75, 0.75, 11, 24, 1, true);
const beamMat = new THREE.MeshBasicMaterial({
  color: 0xffb84d,
  transparent: true,
  opacity: 0.16,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const sunbeam = new THREE.Mesh(beamGeo, beamMat);
itemAuraGroup.add(sunbeam);

const gyro1 = new THREE.Mesh(
  new THREE.TorusGeometry(0.95, 0.04, 16, 54),
  new THREE.MeshBasicMaterial({ color: 0xff9f43, toneMapped: false })
);
const gyro2 = new THREE.Mesh(
  new THREE.TorusGeometry(0.78, 0.028, 16, 54),
  new THREE.MeshBasicMaterial({ color: 0x58eaff, toneMapped: false })
);
gyro2.rotation.x = Math.PI / 3;
gyro2.rotation.y = Math.PI / 4;
itemAuraGroup.add(gyro1, gyro2);

const itemCoreOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 16, 12),
  new THREE.MeshBasicMaterial({
    color: 0xfff0aa,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
);
itemAuraGroup.add(itemCoreOrb);

const dustCount = 24;
const dustPositions = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const theta = (i / dustCount) * Math.PI * 2;
  const rad = 0.9 + (i % 3) * 0.2;
  dustPositions[i * 3] = Math.cos(theta) * rad;
  dustPositions[i * 3 + 1] = ((i % 5) - 2) * 0.25;
  dustPositions[i * 3 + 2] = Math.sin(theta) * rad;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dustPoints = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    color: 0xffe270,
    size: 0.08,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
  })
);
itemAuraGroup.add(dustPoints);
itemAuraGroup.visible = false;
stretchingGroup.add(itemAuraGroup);

// Socket Beacon on Moshi's back
const socketBeacon = new THREE.Group();
socketBeacon.position.set(0, 1.35, 0.22);
const socketRing1 = new THREE.Mesh(
  new THREE.TorusGeometry(0.55, 0.04, 16, 48),
  new THREE.MeshBasicMaterial({ color: 0xffd043, toneMapped: false })
);
const socketRing2 = new THREE.Mesh(
  new THREE.TorusGeometry(0.38, 0.025, 16, 48),
  new THREE.MeshBasicMaterial({ color: 0xff7e38, toneMapped: false })
);
socketRing2.rotation.x = Math.PI / 4;
const socketHalo = new THREE.Mesh(
  new THREE.RingGeometry(0.2, 0.65, 32),
  new THREE.MeshBasicMaterial({
    color: 0xffb84d,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
);
socketBeacon.add(socketRing1, socketRing2, socketHalo);
socketBeacon.visible = false;
stretchingGroup.add(socketBeacon);

// Sparks on Hit / Collect
const sparkCount = 36;
const sparkPositions = new Float32Array(sparkCount * 3);
const sparkVelocities = Array.from({ length: sparkCount }, () => new THREE.Vector3());
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
const sparkMat = new THREE.PointsMaterial({
  color: 0xffc74f,
  size: 0.11,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
});
const sparks = new THREE.Points(sparkGeo, sparkMat);
stretchingGroup.add(sparks);
let sparksLifetime = 0;

function triggerSparks(pos, colorHex = 0xffc74f) {
  sparkMat.color.setHex(colorHex);
  sparkMat.opacity = 1;
  sparksLifetime = 0.5;
  for (let i = 0; i < sparkCount; i++) {
    sparkPositions[i * 3] = pos.x;
    sparkPositions[i * 3 + 1] = pos.y;
    sparkPositions[i * 3 + 2] = pos.z;
    sparkVelocities[i].set(
      (Math.random() - 0.5) * 5.5,
      (Math.random() - 0.5) * 5.5 + 1.5,
      (Math.random() - 0.5) * 5.5
    );
  }
  sparkGeo.attributes.position.needsUpdate = true;
}

// Comet Trail
let trailIndex = 0;
const trailCount = 20;
const trailPositions = new Float32Array(trailCount * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
const trailMat = new THREE.PointsMaterial({
  color: 0xffa844,
  size: 0.14,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
});
const trailPoints = new THREE.Points(trailGeo, trailMat);
stretchingGroup.add(trailPoints);

// Environments & Props
const stretchingEnvironments = [];
let stretchingPropsSource = null;
let activeProp = null;
let attachedWings = null;

const CHAPTERS = [
  { name: 'BUILD THE WINGS', title: 'Reach for the parts', icon: '↔', fog: 0x351244 },
  { name: 'RESTORE POWER', title: 'Lean and charge', icon: '↗', fog: 0x3d0d3d },
  { name: 'INITIATE LAUNCH', title: 'March to the pad', icon: '⇧', fog: 0x240838 },
];

const PART_TARGETS = [
  { x: 0.15, y: 0.58, world: [-3.5, 1.35, 0.1], label: 'Reach Left', key: 'ArrowLeft' },
  { x: 0.85, y: 0.56, world: [3.5, 1.42, 0.1], label: 'Reach Right', key: 'ArrowRight' },
  { x: 0.28, y: 0.24, world: [-2.1, 3.55, 0.1], label: 'Reach Overhead', key: 'ArrowUp' },
  { x: 0.72, y: 0.22, world: [2.1, 3.7, 0.1], label: 'Reach Overhead', key: 'ArrowUp' },
  { x: 0.12, y: 0.38, world: [-3.9, 2.45, 0.1], label: 'Reach Diagonal', key: 'ArrowLeft' },
  { x: 0.88, y: 0.35, world: [3.9, 2.55, 0.1], label: 'Reach Diagonal', key: 'ArrowRight' },
];

const stretchingState = {
  section: 0,
  phase: 'collect',
  part: 0,
  grabbedWrist: null,
  cell: 0,
  steps: 0,
  hold: 0,
  moves: 0,
};

const ROUTE = [
  [-4.7, 1.18, 2.5], [-2.2, 1.95, -.2], [.2, 2.7, -2.55],
  [-1, 3.4, -5], [1.8, 3.95, -6.9], [4.7, 2.05, -8.6],
].map(position => new THREE.Vector3(...position));
let robotGoal = null;
let energyCore = null;
Object.assign(stretchingState, {
  screen: 'playing', profile: 'standard', range: 1, mode: 'camera',
  paused: false, gestureDwell: 0, previousMetrics: {}, lastMovement: -Infinity,
  latestImage: null, launchMoves: 0,
});
const keysDown = new Set();

function prepareStretchObject(root, isCollectible = false) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (object.material) {
      object.material = object.material.clone();
      if (isCollectible) {
        object.material.roughness = 0.18;
        object.material.metalness = 0.85;
        object.material.emissive = new THREE.Color(0xff8822);
        object.material.emissiveIntensity = 0.55;
      }
    }
  });
  return root;
}

function clearActiveProp() {
  if (activeProp) {
    stretchingGroup.remove(activeProp);
    activeProp = null;
  }
}

function cloneProp(name, position, scale = 1) {
  clearActiveProp();
  const source = stretchingPropsSource?.getObjectByName(name);
  if (!source) return null;
  activeProp = prepareStretchObject(source.clone(true), true);
  activeProp.position.set(...position);
  activeProp.scale.setScalar(scale);
  stretchingGroup.add(activeProp);
  return activeProp;
}

function showStretchingEndScreen() {
  roundComplete = true;
  stretchingState.phase = 'complete';
  soundEffects.playComplete();
  status('Launch sequence ready! Moshi is fully calibrated and prepped.');
  const el = $('stretching-end-screen');
  if (el) el.hidden = false;
}

function hideStretchingEndScreen() {
  const el = $('stretching-end-screen');
  if (el) el.hidden = true;
}

function setInstruction(icon, text, badge = 'REQUIRED ACTION') {
  setHold(0);
  $('stretching-instruction-icon').textContent = icon;
  $('stretching-instruction-text').textContent = text;
  $('stretching-instruction-badge').textContent = badge;
}
function setProgress(label, value) {
  $('stretching-progress-text').textContent = label;
  $('stretching-progress-fill').style.width = `${Math.min(1, value) * 100}%`;
}
function setHold(value, label = '') {
  $('stretching-hold').classList.toggle('hidden', !['assemble', 'charge'].includes(stretchingState.phase));
  $('stretching-hold-fill').style.width = `${value * 100}%`;
  $('stretching-hold-text').textContent = label;
}
function showToast(text) { status(text); }
function attachItemAura(position) {
  itemAuraGroup.position.set(...position);
  itemAuraGroup.visible = true;
}
function renderStretchingUI() {
  $('stretching-chapter-badge').textContent = `SECTOR 0${stretchingState.section + 1}`;
  $('stretching-chapter-title').textContent = CHAPTERS[stretchingState.section].name;
}
function initStretchingSection(index) {
  soundEffects.stopHoldHum();
  hideStretchingEndScreen();
  clearActiveProp();
  if (energyCore) { stretchingGroup.remove(energyCore); energyCore = null; }
  Object.assign(stretchingState, {
    section: index, screen: 'playing', phase: ['collect', 'select', 'march'][index],
    hold: 0, gestureDwell: 0, previousMetrics: {}, lastMovement: -Infinity,
    grabbedWrist: null, squatBaseline: null, latestImage: null,
    stepReady: false, neutralTime: 0, sideHold: 0, squatHold: 0,
  });
  itemAuraGroup.visible = false;
  socketBeacon.visible = false;
  trailMat.opacity = 0;
  stretchingEnvironments.forEach((env, i) => { env.visible = i === index; });
  playerStage.position.set(0, 0, 0);
  playerStage.rotation.set(0, 0, 0);
  pedestal.position.set(0, .02, 0);
  robotGoal = null;
  if (index === 0) {
    stretchingState.moves = 0;
    stretchingState.part = 0;
    if (attachedWings) attachedWings.visible = false;
    camera.position.set(0, 3.8, 14.8);
    camera.lookAt(0, 1.7, 0);
    spawnWingPart();
  } else if (index === 1) {
    stretchingState.cell = 0;
    camera.position.set(0, 4.2, 15.2);
    camera.lookAt(0, 1.9, 0);
    spawnPowerCell();
  } else {
    stretchingState.steps = 0;
    stretchingState.launchMoves = 0;
    playerStage.position.copy(ROUTE[0]);
    playerStage.rotation.y = Math.PI;
    robotGoal = ROUTE[0].clone();
    pedestal.position.copy(ROUTE[0]).setY(ROUTE[0].y - .02);
    camera.position.set(-3.8, 6.2, 13.8);
    camera.lookAt(.4, 2.2, -3.5);
    spawnCore();
    updateMarchUI();
  }
  camera.updateProjectionMatrix();
  setHold(0);
  renderStretchingUI();
}
function finishSection(index) {
  soundEffects.stopHoldHum();
  soundEffects.playComplete();
  initStretchingSection(index + 1);
}
function finishGame() {
  soundEffects.stopHoldHum();
  stretchingState.screen = 'ending';
  setHold(0);
  clearActiveProp();
  itemAuraGroup.visible = false;
  socketBeacon.visible = false;
  $('stretching-end-result').textContent = `All 3 sectors cleared · ${stretchingState.moves} movements completed`;
  showStretchingEndScreen();
}
function updateStretchingMotion(lm, worldLm, dt, now) {
  stretchingState.latestImage = lm;
}

function spawnWingPart() {
  const target = PART_TARGETS[stretchingState.part];
  cloneProp(`Collectible_Wing_${stretchingState.part + 1}`, target.world, 1.05);
  attachItemAura(target.world, 0xffaa44, 0x58eaff);
  socketBeacon.visible = false;
  trailMat.opacity = 0;
  setInstruction(target.key === 'ArrowUp' ? '↑' : target.x < .5 ? '←' : '→', target.label, 'REACH FOR WING');
  setProgress(`${stretchingState.part} / 6 parts collected`, stretchingState.part / 6);
}

function grabWing(wristIndex = null) {
  if (stretchingState.phase !== 'collect' || stretchingState.grabbedWrist !== null) return;
  stretchingState.grabbedWrist = wristIndex ?? 15;
  stretchingState.moves++;
  soundEffects.playGrab();
  itemAuraGroup.visible = false;
  socketBeacon.visible = true;
  trailMat.opacity = 0.85;
  if (activeProp) triggerSparks(activeProp.position, 0xffaa44);
  setInstruction('◎', 'Bring the wing part into Robo’s glowing socket', 'DELIVER WING');
  showToast('Wing secured! Bring it to Robo');
}

function deliverWing() {
  if (stretchingState.phase !== 'collect' || stretchingState.grabbedWrist === null) return;
  soundEffects.playDeliver();
  triggerSparks(new THREE.Vector3(0, 1.4, 0.22), 0xffd043);
  clearActiveProp();
  stretchingState.part++;
  stretchingState.grabbedWrist = null;
  stretchingState.moves++;
  socketBeacon.visible = false;
  trailMat.opacity = 0;


  if (stretchingState.part < 6) {
    showToast(`Wing component ${stretchingState.part}/6 attached`);
    spawnWingPart();
    return;
  }

  // All 6 collected: stretch arms wide to assemble
  stretchingState.phase = 'assemble';
  stretchingState.hold = 0;
  attachedWings.visible = true;
  attachedWings.scale.setScalar(.05);
  setProgress('All 6 parts assembled · Extend wingspan', 1);
  setInstruction('↔', 'Spread both arms wide to calibrate wings', 'LOCK WINGSPAN');
  setHold(0, 'Hold arm wingspan to lock assembly');
}

function spawnPowerCell() {
  const configs = [
    { name: 'Power_Cell_1', x: -3.2, color: 'Red Plasma', direction: -1, hex: 0xff5f71, aura: 0xff3b52 },
    { name: 'Power_Cell_2', x: 3.2, color: 'Blue Ion', direction: 1, hex: 0x2ab7ff, aura: 0x47cbff },
    { name: 'Power_Cell_3', x: -3.2, color: 'Gold Solar', direction: -1, hex: 0xffd043, aura: 0xffaa33 },
  ];
  const config = configs[stretchingState.cell];
  cloneProp(config.name, [config.x, 2.7, .2], 1.15);
  if (activeProp) activeProp.userData.direction = config.direction;
  attachItemAura([config.x, 2.7, .2], config.aura, 0xffd043);
  setInstruction(config.direction < 0 ? '↙' : '↘', `Lean ${config.direction < 0 ? 'left' : 'right'} to choose ${config.color} cell`, 'ALIGN CELL');
  setProgress(`${stretchingState.cell} / 3 cells energized`, stretchingState.cell / 3);
}

function selectCell() {
  if (stretchingState.phase !== 'select') return;
  stretchingState.phase = 'connect';
  stretchingState.gestureDwell = 0;
  stretchingState.moves++;
  soundEffects.playGrab();
  if (activeProp) triggerSparks(activeProp.position, 0xffc74f);
  attachItemAura([0, 2.4, 0.2], 0xffb84d, 0x58eaff);
  setInstruction('↗', 'Reach diagonally to plug into conduit', 'CONNECT CELL');
  showToast('Cell aligned! Reach diagonal');
}

function connectCell() {
  if (stretchingState.phase !== 'connect') return;
  soundEffects.playDeliver();
  triggerSparks(new THREE.Vector3(0, 2.4, 0.2), 0xffd043);
  clearActiveProp();
  stretchingState.cell++;
  stretchingState.moves++;
  itemAuraGroup.visible = false;

  if (stretchingState.cell < 3) {
    stretchingState.phase = 'select';
    spawnPowerCell();
    showToast('Cell locked into conduit');
    return;
  }

  // All 3 cells connected: stay neutral and charge
  stretchingState.phase = 'charge';
  stretchingState.hold = 0;
  setProgress('All 3 cells connected · Charge reactor', 1);
  setInstruction('✦', 'Stand centered and upright in sunset light', 'REACTOR CHARGE');
  setHold(0, 'Hold centered posture to charge');
}

function spawnCore() {
  clearActiveProp();
  const source = stretchingPropsSource?.getObjectByName('Golden_Energy_Core');
  if (!source) return;
  energyCore = prepareStretchObject(source.clone(true), true);
  energyCore.scale.setScalar(.85);
  stretchingGroup.add(energyCore);
  energyCore.position.copy(playerStage.position).add(new THREE.Vector3(0, 1.3, -.25));

}

function updateMarchUI() {
  setProgress(`${stretchingState.steps} / 8 steps along sunset route`, stretchingState.steps / 8);
  setInstruction('⇧', stretchingState.profile === 'seated' ? 'Alternate lifting your hands' : 'March in place toward launch pad', 'MARCH FORWARD');
}

function marchStep() {
  if (stretchingState.phase !== 'march' || performance.now() - stretchingState.lastMovement < 280) return;
  stretchingState.lastMovement = performance.now();
  stretchingState.steps++;
  stretchingState.moves++;
  soundEffects.playStep();
  const routeIndex = Math.min(4, Math.floor(stretchingState.steps / 2));
  robotGoal = ROUTE[routeIndex].clone();
  pedestal.position.copy(ROUTE[routeIndex]).setY(ROUTE[routeIndex].y - 0.02);
  triggerSparks(playerStage.position, 0xffaa44);
  updateMarchUI();

  if (stretchingState.steps === 3 || stretchingState.steps === 6) {
    stretchingState.phase = 'sidestep';
    stretchingState.sideDirection = stretchingState.steps === 3 ? -1 : 1;
    setInstruction(stretchingState.sideDirection < 0 ? '←' : '→', `Step ${stretchingState.sideDirection < 0 ? 'left' : 'right'} onto the bridge platform`, 'SIDE STEP');
    attachItemAura([playerStage.position.x + (stretchingState.sideDirection < 0 ? -2.2 : 2.2), playerStage.position.y + 0.2, playerStage.position.z], 0xff7e38, 0xffd043);
  } else if (stretchingState.steps >= 8) {
    startLaunch();
  }
}

function sideStep() {
  if (stretchingState.phase !== 'sidestep') return;
  stretchingState.moves++;
  stretchingState.phase = 'march';
  soundEffects.playGrab();
  itemAuraGroup.visible = false;
  showToast('Bridge crossed!');
  updateMarchUI();
}

function startLaunch() {
  stretchingState.phase = 'launch';
  stretchingState.launchMoves = 0;
  robotGoal = ROUTE[5].clone();
  pedestal.position.copy(ROUTE[5]).setY(ROUTE[5].y - 0.02);
  itemAuraGroup.visible = false;
  setProgress('Thruster burn: 0 / 3', 0);
  setInstruction('↓', stretchingState.profile === 'seated' ? 'Press both arms down firmly' : 'Perform 3 shallow squats to power thrusters', 'IGNITE THRUSTERS');
}

function launchMove() {
  if (stretchingState.phase !== 'launch' || performance.now() - stretchingState.lastMovement < 420) return;
  stretchingState.lastMovement = performance.now();
  stretchingState.launchMoves++;
  stretchingState.moves++;
  soundEffects.playStep();
  triggerSparks(playerStage.position, 0xff8822);
  setProgress(`Thruster burn: ${stretchingState.launchMoves} / 3`, stretchingState.launchMoves / 3);
  showToast(`Thruster charge ${stretchingState.launchMoves}/3`);

  if (stretchingState.launchMoves >= 3) {
    finishGame();
  }
}

function skipStretchingStep() {
  if (stretchingState.section === 0) {
    stretchingState.phase === 'collect'
      ? (stretchingState.grabbedWrist === null ? grabWing() : deliverWing())
      : finishSection(0);
  } else if (stretchingState.section === 1) {
    stretchingState.phase === 'select'
      ? selectCell()
      : stretchingState.phase === 'connect'
        ? connectCell()
        : finishSection(1);
  } else {
    stretchingState.phase === 'march'
      ? marchStep()
      : stretchingState.phase === 'sidestep'
        ? sideStep()
        : launchMove();
  }
  renderStretchingUI();
}

function updateGameplay(dt, metrics) {
  if (gameCountdownActive || stretchingState.screen !== 'playing' || stretchingState.paused) return;
  const sensitivity = movementThreshold(stretchingState.range);

  // Chapter 1: Wings
  if (stretchingState.section === 0 && stretchingState.phase === 'collect' && stretchingState.mode === 'camera') {
    const radius = [.21, .16, .12][stretchingState.range];
    if (stretchingState.grabbedWrist === null) {
      const wrist = wristNear(stretchingState.latestImage, PART_TARGETS[stretchingState.part], radius);
      if (wrist) grabWing(wrist.index);
    } else {
      const wrist = wristNear(stretchingState.latestImage, { x: .5, y: .58 }, radius * 1.35, stretchingState.grabbedWrist);
      if (wrist) deliverWing();
      else {
        const active = wristPositions(stretchingState.latestImage).find(item => item.index === stretchingState.grabbedWrist);
        if (active && activeProp) {
          activeProp.position.set((active.x - .5) * 8.2, (1 - active.y) * 5.2 - .4, .15);
          // Comet trail update
          trailPositions[trailIndex * 3] = activeProp.position.x;
          trailPositions[trailIndex * 3 + 1] = activeProp.position.y;
          trailPositions[trailIndex * 3 + 2] = activeProp.position.z;
          trailIndex = (trailIndex + 1) % trailCount;
          trailGeo.attributes.position.needsUpdate = true;
        }
      }
    }
  }

  if (stretchingState.section === 0 && stretchingState.phase === 'assemble') {
    const active = stretchingState.mode === 'keyboard' ? keysDown.has('Space') : metrics.armsWide;
    if (active) soundEffects.startHoldHum();
    else soundEffects.stopHoldHum();
    stretchingState.hold = Math.max(0, stretchingState.hold + (active ? dt : -dt * .65));
    const progress = Math.min(1, stretchingState.hold / (2.6 * sensitivity));
    setHold(progress, 'Hold arms wide to build wings');
    if (attachedWings) attachedWings.scale.setScalar(.05 + progress * .95);
    if (progress >= 1) {
      stretchingState.moves++;
      finishSection(0);
      return;
    }
  }

  // Chapter 2: Cells
  if (stretchingState.section === 1 && stretchingState.phase === 'select' && stretchingState.mode === 'camera' && metrics.valid) {
    const desired = activeProp?.userData.direction || 1;
    const matched = Math.sign(metrics.lean) === desired && Math.abs(metrics.lean) > .22 * sensitivity;
    stretchingState.gestureDwell = Math.max(0, stretchingState.gestureDwell + (matched ? dt : -dt));
    if (stretchingState.gestureDwell > .42) selectCell();
  }

  if (stretchingState.section === 1 && stretchingState.phase === 'connect' && stretchingState.mode === 'camera' && metrics.diagonal) {
    connectCell();
  }

  if (stretchingState.section === 1 && stretchingState.phase === 'charge') {
    const active = stretchingState.mode === 'keyboard' ? keysDown.has('Space') : metrics.neutral;
    if (active) soundEffects.startHoldHum();
    else soundEffects.stopHoldHum();
    stretchingState.hold = Math.max(0, stretchingState.hold + (active ? dt : -dt * .5));
    const progress = Math.min(1, stretchingState.hold / (2.6 * sensitivity));
    setHold(progress, 'Hold centered posture to charge reactor');
    const bar = stretchingEnvironments[1]?.getObjectByName('Charge_Bar_Glow');
    if (bar) bar.scale.x = .35 + progress * 2.5;
    if (progress >= 1) {
      stretchingState.moves++;
      finishSection(1);
      return;
    }
  }

  // Chapter 3: March & Launch
  if (stretchingState.section === 2 && stretchingState.mode === 'camera') {
    updateLowerBody(metrics, dt);
  }
}

function updateLowerBody(metrics, dt) {
  if (!metrics.valid) {
    stretchingState.neutralTime = 0;
    stretchingState.stepReady = false;
    stretchingState.sideHold = 0;
    stretchingState.squatHold = 0;
    return;
  }
  if (stretchingState.phase === 'march') {
    const lifted = metrics.leftKnee || metrics.rightKnee;
    // Require a settled feet-down pose between steps. A held knee, stale frame,
    // or visibility flicker must not advance the route repeatedly.
    if (!lifted) {
      stretchingState.neutralTime += dt;
      if (stretchingState.neutralTime >= .18) stretchingState.stepReady = true;
    } else {
      if (stretchingState.stepReady) marchStep();
      stretchingState.stepReady = false;
      stretchingState.neutralTime = 0;
    }
  } else if (stretchingState.phase === 'sidestep') {
    const aligned = Math.sign(metrics.lean) === stretchingState.sideDirection && Math.abs(metrics.lean) > .24;
    stretchingState.sideHold = aligned ? stretchingState.sideHold + dt : 0;
    if (stretchingState.sideHold >= .25) {
      stretchingState.sideHold = 0;
      stretchingState.stepReady = false;
      stretchingState.neutralTime = 0;
      sideStep();
    }
  } else if (stretchingState.phase === 'launch') {
    if (stretchingState.squatBaseline === null) stretchingState.squatBaseline = metrics.squat;
    const down = metrics.squat > stretchingState.squatBaseline + .17 * movementThreshold(stretchingState.range);
    stretchingState.squatHold = down ? stretchingState.squatHold + dt : 0;
    if (!down) stretchingState.previousMetrics.launch = false;
    if (stretchingState.squatHold >= .2 && !stretchingState.previousMetrics.launch) {
      launchMove();
      stretchingState.previousMetrics.launch = true;
    }
  }
}

function applyCameraFraming(isSitting) {
  if (isSitting) {
    camera.position.set(0, 1.35, 6.2);
    camera.lookAt(0, 1.25, 0);
  } else {
    camera.position.set(0, 1.6, 7.2);
    camera.lookAt(0, 1.4, 0);
  }
}
applyCameraFraming(false);

scene.add(new THREE.HemisphereLight(0xe4f7ff, 0x6d8990, 2.5));
for (const [x, y, z, power] of [
  [-3, 5, 4, 65],
  [4, 3, 2, 45],
  [0, 4, -3, 60],
]) {
  const light = new THREE.DirectionalLight(0xffffff, power / 25);
  light.position.set(x, y, z);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = -3;
  light.shadow.camera.right = 3;
  light.shadow.camera.top = 4;
  light.shadow.camera.bottom = -2;
  scene.add(light);
}

const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.03;
floor.receiveShadow = true;
scene.add(floor);

const resize = () => {
  const el = renderer?.domElement?.parentElement || $('viewport');
  if (!el || el.clientWidth === 0) return;
  renderer.setSize(el.clientWidth, el.clientHeight);
  camera.aspect = el.clientWidth / el.clientHeight;
  camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe($('viewport'));
const welcomeVp = $('welcome-bot-viewport');
if (welcomeVp) new ResizeObserver(resize).observe(welcomeVp);

function updateRendererAttachment() {
  if (!renderer) return;
  const welcomeTarget = $('welcome-bot-viewport');
  const gameTarget = $('viewport');
  const handDlg = $('dialog-hand');
  const postureDlg = $('dialog-posture');
  const isWelcomePreviewActive = Boolean((handDlg?.open || postureDlg?.open) && welcomeTarget);

  if (isWelcomePreviewActive) {
    if (renderer.domElement.parentElement !== welcomeTarget) {
      welcomeTarget.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      resize();
    }
  } else if (gameTarget) {
    if (renderer.domElement.parentElement !== gameTarget) {
      gameTarget.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      resize();
    }
  }
}

// Model & Tracking System
let rig = null;
let mode = 'idle'; // 'idle' | 'demo' | 'camera'
let stream = null;
let starting = false;
let epoch = 0;
let lastSeen = 0;
let wasTracking = false;

// ============================================================================
// Theme Color Configuration & 3D Robot Material Recoloring
// ============================================================================
const THEME_COLORS = {
  blue: {
    key: 'blue',
    label: 'Blue',
    accent: '#0284c7',
    robotPrimary: 0x126cdd,
    robotGlow: 0x21dbff,
  },
  purple: {
    key: 'purple',
    label: 'Purple',
    accent: '#8b5cf6',
    robotPrimary: 0x8b5cf6,
    robotGlow: 0xd8b4fe,
  },
  emerald: {
    key: 'emerald',
    label: 'Emerald',
    accent: '#10b981',
    robotPrimary: 0x059669,
    robotGlow: 0x6ee7b7,
  },
  coral: {
    key: 'coral',
    label: 'Coral',
    accent: '#ea580c',
    robotPrimary: 0xea580c,
    robotGlow: 0xfdba74,
  },
  rose: {
    key: 'rose',
    label: 'Rose',
    accent: '#e11d48',
    robotPrimary: 0xe11d48,
    robotGlow: 0xfda4af,
  },
};

let currentThemeColor = 'blue';
let robotInstance = null;
let playerHeadMaterials = [];

function setPlayerHeadTransparent(transparent) {
  for (const entry of playerHeadMaterials) {
    entry.material.transparent = transparent || entry.transparent;
    entry.material.opacity = transparent ? 0.08 : entry.opacity;
    entry.material.depthWrite = transparent ? false : entry.depthWrite;
    entry.material.needsUpdate = true;
  }
}

function setStatusText(text) {
  const el = $('motion-status-text');
  if (el) el.textContent = text;
}

function applyRobotTheme(colorKey) {
  if (!robotInstance) return;
  const theme = THEME_COLORS[colorKey] || THEME_COLORS.blue;
  robotInstance.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat || !mat.name) return;
        if (mat.name === 'Azure enamel' || mat.name.includes('Azure') || mat.name.includes('enamel')) {
          if (mat.color) mat.color.setHex(theme.robotPrimary);
          mat.needsUpdate = true;
        } else if (mat.name === 'Cyan light' || mat.name.includes('Cyan') || mat.name.includes('light')) {
          if (mat.color) mat.color.setHex(theme.robotGlow);
          if (mat.emissive) mat.emissive.setHex(theme.robotGlow);
          mat.needsUpdate = true;
        }
      });
    }
  });
}

function setThemeColor(colorKey, playFeedback = true) {
  const validKey = THEME_COLORS[colorKey] ? colorKey : 'blue';
  currentThemeColor = validKey;
  document.body.dataset.color = validKey;
  document.documentElement.dataset.color = validKey;

  // Update active state on all swatches and header quick buttons
  document.querySelectorAll('.color-swatch-btn, .quick-color-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === validKey);
  });

  applyRobotTheme(validKey);
  savePreference('adaptmove_theme_color', validKey);

  if (playFeedback && typeof soundEffects !== 'undefined' && soundEffects?.playSelect) {
    soundEffects.playSelect();
  }
}

const tracker = new DetailedPoseTracker({ baseUrl: import.meta.env.BASE_URL });
const pipeline = new MotionPipeline();
const classifier = new PoseClassifier();

new GLTFLoader().load(
  `${import.meta.env.BASE_URL}robot/blue_robot.glb`,
  (gltf) => {
    boxingOpponent.setModel(gltf.scene);
    const robot = gltf.scene;
    robotInstance = robot;
    playerRestPosition = robot.position.clone();
    playerRestRotationZ = robot.rotation.z;
    robot.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.name === 'Face_white_panel') {
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          const playerMaterials = materials.map((material) => {
            const playerMaterial = material.clone();
            playerHeadMaterials.push({
              material: playerMaterial,
              opacity: material.opacity,
              transparent: material.transparent,
              depthWrite: material.depthWrite,
            });
            return playerMaterial;
          });
          o.material = Array.isArray(o.material) ? playerMaterials : playerMaterials[0];
        }
      }
    });
    applyRobotTheme(currentThemeColor);
    playerStage.add(robot);
    rig = new RobotRetargeter(robot);
    $('start').disabled = false;
    $('demo').disabled = false;
    status('Ready. Start your camera or try the demo.');
  },
  undefined,
  (err) => {
    console.error(err);
    status('Could not load Blue. Restart the app and refresh.');
  }
);

const gltfLoader = new GLTFLoader();
const assetBaseUrl = import.meta.env?.BASE_URL || './';

// Load Wing Rig for Flight Game
gltfLoader.load(
  `${assetBaseUrl}robot/robot_wings.glb`,
  (gltf) => {
    robotWingsModel = gltf.scene;
    robotWingsModel.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    try {
      robotWingRig = new RobotWingRig(robotWingsModel);
    } catch (e) {
      console.warn('Wing rig init:', e);
    }
    robotWingsModel.visible = false;
    scene.add(robotWingsModel);
  },
  undefined,
  (err) => console.warn('Could not load wings:', err)
);

// Load Stretch Environments & Props
Promise.all([
  gltfLoader.loadAsync(`${assetBaseUrl}environments/crash_site.glb`),
  gltfLoader.loadAsync(`${assetBaseUrl}environments/power_station.glb`),
  gltfLoader.loadAsync(`${assetBaseUrl}environments/launch_route.glb`),
  gltfLoader.loadAsync(`${assetBaseUrl}environments/gameplay_props.glb`),
]).then(([crash, power, launch, props]) => {
  [crash, power, launch].forEach((envGltf, idx) => {
    const env = prepareStretchObject(envGltf.scene);
    env.visible = idx === 0;
    stretchingEnvironments.push(env);
    stretchingGroup.add(env);
  });
  stretchingPropsSource = props.scene;
  const wingsProp = stretchingPropsSource.getObjectByName('Robo_Wings')?.clone(true);
  if (wingsProp) {
    prepareStretchObject(wingsProp, true);
    wingsProp.visible = false;
    attachedWings = wingsProp;
    playerStage.add(attachedWings);
  }
  if (currentView === 'game' && activeGame.gameType === 'stretching') initStretchingSection(0);
}).catch((err) => console.warn('Stretching assets load notice:', err));

// ============================================================================
// Camera Controls (Available from Header or Aside)
// ============================================================================
function stopCamera() {
  cancelGameCountdown();
  epoch++;
  starting = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  tracker.lastVideoTime = -1;
  mode = 'idle';
  wasTracking = false;
  boxingRound.reset();
  boxingPunchDetector.reset();
  boxingBaseline = null;
  boxingCueRenderKey = '';
  boxingRecordedCue = null;
  playerHitAt = -Infinity;
  playerHitSide = 0;
  flightRace.reset();
  currentFlightInput = flightInput(null);
  wingController.reset();
  renderFlightUI();
  stretchingState.hold = 0;
  soundEffects.stopHoldHum();
  renderStretchingUI();
  boxingImpactAt = -Infinity;
  boxingImpact.visible = false;
  renderBoxingRound(boxingRound.snapshot(performance.now()));
  pipeline.process(null, performance.now());
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  miniCtx.clearRect(0, 0, miniOverlay.width, miniOverlay.height);

  // Hide hand cursors
  cursorLeftEl.classList.add('hidden');
  cursorRightEl.classList.add('hidden');
  cursorLeftEl.classList.remove('dwelling');
  cursorRightEl.classList.remove('dwelling');
  cursorL.visible = false;
  cursorR.visible = false;
  cursorL.dwellTarget = null;
  cursorR.dwellTarget = null;
  cursorL.dwellElapsed = 0;
  cursorR.dwellElapsed = 0;
  if (handDwellLeftEl) handDwellLeftEl.style.strokeDashoffset = '138.23';
  if (handDwellRightEl) handDwellRightEl.style.strokeDashoffset = '138.23';

  $('camera-placeholder').hidden = false;
  $('start').disabled = false;
  $('stop').disabled = true;
  $('demo').textContent = 'Try demo';
  if ($('pose')) $('pose').textContent = 'Ready when you are';
  status('Camera off. Ready when you are.');

  // Update header camera toggle
  const camToggleBtn = $('btn-camera-toggle');
  camToggleBtn.setAttribute('aria-pressed', 'false');
  $('camera-btn-text').textContent = 'Start Camera';

  // Hide mini camera HUD in carousel / details
  $('mini-camera-hud').classList.add('hidden');
  const chipOff = $('motion-indicator-chip');
  if (chipOff) chipOff.classList.remove('active');
  setStatusText('Camera Off · Click Start Camera to enable hand cursors and motion navigation');

  const welcomeCamMsg = $('welcome-cam-msg');
  const welcomeCamDot = $('welcome-cam-dot');
  if (welcomeCamMsg) welcomeCamMsg.textContent = 'Please accept camera permissions if prompted to wave together!';
  if (welcomeCamDot) welcomeCamDot.className = 'cam-status-dot';
}

async function startCamera() {
  if (mode === 'camera' || starting) return;
  const current = ++epoch;
  starting = true;
  $('start').disabled = true;
  $('stop').disabled = false;
  status('Requesting camera access…');
  setStatusText('Requesting camera access…');

  const welcomeCamMsg = $('welcome-cam-msg');
  const welcomeCamDot = $('welcome-cam-dot');
  if (welcomeCamMsg) welcomeCamMsg.textContent = 'Please accept camera permissions if prompted to wave together!';
  if (welcomeCamDot) welcomeCamDot.className = 'cam-status-dot pending';

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Use localhost URL or an HTTPS connection.');
    }
    const incoming = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    if (current !== epoch) {
      incoming.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = incoming;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    // Listen for hardware disconnection on the video track
    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) {
      videoTrack.onended = () => {
        stopCamera();
        status('Camera disconnected. Reconnect it and start again.');
      };
    }

    try {
      await video.play();
    } catch (playErr) {
      console.warn('Video play notice:', playErr);
    }

    status('Loading local tracking model…');
    await tracker.initialize();
    if (current !== epoch) return;

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    miniOverlay.width = 180;
    miniOverlay.height = 135;

    $('camera-placeholder').hidden = true;
    mode = 'camera';
    if (currentView === 'game' && !gameCountdownActive && !roundComplete) startActiveGameCountdown();
    lastSeen = performance.now();
    status(`Camera ready · ${tracker.delegate} tracking · Mirror mode`);
    renderBoxingRound(boxingRound.snapshot(performance.now()));

    // Update header camera toggle
    const camToggleBtn = $('btn-camera-toggle');
    if (camToggleBtn) camToggleBtn.setAttribute('aria-pressed', 'true');
    const camBtnText = $('camera-btn-text');
    if (camBtnText) camBtnText.textContent = 'Stop Camera';

    // Update welcome camera status
    if (welcomeCamMsg) welcomeCamMsg.textContent = 'Camera active!';
    if (welcomeCamDot) welcomeCamDot.className = 'cam-status-dot active';

    // Show mini camera HUD if not in game view
    if (currentView !== 'game') {
      $('mini-camera-hud').classList.remove('hidden');
    }
    const chipOn = $('motion-indicator-chip');
    if (chipOn) chipOn.classList.add('active');
    setStatusText(`Motion Active · Hover cursor to select, cross hands in X to go back`);
  } catch (err) {
    if (current !== epoch) return;
    stopCamera();
    console.error(err);
    const isDenied = err.name === 'NotAllowedError';
    const msg = isDenied
      ? 'Camera permission denied. Allow camera access and try again.'
      : `Could not start camera: ${err.message}`;
    status(msg);
    setStatusText(msg);

    if (welcomeCamMsg) {
      welcomeCamMsg.textContent = isDenied
        ? 'Camera access blocked. Please allow camera permissions to wave together!'
        : 'Camera unavailable. You can continue setup using your mouse!';
    }
    if (welcomeCamDot) welcomeCamDot.className = 'cam-status-dot denied';
  } finally {
    if (current === epoch) {
      starting = false;
      $('start').disabled = mode === 'camera';
    }
  }
}

// Wire Camera and Demo buttons
$('stop').onclick = stopCamera;
$('start').onclick = startCamera;
$('btn-camera-toggle').onclick = () => {
  if (mode === 'camera' || starting) stopCamera();
  else startCamera();
};

$('demo').onclick = () => {
  if (mode === 'demo') {
    stopCamera();
    return;
  }
  stopCamera();
  mode = 'demo';
  boxingRound.reset();
  boxingBaseline = null;
  renderBoxingRound(boxingRound.snapshot(performance.now()));
  $('demo').textContent = 'End demo';
  $('stop').disabled = false;
  if ($('pose')) $('pose').textContent = 'Demo · no camera';
  status('Demo animation. Start camera to follow your own movement.');
};

// ============================================================================
// Posture Mode (Standing Only)
// ============================================================================
function setPostureMode(newMode = 'standing', announce = true) {
  postureMode = 'standing';
  savePreference('adaptmove_posture', 'standing');
  document.body.setAttribute('data-posture', 'standing');

  pipeline.setProfile(ACCESSIBILITY_PROFILES.STANDARD);
  applyCameraFraming(false);

  // Update Header Switcher if present
  const btnSitting = $('btn-mode-sitting');
  const btnStanding = $('btn-mode-standing');
  if (btnSitting) {
    btnSitting.classList.remove('active');
    btnSitting.setAttribute('aria-pressed', 'false');
  }
  if (btnStanding) {
    btnStanding.classList.add('active');
    btnStanding.setAttribute('aria-pressed', 'true');
  }

  // Update Motion Hints Pill
  const hintPosture = $('hint-posture');
  if (hintPosture) {
    hintPosture.innerHTML = `<kbd>Posture:</kbd> Standing`;
  }

  // Update Details Page Posture Indicator
  const detailsIndicator = $('details-posture-indicator');
  if (detailsIndicator) {
    detailsIndicator.textContent = 'Standing Mode (Full Body)';
  }

  // Update In-Game Mode Pill
  const gameModeToggle = $('btn-game-mode-toggle');
  if (gameModeToggle) gameModeToggle.textContent = 'Standing Mode';

  // Update Dialog Radio if present
  const radio = document.querySelector(`input[name="setting-posture"][value="standing"]`);
  if (radio) radio.checked = true;

  if (announce) {
    soundEffects.playPostureSwitch();
    const msg = 'Standing mode active. Full-body movement tracking enabled.';
    $('carousel-announcement').textContent = msg;
    if (mode === 'camera') {
      setStatusText('Motion Active (Standing mode) · Hover cursor to select, cross hands in X to go back');
    }
  }

  if (typeof updatePostureCards === 'function') {
    updatePostureCards();
  }
}

const btnModeSit = $('btn-mode-sitting');
const btnModeStand = $('btn-mode-standing');
if (btnModeSit) btnModeSit.onclick = () => setPostureMode('standing');
if (btnModeStand) btnModeStand.onclick = () => setPostureMode('standing');
const btnGameToggle = $('btn-game-mode-toggle');
if (btnGameToggle && btnGameToggle.tagName === 'BUTTON') {
  btnGameToggle.onclick = () => setPostureMode('standing');
}

// ============================================================================
// View Routing Architecture (Carousel -> Details -> Game)
// ============================================================================
function showView(viewName) {
  currentView = viewName;
  document.body.setAttribute('data-view', viewName);

  $('view-carousel').classList.toggle('view-active', viewName === 'carousel');
  $('view-carousel').classList.toggle('view-hidden', viewName !== 'carousel');

  $('view-details').classList.toggle('view-active', viewName === 'details');
  $('view-details').classList.toggle('view-hidden', viewName !== 'details');

  $('view-game').classList.toggle('view-active', viewName === 'game');
  $('view-game').classList.toggle('view-hidden', viewName !== 'game');

  // Mini camera HUD in carousel or details
  if (mode === 'camera' && viewName !== 'game') {
    $('mini-camera-hud').classList.remove('hidden');
  } else {
    $('mini-camera-hud').classList.add('hidden');
  }

  // Clean cursor hovers and dwell states on view change
  document.querySelectorAll('.motion-hover').forEach((el) => el.classList.remove('motion-hover'));
  cursorL.targetEl = null;
  cursorR.targetEl = null;
  cursorL.dwellTarget = null;
  cursorR.dwellTarget = null;
  cursorL.dwellElapsed = 0;
  cursorR.dwellElapsed = 0;
  cursorLeftEl.classList.remove('dwelling');
  cursorRightEl.classList.remove('dwelling');
  if (handDwellLeftEl) handDwellLeftEl.style.strokeDashoffset = '138.23';
  if (handDwellRightEl) handDwellRightEl.style.strokeDashoffset = '138.23';

  // When entered into a game (after the card description), make the cursors disappear
  if (viewName === 'game') {
    cursorLeftEl.classList.add('hidden');
    cursorRightEl.classList.add('hidden');
    cursorL.visible = false;
    cursorR.visible = false;
  }

  updateRendererAttachment();
  requestAnimationFrame(() => resize());
}

function openGameDetails(index) {
  activeCardIndex = index;
  activeGame = GAMES_CONFIG[activeCardIndex];
  soundEffects.playNav();

  // Populate Details Page
  $('details-title').textContent = activeGame.title;
  $('details-subtitle').textContent = activeGame.subtitle;
  $('details-description').textContent = activeGame.description;
  $('details-status-badge').textContent = activeGame.status;
  $('details-focus-val').textContent = activeGame.focus;
  $('details-intensity-val').textContent = activeGame.intensity;
  if ($('details-players-val')) $('details-players-val').textContent = activeGame.players || '';
  $('details-image').src = activeGame.image;

  $('details-header-title') && ($('details-header-title').textContent = activeGame.title);

  showView('details');
  $('carousel-announcement').textContent = `Opened details for ${activeGame.title}. Close hand over Start Activity to begin.`;
}

function configureActiveGame() {
  const isBoxing = activeGame.gameType === 'boxing-beat';
  const isFlying = activeGame.gameType === 'flying';
  const isStretching = activeGame.gameType === 'stretching';

  if (attachedWings) attachedWings.visible = false;
  setPlayerHeadTransparent(isBoxing);
  boxingOpponent.group.visible = isBoxing;
  $('boxing-forecast').hidden = !isBoxing;
  $('boxing-panel').hidden = !isBoxing;

  flyingGroup.visible = isFlying;
  if ($('flying-hud')) $('flying-hud').hidden = !isFlying;
  if ($('flying-stage-copy')) $('flying-stage-copy').hidden = !isFlying;
  if ($('flying-horizon')) $('flying-horizon').hidden = !isFlying;
  if ($('flying-player-strip')) $('flying-player-strip').hidden = !isFlying;
  hideFlightEndScreen();
  if ($('flying-panel')) $('flying-panel').hidden = !isFlying;

  stretchingGroup.visible = isStretching;
  if ($('stretching-hud')) $('stretching-hud').hidden = !isStretching;
  if ($('stretching-panel')) $('stretching-panel').hidden = !isStretching;

  $('view-game').dataset.game = isBoxing ? 'boxing-beat' : isFlying ? 'flying' : isStretching ? 'stretching' : '';
  $('view-game').setAttribute('aria-label', `Active Game: ${activeGame.title}`);
  $('active-game-title').textContent = activeGame.title;

  if (isBoxing) {
    playerStage.position.set(0, 0, -1.12);
    playerStage.rotation.set(0, 0, 0);
    playerStage.scale.setScalar(0.88);
    playerStage.updateMatrixWorld(true);
    boxingOpponent.group.position.set(0, 0, 1.22);
    boxingOpponent.baseZ = 1.22;
    boxingOpponent.group.scale.setScalar(1.12);
    camera.fov = 38;
    camera.position.set(0, 6.7, -6.4);
    camera.lookAt(0, 1.25, 0);
    camera.updateProjectionMatrix();
    if (robotWingsModel) robotWingsModel.visible = false;
  } else if (isFlying) {
    playerStage.position.set(0, 0, 0);
    playerStage.rotation.set(0, Math.PI, 0);
    playerStage.scale.setScalar(0.72);
    playerStage.updateMatrixWorld(true);
    camera.fov = 34;
    camera.position.set(0, 2.25, 8.3);
    camera.lookAt(0, 1.5, -4);
    camera.updateProjectionMatrix();
    if (robotWingsModel) {
      robotWingsModel.visible = true;
      robotWingsModel.position.copy(playerStage.position);
      robotWingsModel.rotation.copy(playerStage.rotation);
      robotWingsModel.scale.copy(playerStage.scale);
    }
    resetFlightCourse();
    flightRace.reset();
    renderFlightUI();
  } else if (isStretching) {
    playerStage.position.set(0, 0, 0);
    playerStage.rotation.set(0, 0, 0);
    playerStage.scale.setScalar(1);
    playerStage.updateMatrixWorld(true);
    camera.fov = 36;
    camera.position.set(0, 3.8, 14.8);
    camera.lookAt(0, 1.7, 0);
    camera.updateProjectionMatrix();
    if (robotWingsModel) robotWingsModel.visible = false;
    hideStretchingEndScreen();
    initStretchingSection(0);
  } else {
    playerStage.position.set(0, 0, 0);
    playerStage.rotation.set(0, 0, 0);
    playerStage.scale.setScalar(1);
    playerStage.updateMatrixWorld(true);
    camera.fov = 30;
    applyCameraFraming(false);
    if (robotWingsModel) robotWingsModel.visible = false;
  }

  if (!isBoxing) {
    boxingRound.reset();
    boxingPunchDetector.reset();
    boxingBaseline = null;
    renderBoxingRound(boxingRound.snapshot(performance.now()));
  }
}

function renderBoxingRound(state) {
  const panel = $('boxing-panel');
  if (!panel) return;
  $('boxing-score').textContent = String(state.score);
  $('boxing-streak').textContent = String(state.streak);
  $('boxing-round-feedback').textContent = state.feedback;
  $('boxing-round-clock').textContent = state.active
    ? `${Math.ceil(state.remainingMs / 1000)} SEC LEFT`
    : state.feedback.startsWith('Round complete') ? 'ROUND COMPLETE' : '45 SEC ROUND';
  $('boxing-start-round').disabled = state.active || mode !== 'camera';
  $('boxing-start-round').textContent = state.active ? 'Round in progress' : 'Start 45-second round';
  $('boxing-help').textContent = mode !== 'camera'
    ? 'Start the camera to play. Stand centered in frame to calibrate your movement.'
    : boxingBaseline
      ? 'Match each cue at NOW. For punches, push one fist toward the camera, then bring it back to guard.'
      : 'Stand centered with shoulders, hips, elbows, and wrists visible. The first moments calibrate your guard.';

  const prompt = $('boxing-action');
  const cue = state.active && !gameCountdownActive
    ? state.cues.find(item => item.state === 'now')
      || state.cues.find(item => item.state === 'upcoming' && item.inMs > 0 && item.inMs <= 900)
    : null;
  const key = cue ? `${cue.index}:${cue.id}:${cue.state}` : '';
  prompt.hidden = !cue || currentView !== 'game' || activeGame.gameType !== 'boxing-beat';
  if (key === boxingCueRenderKey) return;
  boxingCueRenderKey = key;
  if (!cue) return;
  const actions = {
    'move-left': ['left', 'Dodge Left', '←'],
    'move-right': ['right', 'Dodge Right', '→'],
    'punch-left': ['left', 'Left Punch', '↗'],
    'punch-right': ['right', 'Right Punch', '↖'],
    duck: ['left', 'Duck Down', '↓'],
    block: ['right', 'Block', '↑'],
  };
  const [side, label, arrow] = actions[cue.id];
  prompt.dataset.side = side;
  prompt.dataset.timing = cue.state;
  $('boxing-action-label').textContent = label;
  $('boxing-action-arrow').textContent = arrow;
  $('boxing-action-timing').textContent = cue.state === 'now' ? 'NOW!' : 'GET READY';
  if (cue.state === 'now') soundEffects.playGameCue(cue.id.startsWith('punch') ? 680 : 440);
}

function showBoxingImpact(now) {
  boxingImpactAt = now;
  boxingImpact.visible = true;
  boxingImpact.scale.setScalar(0.45);
}

function handleBoxingRoundEvents(state, now) {
  if (state.recordedMove) {
    const move = state.recordedMove;
    boxingRecordedCue = { index: state.recordedCueIndex, result: 'recorded' };
    if (move === 'punch-left' || move === 'punch-right') {
      soundEffects.playGameHit();
      boxingOpponent.receiveHit(now, move);
      showBoxingImpact(now);
      state.feedback = `Clean hit! ${move === 'punch-left' ? 'Left' : 'Right'} punch landed`;
      boxingRound.feedback = state.feedback;
    } else {
      soundEffects.playGrab();
      boxingOpponent.dodgeAttack(now, move);
      state.feedback = 'Clean dodge! The punch missed';
      boxingRound.feedback = state.feedback;
    }
  }

  for (const missed of state.missedCues) {
    if (!missed.wasHit) continue;
    soundEffects.playGameHit(false);
    boxingRecordedCue = { index: missed.index, result: 'hit' };
    playerHitAt = now;
    playerHitSide = missed.move === 'move-left' ? 1 : missed.move === 'move-right' ? -1 : 0;
    boxingOpponent.receiveHit(now, missed.move);
    showBoxingImpact(now);
    state.feedback = 'You got hit! Move sooner next time';
    boxingRound.feedback = state.feedback;
  }

  if (state.recordedMove || state.missedCues.length) boxingCueRenderKey = '';
}

function startBoxingRound() {
  if (mode !== 'camera') {
    status('Start the camera before beginning a Boxing Beat round.');
    return;
  }
  boxingBaseline = null;
  boxingCueRenderKey = '';
  boxingRecordedCue = null;
  playerHitAt = -Infinity;
  playerHitSide = 0;
  boxingImpactAt = -Infinity;
  boxingImpact.visible = false;
  boxingPunchDetector.reset();
  boxingRound.start(performance.now());
  renderBoxingRound(boxingRound.snapshot(performance.now()));
}
$('boxing-start-round').onclick = startBoxingRound;

function returnToCarousel() {
  roundComplete = false;
  practiceDeadline = 0;
  $('round-end-screen').hidden = true;
  $('boxing-action').hidden = true;
  cancelGameCountdown();
  setPlayerHeadTransparent(false);
  boxingRound.reset();
  boxingPunchDetector.reset();
  boxingBaseline = null;
  boxingCueRenderKey = '';
  boxingRecordedCue = null;
  playerHitAt = -Infinity;
  playerHitSide = 0;
  boxingImpactAt = -Infinity;
  boxingImpact.visible = false;
  flyingGroup.visible = false;
  if ($('flying-hud')) $('flying-hud').hidden = true;
  if ($('flying-stage-copy')) $('flying-stage-copy').hidden = true;
  if ($('flying-horizon')) $('flying-horizon').hidden = true;
  if ($('flying-player-strip')) $('flying-player-strip').hidden = true;
  hideFlightEndScreen();
  hideStretchingEndScreen();
  if ($('flying-panel')) $('flying-panel').hidden = true;
  stretchingGroup.visible = false;
  if ($('stretching-hud')) $('stretching-hud').hidden = true;
  if ($('stretching-panel')) $('stretching-panel').hidden = true;
  if (robotWingsModel) robotWingsModel.visible = false;
  clearActiveProp();
  if (attachedWings) attachedWings.visible = false;
  flightRace.reset();
  soundEffects.stopHoldHum();
  $('view-game').dataset.game = '';
  playerStage.position.set(0, 0, 0);
  playerStage.rotation.set(0, 0, 0);
  playerStage.scale.setScalar(1);
  playerStage.updateMatrixWorld(true);
  camera.fov = 30;
  applyCameraFraming(false);
  boxingOpponent.group.visible = false;
  boxingOpponent.group.position.set(0, 0, 0);
  boxingOpponent.baseZ = 1.15;
  boxingOpponent.group.scale.setScalar(0.82);
  renderBoxingRound(boxingRound.snapshot(performance.now()));
  soundEffects.playBack();
  showView('carousel');
  updateCardPositions();
  $('carousel-announcement').textContent = 'Returned to games carousel.';
}

function cancelGameCountdown() {
  clearTimeout(gameCountdownTimer);
  gameCountdownTimer = null;
  gameCountdownActive = false;
  $('game-countdown').hidden = true;
}

function startActiveGameCountdown(replay = false) {
  cancelGameCountdown();
  if (currentView !== 'game') return;
  roundComplete = false;
  practiceDeadline = 0;
  $('round-end-screen').hidden = true;
  hideFlightEndScreen();
  hideStretchingEndScreen();
  gameCountdownActive = true;
  hideMotionHands();
  stretchingState.paused = true;
  const gameId = activeGame.id;
  let remaining = 3;
  const tick = () => {
    if (currentView !== 'game' || activeGame.id !== gameId) {
      cancelGameCountdown();
      return;
    }
    if (remaining === 0) {
      cancelGameCountdown();
      stretchingState.paused = false;
      soundEffects.playGameCue(880);
      if (activeGame.gameType === 'boxing-beat') startBoxingRound();
      else if (activeGame.gameType === 'flying') startFlightRun();
      else if (activeGame.gameType === 'stretching' && replay) initStretchingSection(0);
      else if (!activeGame.gameType) practiceDeadline = performance.now() + 60_000;
      status(`Entered ${activeGame.title}. Move to begin exercise.`);
      return;
    }
    soundEffects.playGameCue(remaining === 1 ? 660 : 440);
    $('game-countdown-number').textContent = String(remaining);
    $('game-countdown').hidden = false;
    remaining -= 1;
    gameCountdownTimer = setTimeout(tick, 1000);
  };
  tick();
}

function launchActiveGame() {
  soundEffects.playSelect();
  configureActiveGame();
  showView('game');
  requestAnimationFrame(() => resize());
  if (mode !== 'camera' && !starting) startCamera().catch(console.warn);
  startActiveGameCountdown();

}

$('btn-details-back').onclick = returnToCarousel;
$('btn-start-game').onclick = launchActiveGame;
$('btn-back-to-carousel').onclick = returnToCarousel;
$('btn-round-restart').onclick = () => startActiveGameCountdown(true);
$('btn-round-menu').onclick = returnToCarousel;

function startFlightRun() {
  soundEffects.playSelect();
  hideFlightEndScreen();
  flightRace.start(performance.now());
  resetFlightCourse();
  wingController.reset();
  currentFlightInput = flightInput(null);
  playerStage.position.set(0, .6, 0);
  playerStage.rotation.set(0, Math.PI, 0);
  if (robotWingRig) robotWingRig.reset(true);
  flightAltitude = 0.6;
  flightVerticalVelocity = 0;
  lastFlapVisualAt = -Infinity;
  renderFlightUI();
  status('You are airborne! Flap arms downward to gain altitude, lean to steer.');
}

if ($('flying-launch-btn')) $('flying-launch-btn').onclick = () => startActiveGameCountdown(true);
if ($('flying-start-round')) $('flying-start-round').onclick = () => startActiveGameCountdown(true);
if ($('btn-flying-replay')) $('btn-flying-replay').onclick = () => startActiveGameCountdown(true);
if ($('btn-flying-menu')) $('btn-flying-menu').onclick = returnToCarousel;

if ($('btn-stretching-replay')) $('btn-stretching-replay').onclick = () => startActiveGameCountdown(true);
if ($('btn-stretching-menu')) $('btn-stretching-menu').onclick = returnToCarousel;

if ($('stretching-skip-btn')) {
  $('stretching-skip-btn').onclick = () => {
    skipStretchingStep();
  };
}

// ============================================================================
// Carousel Component (Symmetrical: 1 Left, Center, 1 Right)
// ============================================================================
const track = $('carousel-track');
const indicatorsContainer = $('carousel-indicators');

function renderCarousel() {
  track.innerHTML = '';
  indicatorsContainer.innerHTML = '';

  GAMES_CONFIG.forEach((game, index) => {
    // 1. Create Card
    const card = document.createElement('article');
    card.className = 'carousel-card motion-target';
    card.id = `card-${game.id}`;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${game.title}, Activity ${index + 1} of ${GAMES_CONFIG.length}`);

    card.innerHTML = `
      <div class="card-media">
        <img src="${game.image}" alt="${game.title} visual preview" loading="lazy">
        <span class="card-status-badge ${game.isPlayable ? 'playable' : ''}">
          ${game.status}
        </span>
      </div>
      <div class="card-content">
        <div class="card-title-group">
          <h3 class="card-title">${game.title}</h3>
          <span class="card-subtitle">${game.subtitle}</span>
        </div>
        <div class="card-footer">
          <span>${game.focus}</span>
          <span class="card-action-hint">View Details &rarr;</span>
        </div>
      </div>
    `;

    // Click on active card opens details; click on side card rotates it to center
    card.onclick = () => {
      if (activeCardIndex === index) {
        openGameDetails(index);
      } else {
        goToCard(index);
      }
    };

    // Keyboard support
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openGameDetails(index);
      }
    };

    track.appendChild(card);

    // 2. Create Indicator Pill
    const indicator = document.createElement('button');
    indicator.type = 'button';
    indicator.className = 'indicator-dot motion-target';
    indicator.setAttribute('role', 'tab');
    indicator.setAttribute('aria-label', `Go to card ${index + 1}: ${game.title}`);
    indicator.onclick = () => goToCard(index);
    indicatorsContainer.appendChild(indicator);
  });

  updateCardPositions();
}

function updateCardPositions() {
  const cards = track.children;
  const indicators = indicatorsContainer.children;
  const count = GAMES_CONFIG.length;

  // Exact 1-left, 1-center, 1-right indexing
  const prevIndex = (activeCardIndex - 1 + count) % count;
  const nextIndex = (activeCardIndex + 1) % count;

  for (let i = 0; i < count; i++) {
    const card = cards[i];
    const indicator = indicators[i];
    card.classList.remove('is-active', 'is-prev', 'is-next', 'is-hidden');
    indicator.classList.remove('active');
    indicator.setAttribute('aria-selected', 'false');

    if (i === activeCardIndex) {
      card.classList.add('is-active');
      card.setAttribute('aria-current', 'true');
      indicator.classList.add('active');
      indicator.setAttribute('aria-selected', 'true');
    } else if (i === prevIndex) {
      card.classList.add('is-prev');
      card.removeAttribute('aria-current');
    } else if (i === nextIndex) {
      card.classList.add('is-next');
      card.removeAttribute('aria-current');
    } else {
      card.classList.add('is-hidden');
      card.removeAttribute('aria-current');
    }
  }
}

function goToCard(index, playSound = true) {
  const count = GAMES_CONFIG.length;
  activeCardIndex = (index + count) % count;
  updateCardPositions();

  if (playSound) soundEffects.playNav();

  const game = GAMES_CONFIG[activeCardIndex];
  $('carousel-announcement').textContent = `Card ${activeCardIndex + 1} of ${count}: ${game.title}. ${game.subtitle}.`;
}

function prevCard() {
  goToCard(activeCardIndex - 1);
}

function nextCard() {
  goToCard(activeCardIndex + 1);
}

$('carousel-prev').onclick = prevCard;
$('carousel-next').onclick = nextCard;

// ============================================================================
// Dual Hand Cursors & "Close Hand to Select" Engine
// ============================================================================
function mapWristToScreen(mirrorX, rawY) {
  // Comfortable interaction zone mapping [0.16, 0.84] to screen
  const screenX = ((mirrorX - 0.16) / 0.68) * window.innerWidth;
  const screenY = ((rawY - 0.12) / 0.76) * window.innerHeight;

  return {
    x: Math.max(12, Math.min(window.innerWidth - 12, screenX)),
    y: Math.max(12, Math.min(window.innerHeight - 12, screenY)),
  };
}

function detectHandClosed(landmarks, isRightHand) {
  const wIdx = isRightHand ? 16 : 15;
  const iIdx = isRightHand ? 20 : 19;
  const pIdx = isRightHand ? 18 : 17;
  const tIdx = isRightHand ? 22 : 21;
  const eIdx = isRightHand ? 14 : 13;

  const w = landmarks[wIdx];
  const idx = landmarks[iIdx];
  const p = landmarks[pIdx];
  const th = landmarks[tIdx];
  const e = landmarks[eIdx];

  if (!w || !idx || (w.visibility ?? 0) < 0.4 || (idx.visibility ?? 0) < 0.4) {
    return { ratio: 1.0 };
  }

  // Forearm reference scale
  let forearm = 0.2;
  if (e && (e.visibility ?? 0) > 0.4) {
    forearm = Math.hypot(w.x - e.x, w.y - e.y);
  } else {
    const ls = landmarks[11];
    const rs = landmarks[12];
    if (ls && rs) {
      forearm = Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.52;
    }
  }
  forearm = Math.max(0.08, forearm);

  // Distance from wrist to fingertips
  const dIndex = Math.hypot(idx.x - w.x, idx.y - w.y);
  const dPinky = p && (p.visibility ?? 0) > 0.35 ? Math.hypot(p.x - w.x, p.y - w.y) : dIndex;
  const dThumb = th && (th.visibility ?? 0) > 0.35 ? Math.hypot(th.x - w.x, th.y - w.y) : dIndex;

  // Average fingertip distance from wrist relative to forearm
  const avgDist = (dIndex * 1.5 + dPinky + dThumb) / 3.5;
  const ratio = avgDist / forearm;

  return { ratio };
}

function getCompletionScreen() {
  if (!roundComplete || currentView !== 'game') return null;
  return document.querySelector('#round-end-screen:not([hidden]), #flying-end-screen:not([hidden]), #stretching-end-screen:not([hidden])');
}

function hideMotionHands(now = performance.now()) {
  updateHandCursor(cursorL, cursorLeftEl, stateTextLeft, handDwellLeftEl, {x:0,y:0}, false, 1, now);
  updateHandCursor(cursorR, cursorRightEl, stateTextRight, handDwellRightEl, {x:0,y:0}, false, 1, now);
}

function updateMotionHands(lm, now) {
  if (gameCountdownActive || (currentView === 'game' && !getCompletionScreen())) {
    hideMotionHands(now);
    return;
  }
              // Process Hand Cursors (Restricted to activeSelectingHand: right, left, or both)
              const rw = lm[16]; // Right wrist
              const lw = lm[15]; // Left wrist

              const allowRightCursor = activeSelectingHand === 'right' || activeSelectingHand === 'both';
              const allowLeftCursor = activeSelectingHand === 'left' || activeSelectingHand === 'both';

              // Right Hand Cursor
              if (allowRightCursor && rw && (rw.visibility ?? 0) >= 0.4) {
                const targetPos = mapWristToScreen(1 - rw.x, rw.y);
                const rightHandGrip = detectHandClosed(lm, true);
                updateHandCursor(cursorR, cursorRightEl, stateTextRight, handDwellRightEl, targetPos, true, rightHandGrip.ratio, now);
              } else {
                updateHandCursor(cursorR, cursorRightEl, stateTextRight, handDwellRightEl, { x: 0, y: 0 }, false, 1.0, now);
              }

              if (gameCountdownActive || (currentView === 'game' && !getCompletionScreen())) {
                hideMotionHands(now);
                return;
              }

              // Left Hand Cursor
              if (allowLeftCursor && lw && (lw.visibility ?? 0) >= 0.4) {
                const targetPos = mapWristToScreen(1 - lw.x, lw.y);
                const leftHandGrip = detectHandClosed(lm, false);
                updateHandCursor(cursorL, cursorLeftEl, stateTextLeft, handDwellLeftEl, targetPos, true, leftHandGrip.ratio, now);
              } else {
                updateHandCursor(cursorL, cursorLeftEl, stateTextLeft, handDwellLeftEl, { x: 0, y: 0 }, false, 1.0, now);
              }

}

function updateHandCursor(cursorState, cursorElement, stateTextElement, dwellFillElement, targetPos, isVisible, handRatio, now) {
  if (!isVisible) {
    if (cursorState.visible) {
      cursorElement.classList.add('hidden');
      cursorElement.classList.remove('dwelling');
      cursorElement.classList.remove('hand-closed');
      cursorState.visible = false;
      if (cursorState.targetEl) {
        cursorState.targetEl.classList.remove('motion-hover');
        cursorState.targetEl = null;
      }
      cursorState.isClosed = false;
      cursorState.wasClosed = false;
      cursorState.dwellTarget = null;
      cursorState.dwellElapsed = 0;
      cursorState.dwellStartTime = 0;
      cursorState.lastTargetSeenTime = 0;
      if (dwellFillElement) dwellFillElement.style.strokeDashoffset = '138.23';
      if (stateTextElement) stateTextElement.textContent = '';
    }
    return;
  }

  // Smooth position lerp
  cursorState.x += (targetPos.x - cursorState.x) * 0.42;
  cursorState.y += (targetPos.y - cursorState.y) * 0.42;
  cursorState.visible = true;

  cursorElement.style.transform = `translate(${cursorState.x}px, ${cursorState.y}px)`;
  cursorElement.classList.remove('hidden');

  // Hysteresis on closed state to prevent rapid toggling
  const closeThreshold = gripThreshold;
  const openThreshold = gripThreshold + 0.06;

  if (!cursorState.isClosed && handRatio < closeThreshold) {
    cursorState.isClosed = true;
  } else if (cursorState.isClosed && handRatio > openThreshold) {
    cursorState.isClosed = false;
  }

  // Sync cursor and mini HUD to top-layer popup if a dialog is open
  syncMotionControlsLayer();

  // Find interactive element under hand cursor
  const elementAtPoint = document.elementFromPoint(cursorState.x, cursorState.y);
  let clickableTarget = elementAtPoint?.closest('.motion-target, .carousel-card, button, .mode-btn, .radio-card, .radio-pill, .motion-select-card');

  // When a modal popup is open, motion selection MUST be confined to elements inside the active popup!
  const activeModal = document.querySelector('dialog[open]') || getCompletionScreen();
  if (activeModal) {
    if (clickableTarget && !activeModal.contains(clickableTarget)) {
      clickableTarget = null;
    }
  }

  // Jitter-smoothing grace period: if target momentarily lost for <= 180ms, hold target
  if (clickableTarget) {
    cursorState.lastTargetSeenTime = now;
  } else if (cursorState.dwellTarget && now - (cursorState.lastTargetSeenTime || 0) < 180) {
    clickableTarget = cursorState.dwellTarget;
  }

  if (clickableTarget) {
    if (cursorState.targetEl !== clickableTarget) {
      if (cursorState.targetEl) {
        cursorState.targetEl.classList.remove('motion-hover');
      }
      cursorState.targetEl = clickableTarget;
    }
    clickableTarget.classList.add('motion-hover');

    // Dwell Timer Selection (hovering steadily on target)
    if (cursorState.dwellTarget !== clickableTarget) {
      cursorState.dwellTarget = clickableTarget;
      cursorState.dwellStartTime = now;
      cursorState.dwellElapsed = 0;
    }

    if (now > cursorState.cooldownUntil) {
      cursorState.dwellElapsed = Math.max(0, now - cursorState.dwellStartTime);
      const progress = Math.max(0, Math.min(1, cursorState.dwellElapsed / dwellDurationMs));

      cursorElement.classList.add('dwelling');
      if (dwellFillElement) {
        const offset = 138.23 * (1 - progress);
        dwellFillElement.style.strokeDashoffset = `${offset}`;
      }

      if (stateTextElement) {
        const pct = Math.round(progress * 100);
        stateTextElement.textContent = `${pct}%`;
      }

      if (cursorState.dwellElapsed >= dwellDurationMs) {
        cursorState.cooldownUntil = now + 800;
        cursorState.dwellTarget = null;
        cursorState.dwellElapsed = 0;
        cursorState.dwellStartTime = 0;
        cursorElement.classList.remove('dwelling');
        if (dwellFillElement) dwellFillElement.style.strokeDashoffset = '138.23';
        if (stateTextElement) stateTextElement.textContent = '';

        soundEffects.playSelect();
        clickableTarget.classList.add('motion-clicked');
        setTimeout(() => clickableTarget.classList.remove('motion-clicked'), 350);
        clickableTarget.click();
      }
    }
  } else {
    // Truly no target under cursor (after grace period)
    if (cursorState.targetEl) {
      cursorState.targetEl.classList.remove('motion-hover');
      cursorState.targetEl = null;
    }
    cursorState.dwellTarget = null;
    cursorState.dwellElapsed = 0;
    cursorState.dwellStartTime = 0;
    cursorElement.classList.remove('dwelling');
    if (dwellFillElement) dwellFillElement.style.strokeDashoffset = '138.23';

    if (stateTextElement) {
      if (clickSelectionMode === 'dwell') {
        // Dwell mode: remove Open and Closed indicators!
        stateTextElement.textContent = '';
      } else {
        // Fist / both mode
        stateTextElement.textContent = cursorState.isClosed ? 'Closed' : 'Open';
      }
    }
  }

  cursorState.wasClosed = cursorState.isClosed;
}

// ============================================================================
// "Cross Hands in X" Gesture Engine (Return to Main Menu / Previous Step)
// ============================================================================
function ccw(ax, ay, bx, by, cx, cy) {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
}

function linesIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  return (
    ccw(p1x, p1y, p3x, p3y, p4x, p4y) !== ccw(p2x, p2y, p3x, p3y, p4x, p4y) &&
    ccw(p1x, p1y, p2x, p2y, p3x, p3y) !== ccw(p1x, p1y, p2x, p2y, p4x, p4y)
  );
}

function checkCrossHands(landmarks) {
  if (!landmarks || landmarks.length < 17) return false;
  const ls = landmarks[11]; // left shoulder
  const rs = landmarks[12]; // right shoulder
  const le = landmarks[13]; // left elbow
  const re = landmarks[14]; // right elbow
  const lw = landmarks[15]; // left wrist
  const rw = landmarks[16]; // right wrist

  if (!ls || !rs || !le || !re || !lw || !rw) return false;

  // Visibility check: arms crossing can partially occlude one wrist, so keep threshold relaxed
  if ((lw.visibility ?? 0) < 0.25 || (rw.visibility ?? 0) < 0.25) return false;
  if ((ls.visibility ?? 0) < 0.35 || (rs.visibility ?? 0) < 0.35) return false;

  const sVecX = ls.x - rs.x;
  const sVecY = ls.y - rs.y;
  const shoulderWidth = Math.hypot(sVecX, sVecY);
  if (shoulderWidth < 0.05) return false;

  const sMidX = (ls.x + rs.x) / 2;
  const sMidY = (ls.y + rs.y) / 2;
  const sDirX = sVecX / shoulderWidth;
  const sDirY = sVecY / shoulderWidth;

  // 1. Forearm segment intersection test:
  // Left forearm segment (le -> lw or left index tip)
  // Right forearm segment (re -> rw or right index tip)
  const lTip = (landmarks[19]?.visibility ?? 0) > 0.3 ? landmarks[19] : lw;
  const rTip = (landmarks[20]?.visibility ?? 0) > 0.3 ? landmarks[20] : rw;

  const forearmsIntersect =
    linesIntersect(le.x, le.y, lw.x, lw.y, re.x, re.y, rw.x, rw.y) ||
    linesIntersect(le.x, le.y, lTip.x, lTip.y, re.x, re.y, rTip.x, rTip.y);

  // 2. Wrist horizontal crossover relative to shoulder axis:
  // In normal pose: lw is on left side (lwProj > 0), rw is on right side (rwProj < 0), so lwProj > rwProj.
  // In crossed 'X' pose: wrists cross past each other, so rwProj > lwProj or wrists are in close center overlap.
  const lwProj = (lw.x - sMidX) * sDirX + (lw.y - sMidY) * sDirY;
  const rwProj = (rw.x - sMidX) * sDirX + (rw.y - sMidY) * sDirY;
  const wristDist = Math.hypot(lw.x - rw.x, lw.y - rw.y);

  const wristsCrossed = (rwProj > lwProj) || (wristDist < shoulderWidth * 0.38 && Math.abs(lwProj) < shoulderWidth * 0.35);

  // 3. Hands must be raised in front of the upper body (chest/chin to mid-torso level)
  const avgY = (lw.y + rw.y) / 2;
  const inHeightRange = avgY > sMidY - shoulderWidth * 0.55 && avgY < sMidY + shoulderWidth * 1.35;

  return inHeightRange && (forearmsIntersect || (wristsCrossed && wristDist < shoulderWidth * 0.52));
}

// Keep alias so any test references continue working
const checkHandsToChest = checkCrossHands;

function processCrossHandsPose(landmarks, dt, now) {
  const isCrossed = checkCrossHands(landmarks);
  const banner = $('chest-pose-banner');
  const progressEl = $('chest-banner-progress');
  const subtitleEl = $('chest-banner-subtitle');

  const activeDialog = document.querySelector('dialog[open]');
  if (subtitleEl) {
    if (activeDialog?.id === 'dialog-posture') {
      subtitleEl.textContent = 'Cross hands (X) to return…';
    } else {
      subtitleEl.textContent = activeDialog ? 'Hold X to Go Back…' : 'Hold X to Return to Menu…';
    }
  }

  // Inside modal popups, require 1400ms hold time to prevent accidental navigation
  // In game view or details view, require 650ms hold time
  const requiredHoldTime = activeDialog ? 1400 : 650;

  if (isCrossed && now > chestCooldownUntil) {
    chestPoseElapsed += dt * 1000;
    banner.classList.remove('hidden');

    const progressPct = Math.min(100, (chestPoseElapsed / requiredHoldTime) * 100);
    if (progressEl) progressEl.style.width = `${progressPct}%`;

    if (chestPoseElapsed >= requiredHoldTime) {
      // TRIGGER BACK TO MENU OR PREVIOUS POPUP STEP!
      chestCooldownUntil = now + 1200;
      chestPoseElapsed = 0;
      banner.classList.add('hidden');

      if (activeDialog) {
        if (activeDialog.id === 'dialog-select-mode') {
          openHandPopup();
          soundEffects.playNav();
        } else if (activeDialog.id === 'dialog-hand' || activeDialog.id === 'dialog-posture') {
          // In initial hand setup, there is no previous step.
          return;
        } else {
          closeAllPopups();
          soundEffects.playNav();
        }
      } else if (currentView === 'game') {
        returnToCarousel();
      } else if (currentView === 'details') {
        returnToCarousel();
      }
    }
  } else {
    chestPoseElapsed = 0;
    banner.classList.add('hidden');
    if (progressEl) progressEl.style.width = '0%';
  }
}

const processChestPose = processCrossHandsPose;

// ============================================================================
// ============================================================================
// Hand Swipe Gestures Based on Hand Preference
// - Right mode: Right hand swipe right -> Next, Right hand swipe left -> Previous
// - Left mode:  Left hand swipe right -> Next, Left hand swipe left -> Previous
// - Both mode:  Left hand swipe left -> Previous, Right hand swipe right -> Next
// ============================================================================
const leftHandSwipeHistory = [];
const rightHandSwipeHistory = [];

function updateSwipeHistory(history, currentMirrorX, now) {
  history.push({ t: now, x: currentMirrorX });
  while (history.length > 0 && now - history[0].t > 320) {
    history.shift();
  }
}

function detectSwipeDirection(history, currentMirrorX, now) {
  if (history.length < 3) return null;

  let minSample = history[0];
  let maxSample = history[0];
  for (let i = 1; i < history.length; i++) {
    if (history[i].x < minSample.x) minSample = history[i];
    if (history[i].x > maxSample.x) maxSample = history[i];
  }

  // Right swipe check (dx > 0)
  const dtRight = (now - minSample.t) / 1000;
  if (dtRight >= 0.06 && dtRight <= 0.32) {
    const dx = currentMirrorX - minSample.x;
    const speed = dx / dtRight;
    if (dx > 0.055 && speed > 0.26) {
      return 'right';
    }
  }

  // Left swipe check (dx < 0)
  const dtLeft = (now - maxSample.t) / 1000;
  if (dtLeft >= 0.06 && dtLeft <= 0.32) {
    const dx = currentMirrorX - maxSample.x;
    const speed = Math.abs(dx) / dtLeft;
    if (dx < -0.055 && speed > 0.26) {
      return 'left';
    }
  }

  return null;
}

function processHandSwipes(lm, now) {
  if (now <= swipeCooldownUntil) return;
  const activeDialog = document.querySelector('dialog[open]');
  // While any popup dialog is open, disable swipe navigation to prevent accidental
  // back/forward steps when the user reaches or points at options on screen.
  if (activeDialog) return;
  if (currentView !== 'carousel') return;

  const lw = lm[15]; // Left wrist
  const rw = lm[16]; // Right wrist

  let swipeAction = null; // { direction: 'prev' | 'next', label: string }

  if (activeSelectingHand === 'right') {
    // Right hand mode: right hand swipe right -> next card, right hand swipe left -> previous card
    if (rw && (rw.visibility ?? 0) >= 0.35) {
      const mirrorRightX = 1 - rw.x;
      updateSwipeHistory(rightHandSwipeHistory, mirrorRightX, now);
      const dir = detectSwipeDirection(rightHandSwipeHistory, mirrorRightX, now);
      if (dir === 'right') {
        swipeAction = { direction: 'next', label: 'Right Hand Swiped Right: Next Card' };
      } else if (dir === 'left') {
        swipeAction = { direction: 'prev', label: 'Right Hand Swiped Left: Previous Card' };
      }
    }
  } else if (activeSelectingHand === 'left') {
    // Left hand mode: left hand swipe right -> next card, left hand swipe left -> previous card
    if (lw && (lw.visibility ?? 0) >= 0.35) {
      const mirrorLeftX = 1 - lw.x;
      updateSwipeHistory(leftHandSwipeHistory, mirrorLeftX, now);
      const dir = detectSwipeDirection(leftHandSwipeHistory, mirrorLeftX, now);
      if (dir === 'right') {
        swipeAction = { direction: 'next', label: 'Left Hand Swiped Right: Next Card' };
      } else if (dir === 'left') {
        swipeAction = { direction: 'prev', label: 'Left Hand Swiped Left: Previous Card' };
      }
    }
  } else {
    // Both hands mode: left hand swipes left for prev card, right hand swipes right for next card
    if (lw && (lw.visibility ?? 0) >= 0.35) {
      const mirrorLeftX = 1 - lw.x;
      updateSwipeHistory(leftHandSwipeHistory, mirrorLeftX, now);
      const dir = detectSwipeDirection(leftHandSwipeHistory, mirrorLeftX, now);
      if (dir === 'left') {
        swipeAction = { direction: 'prev', label: 'Left Hand Swiped Left: Previous Card' };
      }
    }
    if (!swipeAction && rw && (rw.visibility ?? 0) >= 0.35) {
      const mirrorRightX = 1 - rw.x;
      updateSwipeHistory(rightHandSwipeHistory, mirrorRightX, now);
      const dir = detectSwipeDirection(rightHandSwipeHistory, mirrorRightX, now);
      if (dir === 'right') {
        swipeAction = { direction: 'next', label: 'Right Hand Swiped Right: Next Card' };
      }
    }
  }

  if (swipeAction) {
    swipeCooldownUntil = now + 500;
    leftHandSwipeHistory.length = 0;
    rightHandSwipeHistory.length = 0;

    if (swipeAction.direction === 'prev') {
      prevCard();
      const prevBtn = $('carousel-prev');
      if (prevBtn) {
        prevBtn.classList.add('motion-clicked');
        setTimeout(() => prevBtn.classList.remove('motion-clicked'), 350);
      }
      setStatusText(swipeAction.label);
    } else {
      nextCard();
      const nextBtn = $('carousel-next');
      if (nextBtn) {
        nextBtn.classList.add('motion-clicked');
        setTimeout(() => nextBtn.classList.remove('motion-clicked'), 350);
      }
      setStatusText(swipeAction.label);
    }
  }
}

// ============================================================================
// Keyboard Navigation Support
// ============================================================================
window.addEventListener('keydown', (e) => {
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog) {
    if (e.key === 'Escape') openDialog.close();
    return;
  }

  // Press H to toggle selecting hand between Both, Right, and Left
  if (e.key === 'h' || e.key === 'H') {
    const nextHand = activeSelectingHand === 'both' ? 'right' : (activeSelectingHand === 'right' ? 'left' : 'both');
    setActiveSelectingHand(nextHand);
    return;
  }

  if (currentView === 'carousel') {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevCard();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextCard();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (document.activeElement?.tagName !== 'BUTTON') {
        e.preventDefault();
        openGameDetails(activeCardIndex);
      }
    } else if (e.key === 's' || e.key === 'S') {
      setPostureMode('standing');
    } else if (e.key === 'c' || e.key === 'C') {
      if (mode === 'camera') stopCamera();
      else startCamera();
    }
  } else if (currentView === 'details') {
    if (e.key === 'Escape') {
      e.preventDefault();
      returnToCarousel();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (document.activeElement?.tagName !== 'BUTTON') {
        e.preventDefault();
        launchActiveGame();
      }
    }
  } else if (currentView === 'game') {
    if (e.key === 'Escape') {
      e.preventDefault();
      returnToCarousel();
    } else if (e.key === 's' || e.key === 'S') {
      setPostureMode(postureMode === 'sitting' ? 'standing' : 'sitting');
    }
  }
});

// Mini camera toggle button
$('btn-toggle-mini-cam').onclick = () => {
  const body = $('mini-camera-body');
  const btn = $('btn-toggle-mini-cam');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    btn.textContent = '—';
  } else {
    body.style.display = 'none';
    btn.textContent = '+';
  }
};

// ============================================================================
// ============================================================================
// ============================================================================
// Modal Dialogs & Motion-Optimized Popups
// ============================================================================
const dialogPosture = $('dialog-posture');
const dialogHand = $('dialog-hand');
const dialogSelectMode = $('dialog-select-mode');
const dialogAccessibility = $('accessibility-dialog');
const btnSettings = $('btn-settings') || $('btn-accessibility');

function syncMotionControlsLayer() {
  const activeDialog = document.querySelector('dialog[open]');
  const target = activeDialog || $('app') || document.body;
  if (!target) return;

  if (cursorLeftEl && cursorLeftEl.parentElement !== target) {
    target.appendChild(cursorLeftEl);
  }
  if (cursorRightEl && cursorRightEl.parentElement !== target) {
    target.appendChild(cursorRightEl);
  }
  const miniHud = $('mini-camera-hud');
  if (miniHud && miniHud.parentElement !== target) {
    target.appendChild(miniHud);
  }
  const chestBanner = $('chest-pose-banner');
  if (chestBanner && chestBanner.parentElement !== target) {
    target.appendChild(chestBanner);
  }
}

[dialogPosture, dialogHand, dialogSelectMode, dialogAccessibility].forEach((dlg) => {
  if (dlg) {
    dlg.addEventListener('close', () => {
      syncMotionControlsLayer();
      updateRendererAttachment();
    });
  }
});

if (dialogPosture) {
  dialogPosture.addEventListener('cancel', (e) => {
    const isSetupDone = getStoredPreference('adaptmove_setup_complete') === 'true';
    if (!isSetupDone) {
      e.preventDefault();
    }
  });
}

function closeAllPopups() {
  if (dialogPosture?.open) dialogPosture.close();
  if (dialogHand?.open) dialogHand.close();
  if (dialogSelectMode?.open) dialogSelectMode.close();
  if (dialogAccessibility?.open) dialogAccessibility.close();
  syncMotionControlsLayer();
  updateRendererAttachment();
}

function updatePostureCards() {
  const optStand = $('opt-posture-standing');
  if (optStand) optStand.classList.add('active');
}

function updateHandCards() {
  const optR = $('opt-hand-right');
  const optL = $('opt-hand-left');
  const optB = $('opt-hand-both');
  if (optR) optR.classList.toggle('active', activeSelectingHand === 'right');
  if (optL) optL.classList.toggle('active', activeSelectingHand === 'left');
  if (optB) optB.classList.toggle('active', activeSelectingHand === 'both');

  // Select corresponding radio in accessibility settings dialog
  const radioHand = document.querySelector(`input[name="setting-active-hand"][value="${activeSelectingHand}"]`);
  if (radioHand) radioHand.checked = true;
}

function updateDwellCards() {
  // Highlight active dwell cards in Step 3 popup
  document.querySelectorAll('.dwell-card').forEach((card) => {
    const val = Number(card.getAttribute('data-dwell-val'));
    card.classList.toggle('active', val === dwellDurationMs);
  });

  // Select corresponding radio in accessibility settings dialog
  const radioDwell = document.querySelector(`input[name="setting-dwell-time"][value="${dwellDurationMs}"]`);
  if (radioDwell) radioDwell.checked = true;

  updateSelectModeHints();
}

function openPosturePopup() {
  openHandPopup();
}

function openHandPopup() {
  closeAllPopups();
  updateHandCards();
  if (dialogHand) {
    dialogHand.showModal();
    syncMotionControlsLayer();
    updateRendererAttachment();
  }
}

function openSelectModePopup() {
  closeAllPopups();
  updateDwellCards();
  if (dialogSelectMode) {
    dialogSelectMode.showModal();
    syncMotionControlsLayer();
  }
}

function openAccessibilityDialog(targetSection = 'accessibility') {
  closeAllPopups();
  updatePostureCards();
  updateHandCards();
  updateDwellCards();
  if (dialogAccessibility) {
    dialogAccessibility.showModal();
    syncMotionControlsLayer();
    requestAnimationFrame(() => {
      const sec = $('section-accessibility');
      if (sec) {
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        sec.classList.add('section-highlight');
        setTimeout(() => sec.classList.remove('section-highlight'), 1200);
      }
    });
  }
}

// Brand Home Button (Blue) in Header
const btnHome = $('btn-home');
if (btnHome) {
  btnHome.onclick = () => {
    closeAllPopups();
    returnToCarousel();
  };
}

// Gear Icon Button in Header
if (btnSettings) {
  btnSettings.onclick = () => {
    openAccessibilityDialog();
  };
}

// ----------------------------------------------------------------------------
// 1. Posture Popup Controls
// ----------------------------------------------------------------------------
const optPostureSit = $('opt-posture-sitting');
const optPostureStand = $('opt-posture-standing');
if (optPostureSit) {
  optPostureSit.onclick = () => {
    setPostureMode('standing');
    updatePostureCards();
  };
}
if (optPostureStand) {
  optPostureStand.onclick = () => {
    setPostureMode('standing');
    updatePostureCards();
  };
}

const btnPostureNext = $('btn-posture-next');
if (btnPostureNext) {
  btnPostureNext.onclick = () => {
    soundEffects.playNav();
    openHandPopup();
  };
}

const btnPostureToAccess = $('btn-posture-to-accessibility');
if (btnPostureToAccess) {
  btnPostureToAccess.onclick = () => {
    soundEffects.playNav();
    openAccessibilityDialog('accessibility');
  };
}

const btnClosePosture = $('btn-close-posture');
if (btnClosePosture) {
  btnClosePosture.onclick = () => {
    closeAllPopups();
    saveAllPreferences();
  };
}

// Posture Radios inside full accessibility dialog
document.querySelectorAll('input[name="setting-posture"]').forEach((radio) => {
  radio.onchange = (e) => {
    setPostureMode(e.target.value);
    updatePostureCards();
  };
});

// ----------------------------------------------------------------------------
// 2. Hand Mode Popup Controls
// ----------------------------------------------------------------------------
function setActiveSelectingHand(newHand, playSound = true) {
  if (newHand !== 'left' && newHand !== 'right' && newHand !== 'both') return;
  activeSelectingHand = newHand;
  savePreference('adaptmove_active_hand', activeSelectingHand);

  // Update header quick toggle buttons if present
  const btnLeft = $('btn-hand-left');
  const btnRight = $('btn-hand-right');
  if (btnLeft) {
    btnLeft.classList.toggle('active', activeSelectingHand === 'left');
    btnLeft.setAttribute('aria-pressed', activeSelectingHand === 'left' ? 'true' : 'false');
  }
  if (btnRight) {
    btnRight.classList.toggle('active', activeSelectingHand === 'right');
    btnRight.setAttribute('aria-pressed', activeSelectingHand === 'right' ? 'true' : 'false');
  }

  updateHandCards();

  // Immediately hide inactive cursor
  if (activeSelectingHand === 'right') {
    cursorLeftEl.classList.add('hidden');
    cursorLeftEl.classList.remove('dwelling');
    cursorL.visible = false;
    cursorL.targetEl = null;
    cursorL.dwellTarget = null;
    cursorL.dwellElapsed = 0;
    cursorL.lastTargetSeenTime = 0;
    if (stateTextLeft) stateTextLeft.textContent = '';
    if (handDwellLeftEl) handDwellLeftEl.style.strokeDashoffset = '138.23';
  } else if (activeSelectingHand === 'left') {
    cursorRightEl.classList.add('hidden');
    cursorRightEl.classList.remove('dwelling');
    cursorR.visible = false;
    cursorR.targetEl = null;
    cursorR.dwellTarget = null;
    cursorR.dwellElapsed = 0;
    cursorR.lastTargetSeenTime = 0;
    if (stateTextRight) stateTextRight.textContent = '';
    if (handDwellRightEl) handDwellRightEl.style.strokeDashoffset = '138.23';
  }

  updateSelectModeHints();
  if (playSound) soundEffects.playNav();
}

const optHandR = $('opt-hand-right');
const optHandL = $('opt-hand-left');
const optHandB = $('opt-hand-both');
if (optHandR) optHandR.onclick = () => setActiveSelectingHand('right');
if (optHandL) optHandL.onclick = () => setActiveSelectingHand('left');
if (optHandB) optHandB.onclick = () => setActiveSelectingHand('both');

const btnHandBack = $('btn-hand-back');
if (btnHandBack) {
  btnHandBack.onclick = () => {
    soundEffects.playNav();
    openPosturePopup();
  };
}

const btnHandNext = $('btn-hand-next');
if (btnHandNext) {
  btnHandNext.onclick = () => {
    soundEffects.playNav();
    openSelectModePopup();
  };
}

const btnHandToAccess = $('btn-hand-to-accessibility');
if (btnHandToAccess) {
  btnHandToAccess.onclick = () => {
    soundEffects.playNav();
    openAccessibilityDialog('accessibility');
  };
}

const btnCloseHand = $('btn-close-hand');
if (btnCloseHand) {
  btnCloseHand.onclick = () => {
    closeAllPopups();
    saveAllPreferences();
  };
}

// Selecting Hand Radios inside full accessibility dialog
document.querySelectorAll('input[name="setting-active-hand"]').forEach((radio) => {
  radio.onchange = (e) => {
    setActiveSelectingHand(e.target.value);
  };
});

// Selecting Hand Quick Toggle in Header if present
const btnHandHeaderL = $('btn-hand-left');
const btnHandHeaderR = $('btn-hand-right');
if (btnHandHeaderL) btnHandHeaderL.onclick = () => setActiveSelectingHand('left');
if (btnHandHeaderR) btnHandHeaderR.onclick = () => setActiveSelectingHand('right');

// Theme Color Selection Listeners (Setup Modal, Settings Dialog, and Header)
document.querySelectorAll('.color-swatch-btn, .quick-color-btn').forEach((btn) => {
  btn.onclick = () => {
    const color = btn.dataset.color;
    if (color) setThemeColor(color, true);
  };
});

// ----------------------------------------------------------------------------
// 3. Dwell Timer Duration Selection Popup Controls
// ----------------------------------------------------------------------------
document.querySelectorAll('.dwell-card').forEach((card) => {
  card.onclick = () => {
    dwellDurationMs = Number(card.getAttribute('data-dwell-val'));
    savePreference('adaptmove_dwell_time', dwellDurationMs);
    updateDwellCards();
    updateSelectModeHints();
    soundEffects.playNav();
  };
});

const btnSelectModeBack = $('btn-select-mode-back');
if (btnSelectModeBack) {
  btnSelectModeBack.onclick = () => {
    soundEffects.playNav();
    openHandPopup();
  };
}

const btnSelectModeSave = $('btn-select-mode-save');
if (btnSelectModeSave) {
  btnSelectModeSave.onclick = () => {
    saveAllPreferences();
    setCookie('adaptmove_setup_complete', 'true', 365);
    closeAllPopups();
    soundEffects.playSelect();
  };
}

const btnSelectModeToAccess = $('btn-select-mode-to-accessibility');
if (btnSelectModeToAccess) {
  btnSelectModeToAccess.onclick = () => {
    soundEffects.playNav();
    openAccessibilityDialog('accessibility');
  };
}

const btnCloseSelectMode = $('btn-close-select-mode');
if (btnCloseSelectMode) {
  btnCloseSelectMode.onclick = () => {
    closeAllPopups();
    saveAllPreferences();
  };
}

// Radios inside accessibility dialog for Dwell Time
document.querySelectorAll('input[name="setting-dwell-time"]').forEach((radio) => {
  radio.onchange = (e) => {
    dwellDurationMs = Number(e.target.value);
    savePreference('adaptmove_dwell_time', dwellDurationMs);
    updateDwellCards();
    updateSelectModeHints();
  };
});

// Contrast Setting
document.querySelectorAll('input[name="setting-contrast"]').forEach((radio) => {
  radio.onchange = (e) => {
    const val = e.target.value;
    document.body.setAttribute('data-theme', val);
    savePreference('adaptmove_contrast', val);
  };
});

// Reduced Motion Setting
document.querySelectorAll('input[name="setting-reduced-motion"]').forEach((radio) => {
  radio.onchange = (e) => {
    const val = e.target.value;
    document.body.setAttribute('data-motion', val);
    savePreference('adaptmove_motion', val);
  };
});

// Text Size Setting
document.querySelectorAll('input[name="setting-text-size"]').forEach((radio) => {
  radio.onchange = (e) => {
    const val = e.target.value;
    document.documentElement.setAttribute('data-text-size', val);
    document.body.setAttribute('data-text-size', val);
    savePreference('adaptmove_text_size', val);
  };
});

// Color Blindness Setting
document.querySelectorAll('input[name="setting-colorblind"]').forEach((radio) => {
  radio.onchange = (e) => {
    const val = e.target.value;
    document.documentElement.setAttribute('data-colorblind', val);
    document.body.setAttribute('data-colorblind', val);
    savePreference('adaptmove_colorblind', val);
  };
});

// Audio Feedback Setting
$('setting-audio-feedback').onchange = (e) => {
  soundEffects.setEnabled(e.target.checked);
  savePreference('adaptmove_sound', e.target.checked ? 'true' : 'false');
};

// ----------------------------------------------------------------------------
// 4. Accessibility Dialog Controls
// ----------------------------------------------------------------------------
function saveAllPreferences() {
  savePreference('adaptmove_posture', postureMode);
  savePreference('adaptmove_active_hand', activeSelectingHand);
  savePreference('adaptmove_click_mode', 'dwell');
  savePreference('adaptmove_dwell_time', dwellDurationMs);
  savePreference('adaptmove_theme_color', currentThemeColor);
  const contrast = document.body.getAttribute('data-theme') || 'standard';
  savePreference('adaptmove_contrast', contrast);
  const motion = document.body.getAttribute('data-motion') || 'standard';
  savePreference('adaptmove_motion', motion);
  const colorBlind = document.body.getAttribute('data-colorblind') || 'none';
  savePreference('adaptmove_colorblind', colorBlind);
  const textSize = document.body.getAttribute('data-text-size') || '130';
  savePreference('adaptmove_text_size', textSize);
  const soundCb = $('setting-audio-feedback');
  savePreference('adaptmove_sound', soundCb?.checked ? 'true' : 'false');
  savePreference('adaptmove_setup_complete', 'true');
}

// Accessibility Dialog Close and Save Buttons
$('btn-close-dialog').onclick = () => {
  saveAllPreferences();
  closeAllPopups();
};

$('btn-save-dialog').onclick = () => {
  saveAllPreferences();
  closeAllPopups();
  soundEffects.playSelect();
};

function updateSelectModeHints() {
  const dwellSec = (dwellDurationMs / 1000).toFixed(1);
  const hintEl = $('hint-select-mode');
  const dwellHintEl = $('details-dwell-hint');
  const handHintEl = $('hint-active-hand');
  const swipePrevEl = $('hint-swipe-prev');
  const swipeNextEl = $('hint-swipe-next');

  if (handHintEl) {
    const handLabel = activeSelectingHand === 'both' ? 'Both Hands' : (activeSelectingHand === 'left' ? 'Left' : 'Right');
    handHintEl.innerHTML = `<kbd>Selecting Hand:</kbd> ${handLabel}`;
  }

  if (swipePrevEl && swipeNextEl) {
    if (activeSelectingHand === 'right') {
      swipePrevEl.innerHTML = `<kbd>Right Hand Swipe &larr;</kbd> Previous`;
      swipeNextEl.innerHTML = `<kbd>Right Hand Swipe &rarr;</kbd> Next`;
    } else if (activeSelectingHand === 'left') {
      swipePrevEl.innerHTML = `<kbd>Left Hand Swipe &larr;</kbd> Previous`;
      swipeNextEl.innerHTML = `<kbd>Left Hand Swipe &rarr;</kbd> Next`;
    } else {
      swipePrevEl.innerHTML = `<kbd>Left Hand Swipe &larr;</kbd> Previous`;
      swipeNextEl.innerHTML = `<kbd>Right Hand Swipe &rarr;</kbd> Next`;
    }
  }

  const handNoun = activeSelectingHand === 'both' ? 'hand' : (activeSelectingHand === 'left' ? 'left hand' : 'right hand');

  if (hintEl) hintEl.innerHTML = `<kbd>Hover ${dwellSec}s</kbd> Select`;
  // Note: carousel-subheading remains "Choose your activity" as requested
  if (dwellHintEl) dwellHintEl.innerHTML = `Move ${handNoun} cursor over <strong>Start Activity</strong> and <strong>hover for ${dwellSec}s</strong> to select, or cross <strong>hands in an 'X'</strong> to go back`;
}

// Load saved accessibility preferences
function loadSavedPreferences() {
  setPostureMode('standing', false);

  const savedActiveHand = getStoredPreference('adaptmove_active_hand');
  const validHand = (savedActiveHand === 'left' || savedActiveHand === 'right' || savedActiveHand === 'both') ? savedActiveHand : 'both';
  setActiveSelectingHand(validHand, false);

  clickSelectionMode = 'dwell';
  savePreference('adaptmove_click_mode', 'dwell');

  const savedDwellTime = getStoredPreference('adaptmove_dwell_time');
  if (savedDwellTime) {
    dwellDurationMs = Number(savedDwellTime);
  }

  const savedColor = getStoredPreference('adaptmove_theme_color');
  const validColor = (savedColor && THEME_COLORS[savedColor]) ? savedColor : 'blue';
  setThemeColor(validColor, false);

  const savedContrast = getStoredPreference('adaptmove_contrast');
  if (savedContrast) {
    document.body.setAttribute('data-theme', savedContrast);
    const r = document.querySelector(`input[name="setting-contrast"][value="${savedContrast}"]`);
    if (r) r.checked = true;
  }

  const savedMotion = getStoredPreference('adaptmove_motion');
  if (savedMotion) {
    document.body.setAttribute('data-motion', savedMotion);
    const r = document.querySelector(`input[name="setting-reduced-motion"][value="${savedMotion}"]`);
    if (r) r.checked = true;
  }

  const savedColorBlind = getStoredPreference('adaptmove_colorblind') || 'none';
  if (savedColorBlind) {
    document.documentElement.setAttribute('data-colorblind', savedColorBlind);
    document.body.setAttribute('data-colorblind', savedColorBlind);
    const r = document.querySelector(`input[name="setting-colorblind"][value="${savedColorBlind}"]`);
    if (r) r.checked = true;
  }

  const savedTextSize = getStoredPreference('adaptmove_text_size');
  const validTextSize = (savedTextSize === '150' || savedTextSize === '175') ? savedTextSize : '130';
  document.documentElement.setAttribute('data-text-size', validTextSize);
  document.body.setAttribute('data-text-size', validTextSize);
  const r = document.querySelector(`input[name="setting-text-size"][value="${validTextSize}"]`);
  if (r) r.checked = true;

  const savedSound = getStoredPreference('adaptmove_sound');
  if (savedSound !== null) {
    const enabled = savedSound === 'true';
    soundEffects.setEnabled(enabled);
    const soundCb = $('setting-audio-feedback');
    if (soundCb) soundCb.checked = enabled;
  }

  updatePostureCards();
  updateHandCards();
  updateDwellCards();
  updateSelectModeHints();
}

loadSavedPreferences();

// Pop up hand setup on website load if not saved via cookie yet
const isSetupComplete = getStoredPreference('adaptmove_setup_complete') === 'true';
if (!isSetupComplete) {
  setTimeout(() => {
    openHandPopup();
  }, 250);
}

// ============================================================================
// Camera Frame Rendering & Animation Loop
// ============================================================================
function drawLandmarksAndVideo(points) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // 1. Draw live mirrored video feed into mini overlay popup
  if (video.readyState >= 2 && video.videoWidth > 0) {
    miniCtx.save();
    miniCtx.translate(miniOverlay.width, 0);
    miniCtx.scale(-1, 1);
    miniCtx.drawImage(video, 0, 0, miniOverlay.width, miniOverlay.height);
    miniCtx.restore();

    // In game view, also render live mirrored video onto aside canvas
    const gameCamCanvas = $('game-camera-canvas');
    if (gameCamCanvas && currentView === 'game') {
      if (gameCamCanvas.width !== video.videoWidth) {
        gameCamCanvas.width = video.videoWidth;
        gameCamCanvas.height = video.videoHeight;
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }
      const gameCtx = gameCamCanvas.getContext('2d');
      gameCtx.save();
      gameCtx.translate(gameCamCanvas.width, 0);
      gameCtx.scale(-1, 1);
      gameCtx.drawImage(video, 0, 0, gameCamCanvas.width, gameCamCanvas.height);
      gameCtx.restore();
    }
  }

  if (!points) return;

  // 2. Draw landmarks on game aside overlay (mirrored to match mirrored video)
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2.5;
  for (const [a, b] of DETAILED_POSE_CONNECTIONS) {
    if ((points[a].visibility ?? 0) < 0.5 || (points[b].visibility ?? 0) < 0.5) continue;
    const ax = (1 - points[a].x) * overlay.width;
    const ay = points[a].y * overlay.height;
    const bx = (1 - points[b].x) * overlay.width;
    const by = points[b].y * overlay.height;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // 3. Draw landmarks on mini overlay (popup)
  miniCtx.strokeStyle = '#38bdf8';
  miniCtx.lineWidth = 2;
  for (const [a, b] of DETAILED_POSE_CONNECTIONS) {
    if ((points[a].visibility ?? 0) < 0.5 || (points[b].visibility ?? 0) < 0.5) continue;
    // In miniCtx, because video was drawn mirrored, mirror points too:
    const ax = (1 - points[a].x) * miniOverlay.width;
    const ay = points[a].y * miniOverlay.height;
    const bx = (1 - points[b].x) * miniOverlay.width;
    const by = points[b].y * miniOverlay.height;

    miniCtx.beginPath();
    miniCtx.moveTo(ax, ay);
    miniCtx.lineTo(bx, by);
    miniCtx.stroke();
  }
}

let previous = performance.now();
let lastInference = 0;
let latest = null;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;

  const handDlg = $('dialog-hand');
  const postureDlg = $('dialog-posture');
  const isWelcomePreviewActive = Boolean((handDlg?.open || postureDlg?.open) && $('welcome-bot-viewport'));

  const isBoxingGame = currentView === 'game' && activeGame.gameType === 'boxing-beat';
  boxingOpponent.group.visible = isBoxingGame;
  if (isBoxingGame) {
    const boxingState = boxingRound.snapshot(now);
    renderBoxingRound(boxingState);
    const cue = boxingRound.active
      ? boxingState.cues.find((item) => item.state === 'now')
        || boxingState.cues.find((item) => item.state === 'upcoming' && item.inMs <= 900)
      : null;
    boxingOpponent.update(now, dt, cue?.opponentAction || 'idle', cue?.state === 'upcoming');
  } else {
    boxingOpponent.update(now, dt, 'idle');
  }

  if (rig) {
    if (gameCountdownActive) {
      rig.reset(1 - Math.exp(-7 * dt));
    } else if (mode === 'demo') {
      rig.demo(now / 1000, dt);
    } else if (mode === 'camera') {
      if (now - lastInference > 33 && video.readyState >= 2 && video.currentTime !== tracker.lastVideoTime) {
        lastInference = now;
        try {
          const frame = tracker.detect(video, now);
          latest = frame?.worldLandmarks?.length ? frame : null;
          pipeline.process(frame?.landmarks || null, now);
          drawLandmarksAndVideo(frame?.landmarks);

          if (latest) {
            lastSeen = now;
            const poses = classifier.update(frame.landmarks, frame.worldLandmarks, now);
            const poseName = poses[0]?.name || 'Following your movement';
            if ($('pose')) $('pose').textContent = poseName;
            if (!wasTracking) {
              status('Tracking live · mirror mode');
            }
            wasTracking = true;

            const lm = frame.landmarks;
            if (currentView === 'game' && activeGame.gameType === 'boxing-beat' && boxingRound.active) {
              if (!boxingBaseline) {
                boxingBaseline = calibrateBoxingPose(lm);
                if (boxingBaseline) boxingRound.feedback = 'Centered and calibrated — get ready!';
              }
              const punch = boxingPunchDetector.update(frame.worldLandmarks);
              const move = punch || detectBoxingMove(lm, frame.worldLandmarks, boxingBaseline);
              const boxingState = boxingRound.tick(now, move);
              handleBoxingRoundEvents(boxingState, now);
              renderBoxingRound(boxingState);
            } else if (currentView === 'game' && activeGame.gameType === 'flying') {
              currentFlightInput = wingController.update(lm, now, frame.worldLandmarks);
            } else if (currentView === 'game' && activeGame.gameType === 'stretching') {
              updateStretchingMotion(lm, frame.worldLandmarks, dt, now);
            }

            updateMotionHands(lm, now);

            // Process "Cross Hands in X" Gesture
            processCrossHandsPose(lm, dt, now);

            // Process Hand Swipes (Left Hand Swipe Left -> Prev, Right Hand Swipe Right -> Next)
            processHandSwipes(lm, now);
          }
        } catch (err) {
          console.warn('Frame processing notice:', err);
        }
      }

      if (mode === 'camera' && latest && now - lastSeen < 450) {
        // Automatically follow legs if legs are in frame
        const followLegs = Boolean(latest.worldLandmarks && ([25, 26, 27, 28].some(i => (latest.worldLandmarks[i]?.visibility ?? 1) > 0.45)));
        if (roundComplete) {
          rig.reset(1 - Math.exp(-6 * dt));
        } else if (currentView === 'game' && activeGame.gameType === 'flying') {
          rig.reset(1 - Math.exp(-6 * dt));
        } else {
          rig.apply(latest.worldLandmarks, dt, followLegs, currentView === 'game' && activeGame.gameType === 'stretching');
        }
      } else if (isWelcomePreviewActive) {
        // Friendly greeting wave from Blue while in the welcome setup dialog
        rig.wave(now * 0.0018, dt);
      } else {
        rig.reset(1 - Math.exp(-5 * dt));
        if (now - lastSeen > 700 && mode === 'camera') {
          latest = null;
          wasTracking = false;
          if ($('pose')) $('pose').textContent = 'Step into view';
          status('Body not visible. Keep shoulders and chest in frame.');
          hideMotionHands(now);
        }
        if (currentView === 'game' && activeGame.gameType === 'boxing-beat' && boxingRound.active) {
          const boxingState = boxingRound.tick(now);
          handleBoxingRoundEvents(boxingState, now);
          renderBoxingRound(boxingState);
        }
      }

      if (isBoxingGame && robotInstance && playerRestPosition) {
        const hitElapsed = now - playerHitAt;
        const hitStrength = hitElapsed >= 0 ? Math.exp(-hitElapsed / 260) : 0;
        const recoil = Math.sin(Math.min(hitElapsed / 1000, 1) * Math.PI * 5) * hitStrength;
        robotInstance.position.set(
          playerRestPosition.x + playerHitSide * recoil * 0.12,
          playerRestPosition.y + Math.abs(recoil) * 0.035,
          playerRestPosition.z,
        );
        robotInstance.rotation.z = playerRestRotationZ + playerHitSide * recoil * 0.10;
      } else if (robotInstance && playerRestPosition) {
        robotInstance.position.copy(playerRestPosition);
        robotInstance.rotation.z = playerRestRotationZ;
      }

      const impactElapsed = now - boxingImpactAt;
      if (isBoxingGame && impactElapsed >= 0 && impactElapsed < 420) {
        const progress = impactElapsed / 420;
        boxingImpact.visible = true;
        boxingImpact.scale.setScalar(0.45 + progress * 1.3);
        boxingImpact.material.opacity = 0.95 * (1 - progress);
      } else {
        boxingImpact.visible = false;
        boxingImpact.material.opacity = 0.95;
      }
    } else if (isWelcomePreviewActive) {
      rig.wave(now * 0.0018, dt);
    } else {
      rig.reset(1 - Math.exp(-7 * dt));
    }
  }

  if (currentView === 'game' && !gameCountdownActive && !roundComplete) {
    const boxingFinished = activeGame.gameType === 'boxing-beat'
      && boxingRound.sequence.length > 0 && now - boxingRound.startedAt >= boxingRound.durationMs;
    const practiceFinished = !activeGame.gameType && practiceDeadline > 0 && now >= practiceDeadline;
    if (boxingFinished || practiceFinished) {
      if (boxingFinished) {
        const result = boxingRound.tick(now);
        renderBoxingRound(result);
        $('round-end-result').textContent = `${result.score} points · Best streak: ${result.bestStreak}`;
      } else {
        $('round-end-result').textContent = 'One minute of mirror practice completed!';
      }
      roundComplete = true;
      $('boxing-action').hidden = true;
      $('round-end-screen').hidden = false;
      soundEffects.playComplete();
      $('btn-round-restart').focus({preventScroll:true});
    }
  }

  const isFlyingGame = currentView === 'game' && activeGame.gameType === 'flying';
  const isStretchingGame = currentView === 'game' && activeGame.gameType === 'stretching';

  if (isFlyingGame) {
    if (mode !== 'camera' || now - lastSeen > 450) currentFlightInput = flightInput(null);
    const starArray = flightStars.geometry.attributes.position.array;
    const worldSpeed = flightRace.phase === 'flying' ? 4.6 : 0.7;
    for (let index = 2; index < starArray.length; index += 3) {
      starArray[index] += worldSpeed * dt;
      if (starArray[index] > 5) starArray[index] = -34;
    }
    flightStars.geometry.attributes.position.needsUpdate = true;
    flightClouds.forEach((cloud, index) => {
      cloud.position.z += worldSpeed * 0.28 * dt;
      cloud.rotation.y += dt * 0.02;
      if (cloud.position.z > 6) cloud.position.z = -34 - index;
    });

    if (robotWingRig && robotWingsModel) {
      robotWingRig.update(currentFlightInput, dt);
      robotWingsModel.position.copy(playerStage.position);
      robotWingsModel.rotation.copy(playerStage.rotation);
      robotWingsModel.scale.copy(playerStage.scale);
    }

    const targetX = currentFlightInput.x * 1.55;
    const movementAlpha = 1 - Math.exp(-5.5 * dt);
    playerStage.position.x += (targetX - playerStage.position.x) * movementAlpha;

    if (flightRace.phase === 'flying') {
      if (currentFlightInput.flap) {
        flightVerticalVelocity = Math.min(1.5, flightVerticalVelocity + 1.05);
        lastFlapVisualAt = now;
        soundEffects.playGameCue(260);
        currentFlightInput.flap = false;
      }
      if (currentFlightInput.gliding) {
        flightVerticalVelocity += (-flightVerticalVelocity - 0.2) * Math.min(1, 2.2 * dt);
      } else {
        flightVerticalVelocity -= (1.2 + currentFlightInput.dive * 1.5) * dt;
      }
      flightAltitude += flightVerticalVelocity * dt;
      if (flightAltitude <= -0.35) {
        flightAltitude = -0.35;
        flightVerticalVelocity = Math.max(0, flightVerticalVelocity);
      } else if (flightAltitude >= 1.65) {
        flightAltitude = 1.65;
        flightVerticalVelocity = Math.min(0, flightVerticalVelocity);
      }

      // Course gate updates
      for (const gate of flightGates) {
        gate.position.z += 5.15 * dt;
        gate.rotation.z += 0.28 * dt;
        gate.userData.flash = Math.max(0, gate.userData.flash - dt * 2.8);
        const pulse = 1 + Math.sin(now * 0.004 + gate.userData.sequence) * 0.035 + gate.userData.flash * 0.16;
        gate.scale.setScalar(pulse);

        if (!gate.userData.evaluated && gate.position.z >= 0) {
          gate.userData.evaluated = true;
          const pilotX = playerStage.position.x;
          const pilotY = playerStage.position.y + 0.88;
          const dist = Math.hypot(pilotX - gate.position.x, pilotY - gate.position.y);
          const hit = dist < 0.65;
          const pts = flightRace.recordRing(hit);
          gate.userData.flash = 1;
          gate.userData.ring.material.color.setHex(hit ? 0x84ffd7 : 0xff6375);
          gate.userData.halo.material.color.setHex(hit ? 0x84ffd7 : 0xff6375);
          if (hit) {
            soundEffects.playRing();
            status(`Ring cleared! +${pts} pts · ${flightRace.combo}x combo`);
          } else {
            status('Ring missed — align with the next ring!');
          }
        }

        if (gate.position.z > 2.4) {
          const tail = Math.min(...flightGates.map((g) => g.position.z));
          placeFlightGate(gate, flightGateSequence, tail - 8.2);
          flightGateSequence += 1;
        }
      }
    } else {
      flightAltitude += (0.6 - flightAltitude) * movementAlpha;
      flightVerticalVelocity = 0;
    }

    playerStage.position.y += (flightAltitude - playerStage.position.y) * movementAlpha;
    playerStage.rotation.z += (-currentFlightInput.x * 0.16 - playerStage.rotation.z) * movementAlpha;

    engineGlow.position.set(playerStage.position.x, playerStage.position.y + 0.15, 0.1);
    engineGlow.visible = flightRace.phase === 'flying';
    const recentFlap = now - lastFlapVisualAt < 260;
    const engineScale = recentFlap ? 1.35 + Math.sin(now * 0.02) * 0.16 : currentFlightInput.gliding ? 0.65 : 0.42;
    engineGlow.scale.set(engineScale, engineScale * 2.7, engineScale);

    const raceResult = flightRace.update(now);
    if (raceResult) {
      soundEffects.playComplete();
      status(`Flight complete! Score: ${raceResult.score} (${raceResult.rings} rings).`);
      showFlightEndScreen(raceResult);
    }

    renderFlightUI();
  }

  if (isStretchingGame) {
    stretchingState.mode = 'camera';
    const points = mode === 'camera' && latest && now - lastSeen < 450 ? latest.landmarks : null;
    stretchingState.latestImage = points;
    updateGameplay(dt, bodyMetrics(points));
    if (robotGoal) playerStage.position.lerp(robotGoal, 1 - Math.exp(-3 * dt));
    if (energyCore) energyCore.position.copy(playerStage.position).add(new THREE.Vector3(0, 1.3, -.25));
    if (itemAuraGroup && itemAuraGroup.visible) {
      gyro1.rotation.y += 1.8 * dt;
      gyro1.rotation.x += 0.8 * dt;
      gyro2.rotation.z += 1.4 * dt;
      gyro2.rotation.y += 1.0 * dt;
      dustPoints.rotation.y += 0.9 * dt;
      const corePulse = 0.35 + Math.sin(now * 0.005) * 0.08;
      itemCoreOrb.scale.setScalar(corePulse * 3);
    }
    if (socketBeacon && socketBeacon.visible) {
      socketRing1.rotation.z += 2.2 * dt;
      socketRing2.rotation.x += 1.6 * dt;
    }
    if (sparksLifetime > 0) {
      sparksLifetime -= dt;
      sparkMat.opacity = Math.max(0, sparksLifetime / 0.5);
      const sPos = sparkGeo.attributes.position.array;
      for (let i = 0; i < sparkCount; i++) {
        sPos[i * 3] += sparkVelocities[i].x * dt;
        sPos[i * 3 + 1] += sparkVelocities[i].y * dt;
        sPos[i * 3 + 2] += sparkVelocities[i].z * dt;
        sparkVelocities[i].y -= 9.8 * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }
    peachClouds.forEach((c) => {
      c.rotation.y += dt * 0.015;
    });
    renderStretchingUI();
  }

  // Render Three.js scene if in game view OR if welcome preview with Blue is active
  if (currentView === 'game' || isWelcomePreviewActive) {
    renderer.render(scene, camera);
  }
}

requestAnimationFrame(animate);

window.addEventListener('pagehide', () => {
  stopCamera();
  tracker.landmarker?.close();
});

// Initialize Posture, Carousel & Views
setPostureMode(postureMode, false);
renderCarousel();
showView('carousel');

// Enable camera by default on website load for hands-free motion control
if (navigator.mediaDevices?.getUserMedia) {
  startCamera().catch((err) => {
    console.warn('Auto-start camera notice:', err);
  });
}
