import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DetailedPoseTracker, DETAILED_POSE_CONNECTIONS } from './vendor/DetailedPoseTracker.js';
import { MotionPipeline, ACTIONS, ACCESSIBILITY_PROFILES } from './vendor/MotionPipeline.js';
import { PoseClassifier } from './vendor/PoseClassifier.js';
import { RobotRetargeter } from './retarget.js';
import { GAMES_CONFIG } from './gamesConfig.js';
import { soundEffects } from './audioFeedback.js';

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
let currentView = 'carousel'; // 'carousel' | 'details' | 'game'
let postureMode = 'standing'; // Standing mode only
let gripThreshold = Number(getStoredPreference('adaptmove_grip') || 0.32);
let clickSelectionMode = 'dwell'; // Always dwell mode
let dwellDurationMs = Number(getStoredPreference('adaptmove_dwell_time') || 1400); // 1000, 1400, 1800, 2300
const storedHand = getStoredPreference('adaptmove_active_hand');
let activeSelectingHand = (storedHand === 'left' || storedHand === 'right' || storedHand === 'both') ? storedHand : 'both'; // 'both' | 'right' | 'left'

let swipeCooldownUntil = 0;
let activeGame = GAMES_CONFIG[0];

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
    const robot = gltf.scene;
    robotInstance = robot;
    robot.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    applyRobotTheme(currentThemeColor);
    scene.add(robot);
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

// ============================================================================
// Camera Controls (Available from Header or Aside)
// ============================================================================
function stopCamera() {
  epoch++;
  starting = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  tracker.lastVideoTime = -1;
  mode = 'idle';
  wasTracking = false;
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
  $('pose').textContent = 'Ready when you are';
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
    lastSeen = performance.now();
    status(`Camera ready · ${tracker.delegate} tracking · Mirror mode`);

    // Update header camera toggle
    const camToggleBtn = $('btn-camera-toggle');
    if (camToggleBtn) camToggleBtn.setAttribute('aria-pressed', 'true');
    const camBtnText = $('camera-btn-text');
    if (camBtnText) camBtnText.textContent = 'Stop Camera';

    // Update welcome camera status
    if (welcomeCamMsg) welcomeCamMsg.textContent = 'Camera active! Wave to me and I will wave back!';
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
  $('demo').textContent = 'End demo';
  $('stop').disabled = false;
  $('pose').textContent = 'Demo · no camera';
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

  // Update Legs option in Game View
  const legsInput = $('legs');
  const legsHelper = $('legs-helper');
  if (legsInput) {
    legsInput.disabled = false;
  }
  if (legsHelper) {
    legsHelper.textContent = 'Full body must be visible';
  }
  const ergoTip = $('ergonomic-tip');
  if (ergoTip) {
    ergoTip.textContent = 'In standing mode, stand with full body in frame for whole-body tracking.';
  }

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

function returnToCarousel() {
  soundEffects.playBack();
  showView('carousel');
  updateCardPositions();
  $('carousel-announcement').textContent = 'Returned to games carousel.';
}

function launchActiveGame() {
  soundEffects.playSelect();
  $('active-game-title').textContent = activeGame.title;
  showView('game');
  status(`Entered ${activeGame.title}. Move to begin exercise.`);
}

$('btn-details-back').onclick = returnToCarousel;
$('btn-start-game').onclick = launchActiveGame;
$('btn-back-to-carousel').onclick = returnToCarousel;

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
  const activeModal = document.querySelector('dialog[open]');
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

  // 2. Draw landmarks on game aside overlay
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2.5;
  for (const [a, b] of DETAILED_POSE_CONNECTIONS) {
    if ((points[a].visibility ?? 0) < 0.5 || (points[b].visibility ?? 0) < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(points[a].x * overlay.width, points[a].y * overlay.height);
    ctx.lineTo(points[b].x * overlay.width, points[b].y * overlay.height);
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

  if (rig) {
    if (mode === 'demo') {
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
            $('pose').textContent = poseName;
            if (!wasTracking) {
              status('Tracking live · mirror mode');
            }
            wasTracking = true;

            const lm = frame.landmarks;

            // Hand cursors are only active and visible outside of active gameplay (Carousel & Details views)
            if (currentView === 'game') {
              cursorLeftEl.classList.add('hidden');
              cursorRightEl.classList.add('hidden');
              cursorL.visible = false;
              cursorR.visible = false;
            } else {
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

              // Left Hand Cursor
              if (allowLeftCursor && lw && (lw.visibility ?? 0) >= 0.4) {
                const targetPos = mapWristToScreen(1 - lw.x, lw.y);
                const leftHandGrip = detectHandClosed(lm, false);
                updateHandCursor(cursorL, cursorLeftEl, stateTextLeft, handDwellLeftEl, targetPos, true, leftHandGrip.ratio, now);
              } else {
                updateHandCursor(cursorL, cursorLeftEl, stateTextLeft, handDwellLeftEl, { x: 0, y: 0 }, false, 1.0, now);
              }
            }

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
        const followLegs = postureMode === 'standing' && $('legs').checked;
        rig.apply(latest.worldLandmarks, dt, followLegs);
      } else if (isWelcomePreviewActive) {
        // Friendly greeting wave from Blue while in the welcome setup dialog
        rig.wave(now * 0.0018, dt);
      } else {
        rig.reset(1 - Math.exp(-5 * dt));
        if (now - lastSeen > 700 && mode === 'camera') {
          latest = null;
          wasTracking = false;
          $('pose').textContent = 'Step into view';
          status('Body not visible. Keep shoulders and chest in frame.');
          cursorLeftEl.classList.add('hidden');
          cursorRightEl.classList.add('hidden');
        }
      }
    } else if (isWelcomePreviewActive) {
      rig.wave(now * 0.0018, dt);
    } else {
      rig.reset(1 - Math.exp(-7 * dt));
    }
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
