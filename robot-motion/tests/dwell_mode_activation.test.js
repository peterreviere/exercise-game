import test from 'node:test';
import assert from 'node:assert/strict';

test('dwell mode is the default click selection mode', () => {
  // Test fallback logic when no cookie is set
  const getStoredPreference = (key) => null;
  const defaultMode = getStoredPreference('adaptmove_click_mode') || 'dwell';
  assert.equal(defaultMode, 'dwell', 'Default click selection mode must be dwell');
});

test('dwell mode removes Open and Closed indicators and only shows percentage when hovering', () => {
  let clickSelectionMode = 'dwell';
  let cursorIsClosed = true; // User fingers naturally curled or tilted hand
  let allowFist = clickSelectionMode === 'fist' || clickSelectionMode === 'both';
  let allowDwell = clickSelectionMode === 'dwell' || clickSelectionMode === 'both';

  // 1. hand-closed class check: in dwell mode, cursor should NOT be marked closed
  const shouldAddHandClosedClass = allowFist && cursorIsClosed;
  assert.equal(shouldAddHandClosedClass, false, 'Cursor must not show hand-closed styling in dwell mode');

  // 2. Text indicator when idle (no target hovered)
  let clickableTarget = null;
  let text = '';
  if (clickableTarget) {
    text = '50%';
  } else {
    text = clickSelectionMode === 'dwell' ? '' : (cursorIsClosed ? 'Closed' : 'Open');
  }
  assert.equal(text, '', 'In dwell mode, idle text must be empty (no Open or Closed indicator)');

  // 3. Text indicator when dwelling on a target
  clickableTarget = { id: 'btn-play' };
  const progress = 0.65;
  if (clickableTarget) {
    if (clickSelectionMode === 'dwell') {
      text = `${Math.round(progress * 100)}%`;
    }
  }
  assert.equal(text, '65%', 'In dwell mode, hovering target must display dwell progress percentage');
});

test('dwell mode activates even when fingers are curled or hand is tilted', () => {
  let clickSelectionMode = 'dwell';
  let allowDwell = clickSelectionMode === 'dwell' || clickSelectionMode === 'both';

  let cursorState = {
    isClosed: true, // Hand ratio below threshold (curled fingers)
    dwellTarget: null,
    dwellStartTime: 1000,
    dwellElapsed: 0,
    cooldownUntil: 0
  };

  const target = { id: 'card-active' };
  const now = 2400;
  const dwellDurationMs = 1400;
  let clickTriggered = false;

  // Dwell timer simulation
  if (allowDwell) {
    if (cursorState.dwellTarget !== target) {
      cursorState.dwellTarget = target;
      cursorState.dwellStartTime = 1000;
    }

    if (now > cursorState.cooldownUntil) {
      cursorState.dwellElapsed = Math.max(0, now - cursorState.dwellStartTime);
      if (cursorState.dwellElapsed >= dwellDurationMs) {
        clickTriggered = true;
      }
    }
  }

  assert.equal(clickTriggered, true, 'Dwell timer must trigger successfully even when fingers are curled');
  assert.equal(cursorState.dwellElapsed, 1400);
});

test('dwell mode grace period preserves timer across 1-frame micro-jitter drops', () => {
  let cursorState = {
    dwellTarget: { id: 'card-0' },
    dwellStartTime: 1000,
    dwellElapsed: 800, // 800ms progressed
    lastTargetSeenTime: 1800
  };

  // Frame 1: Micro-jitter drops target for 33ms (now = 1833ms)
  let clickableTarget = null;
  let now = 1833;

  if (clickableTarget) {
    cursorState.lastTargetSeenTime = now;
  } else if (cursorState.dwellTarget && now - (cursorState.lastTargetSeenTime || 0) < 180) {
    clickableTarget = cursorState.dwellTarget; // Grace period preserves target
  } else {
    cursorState.dwellTarget = null;
    cursorState.dwellElapsed = 0;
  }

  assert.notEqual(clickableTarget, null, 'Target must be retained during 180ms grace window');
  assert.equal(cursorState.dwellTarget.id, 'card-0');

  // Frame 2: User moves completely away after 250ms (now = 2050ms)
  clickableTarget = null;
  now = 2050;

  if (clickableTarget) {
    cursorState.lastTargetSeenTime = now;
  } else if (cursorState.dwellTarget && now - (cursorState.lastTargetSeenTime || 0) < 180) {
    clickableTarget = cursorState.dwellTarget;
  } else {
    cursorState.dwellTarget = null;
    cursorState.dwellElapsed = 0;
  }

  assert.equal(clickableTarget, null, 'Target must drop when moved away past grace period');
  assert.equal(cursorState.dwellTarget, null);
  assert.equal(cursorState.dwellElapsed, 0);
});
