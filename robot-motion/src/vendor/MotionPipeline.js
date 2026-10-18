/**
 * MotionPipeline — Unified camera, pose normalization, gesture recognition,
 * and accessibility mapping layer.
 *
 * Architecture:
 * Webcam -> MediaPipe Landmarks -> Normalization -> Gesture Engine -> Accessibility Mapper -> Standard Actions
 */

export const ACTIONS = Object.freeze({
  MOVE_LEFT:      'MOVE_LEFT',
  MOVE_RIGHT:     'MOVE_RIGHT',
  REACH_LEFT:     'REACH_LEFT',
  REACH_RIGHT:    'REACH_RIGHT',
  REACH_UP:       'REACH_UP',
  BOTH_ARMS_UP:   'BOTH_ARMS_UP',
  ARM_EXTEND:     'ARM_EXTEND',      // T-pose or wide reach
  KNEE_RAISE:     'KNEE_RAISE',
  STEP:           'STEP',
  LEAN_LEFT:      'LEAN_LEFT',
  LEAN_RIGHT:     'LEAN_RIGHT',
  CHEST_OPENER:   'CHEST_OPENER',
  HANDS_TOGETHER: 'HANDS_TOGETHER',
  HOLD_POSE:      'HOLD_POSE',
  SELECT:         'SELECT',
  BACK:           'BACK',
  PAUSE:          'PAUSE',
});

export const ACCESSIBILITY_PROFILES = Object.freeze({
  STANDARD:       'standard',        // Default full-body standing
  SEATED:         'seated',          // Chair-friendly, arm/torso alternatives for legs
  WHEELCHAIR:     'wheelchair',      // Moderate horizontal reaches, no deep bends, arm walking
  ONE_HANDED:     'one_handed',      // Single arm alternate activations
  LIMITED_UPPER:  'limited_upper',   // Reduced threshold reaches (mid-chest to head height)
  NO_LEGS:        'no_legs',         // All leg actions remapped to torso or arm motions
});

const IDX = Object.freeze({
  nose: 0,
  leftEye: 2, rightEye: 5,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
});

function vis(...pts) {
  return pts.length > 0 && pts.every((p) => p && (p.visibility ?? 1) >= 0.32);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class MotionPipeline {
  constructor(options = {}) {
    this.profile = options.profile || ACCESSIBILITY_PROFILES.STANDARD;
    this.subscribers = new Set();
    this.actionStates = new Map();
    this.lastLandmarks = null;
    this.normalizedData = null;

    // Gesture dwell / cooldown trackers
    this._selectDwellMs = 0;
    this._backDwellMs = 0;
    this._swipeCooldownMs = 0;
    this._stepCooldownMs = 0;

    // Last raw wrist coordinates for velocity calculation
    this._lastWrists = null;
    this._lastTimestamp = 0;
  }

  setProfile(profile) {
    if (Object.values(ACCESSIBILITY_PROFILES).includes(profile)) {
      this.profile = profile;
    }
  }

  /**
   * Subscribe to standardized action events.
   * @param {Function} callback (actionName, eventData) => void
   * @returns {Function} unsubscribe function
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  _emit(actionName, eventData) {
    this.subscribers.forEach((cb) => {
      try {
        cb(actionName, eventData);
      } catch (err) {
        console.error(`Error in action subscriber for ${actionName}:`, err);
      }
    });
  }

  /**
   * Process a frame of raw landmarks from MediaPipe and dispatch actions.
   * @param {Array} landmarks - 33 MediaPipe landmarks (or null if lost)
   * @param {number} timestamp - DOMHighResTimeStamp
   */
  process(landmarks, timestamp) {
    const dt = this._lastTimestamp ? Math.min(100, timestamp - this._lastTimestamp) : 16;
    this._lastTimestamp = timestamp;

    if (!landmarks || landmarks.length < 29) {
      this.lastLandmarks = null;
      this.normalizedData = null;
      this._handleTrackingLoss(timestamp);
      return null;
    }

    const ls = landmarks[IDX.leftShoulder];
    const rs = landmarks[IDX.rightShoulder];
    if (!vis(ls, rs)) {
      this.lastLandmarks = null;
      this.normalizedData = null;
      this._handleTrackingLoss(timestamp);
      return null;
    }

    this.lastLandmarks = landmarks;
    const normalized = this._normalize(landmarks);
    this.normalizedData = normalized;

    // Raw gestures computed from geometry
    const rawGestures = this._recognizeGestures(normalized, dt);

    // Map through accessibility profile to standardized actions
    const mappedActions = this._mapAccessibility(rawGestures, normalized);

    // Dispatch action state transitions (start, hold, end)
    this._dispatchActions(mappedActions, timestamp, dt);

    return normalized;
  }

  _normalize(lm) {
    const ls = lm[IDX.leftShoulder];
    const rs = lm[IDX.rightShoulder];
    const le = lm[IDX.leftElbow];
    const re = lm[IDX.rightElbow];
    const lw = lm[IDX.leftWrist];
    const rw = lm[IDX.rightWrist];
    const lh = lm[IDX.leftHip];
    const rh = lm[IDX.rightHip];
    const lk = lm[IDX.leftKnee];
    const rk = lm[IDX.rightKnee];
    const la = lm[IDX.leftAnkle];
    const ra = lm[IDX.rightAnkle];
    const nose = lm[IDX.nose];

    const shoulderMid = mid(ls, rs);
    const sw = Math.max(0.05, dist(ls, rs)); // shoulder width as base unit
    const hipVisible = vis(lh, rh);
    const hipMid = hipVisible ? mid(lh, rh) : { x: shoulderMid.x, y: shoulderMid.y + sw * 1.5 };
    const torsoH = Math.max(sw * 0.8, dist(shoulderMid, hipMid));

    // Mirror X coordinates for intuitive selfie-space:
    // User's physical right arm is rs/rw (left side in raw video, right in mirror space)
    // Here we define:
    // rightWristX: positive = reaching to player's right
    // leftWristX: positive = reaching to player's left
    const playerRightWristX = (shoulderMid.x - (vis(rw) ? rw.x : shoulderMid.x)) / sw;
    const playerLeftWristX  = ((vis(lw) ? lw.x : shoulderMid.x) - shoulderMid.x) / sw;

    const rightWristY = (shoulderMid.y - (vis(rw) ? rw.y : shoulderMid.y)) / torsoH; // positive = above shoulder
    const leftWristY  = (shoulderMid.y - (vis(lw) ? lw.y : shoulderMid.y)) / torsoH;

    // Torso lean: displacement of shoulders relative to hips
    // Positive = lean right, Negative = lean left
    const lean = (hipMid.x - shoulderMid.x) / sw;

    return {
      shoulderMid,
      hipMid,
      sw,
      torsoH,
      lean,
      playerRightWristX,
      playerLeftWristX,
      rightWristY,
      leftWristY,
      leftKneeUp:  vis(lh, lk) && lk.y < lh.y - torsoH * 0.1,
      rightKneeUp: vis(rh, rk) && rk.y < rh.y - torsoH * 0.1,
      raw: lm,
    };
  }

  _recognizeGestures(norm, dt) {
    const isSeated = this.profile === ACCESSIBILITY_PROFILES.SEATED || this.profile === ACCESSIBILITY_PROFILES.WHEELCHAIR;
    const isLimited = this.profile === ACCESSIBILITY_PROFILES.LIMITED_UPPER || isSeated;
    const upThreshold = isLimited ? 0.10 : 0.22;
    const reachOutThreshold = isLimited ? 0.46 : 0.65;
    const leanThreshold = isSeated ? 0.20 : 0.28;

    const rightUp = norm.rightWristY > upThreshold;
    const leftUp  = norm.leftWristY > upThreshold;
    const bothUp  = rightUp && leftUp;

    const reachRight = norm.playerRightWristX > reachOutThreshold;
    const reachLeft  = norm.playerLeftWristX > reachOutThreshold;
    const tPose = reachRight && reachLeft && Math.abs(norm.rightWristY) < 0.35 && Math.abs(norm.leftWristY) < 0.35;

    const leanRight = norm.lean > leanThreshold;
    const leanLeft  = norm.lean < -leanThreshold;

    // Chest opener / goalpost
    const rw = norm.raw[IDX.rightWrist];
    const lw = norm.raw[IDX.leftWrist];
    const chestOpener = reachRight && reachLeft && rightUp && leftUp;

    // Hands together near chest (for Menu Back / Shield)
    const handsTogether = vis(rw, lw) && dist(rw, lw) < norm.sw * 0.45 && norm.rightWristY < 0.1;

    // Step detection (alternating knees)
    const kneeUp = norm.leftKneeUp || norm.rightKneeUp;

    return {
      rightUp,
      leftUp,
      bothUp,
      reachRight,
      reachLeft,
      tPose,
      leanRight,
      leanLeft,
      chestOpener,
      handsTogether,
      leftKneeUp: norm.leftKneeUp,
      rightKneeUp: norm.rightKneeUp,
      kneeUp,
    };
  }

  _mapAccessibility(g, norm) {
    const p = this.profile;
    const active = new Set();

    // Navigation gestures (Universal)
    if (g.rightUp && !g.leftUp) {
      active.add(ACTIONS.SELECT);
    }
    if (g.handsTogether) {
      active.add(ACTIONS.BACK);
    }

    // Upper Body
    if (g.bothUp)   active.add(ACTIONS.BOTH_ARMS_UP);
    if (g.rightUp)  active.add(ACTIONS.REACH_UP);
    if (g.leftUp)   active.add(ACTIONS.REACH_UP);
    if (g.reachRight) active.add(ACTIONS.REACH_RIGHT);
    if (g.reachLeft)  active.add(ACTIONS.REACH_LEFT);
    if (g.tPose)      active.add(ACTIONS.ARM_EXTEND);
    if (g.chestOpener) active.add(ACTIONS.CHEST_OPENER);
    if (g.handsTogether) active.add(ACTIONS.HANDS_TOGETHER);

    // Torso Dodging / Moving
    if (g.leanLeft)  active.add(ACTIONS.MOVE_LEFT);
    if (g.leanRight) active.add(ACTIONS.MOVE_RIGHT);
    if (g.leanLeft)  active.add(ACTIONS.LEAN_LEFT);
    if (g.leanRight) active.add(ACTIONS.LEAN_RIGHT);

    // Lower Body / Movement Mapping
    if (p === ACCESSIBILITY_PROFILES.STANDARD) {
      if (g.kneeUp) {
        active.add(ACTIONS.STEP);
        active.add(ACTIONS.KNEE_RAISE);
      }
    } else if (p === ACCESSIBILITY_PROFILES.SEATED || p === ACCESSIBILITY_PROFILES.WHEELCHAIR || p === ACCESSIBILITY_PROFILES.NO_LEGS) {
      // Re-map leg marching to alternating arm pumps or lean
      if (g.rightUp || g.leftUp || Math.abs(norm.lean) > 0.15) {
        active.add(ACTIONS.STEP);
        active.add(ACTIONS.KNEE_RAISE);
      }
    } else if (p === ACCESSIBILITY_PROFILES.ONE_HANDED) {
      // One-handed profile: single active arm reach activates both left & right depending on position
      if (norm.playerRightWristX > 0.45) active.add(ACTIONS.REACH_RIGHT);
      if (norm.playerRightWristX < -0.2) active.add(ACTIONS.REACH_LEFT);
      if (norm.rightWristY > 0.15)       active.add(ACTIONS.BOTH_ARMS_UP);
    }

    return active;
  }

  _dispatchActions(activeActions, timestamp, dt) {
    // Check all tracked actions
    Object.values(ACTIONS).forEach((action) => {
      const isNowActive = activeActions.has(action);
      const prev = this.actionStates.get(action) || { active: false, startTs: 0, duration: 0 };

      if (isNowActive && !prev.active) {
        // ACTION START
        const state = { active: true, startTs: timestamp, duration: 0 };
        this.actionStates.set(action, state);
        this._emit(action, { state: 'start', duration: 0, timestamp });
      } else if (isNowActive && prev.active) {
        // ACTION HOLD
        prev.duration = timestamp - prev.startTs;
        this.actionStates.set(action, prev);
        this._emit(action, { state: 'hold', duration: prev.duration, timestamp });
      } else if (!isNowActive && prev.active) {
        // ACTION END
        this._emit(action, { state: 'end', duration: prev.duration, timestamp });
        this.actionStates.set(action, { active: false, startTs: 0, duration: 0 });
      }
    });
  }

  _handleTrackingLoss(timestamp) {
    this.actionStates.forEach((state, action) => {
      if (state.active) {
        this._emit(action, { state: 'end', duration: state.duration, timestamp, trackingLost: true });
        state.active = false;
      }
    });
  }
}
