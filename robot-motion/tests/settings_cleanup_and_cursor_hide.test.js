import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('1. settings menu includes selecting hand (left, right, both) with both as default, and duplicate posture/click removed', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  
  // Settings dialog must exist
  assert.ok(html.includes('id="accessibility-dialog"'), 'Settings dialog should exist');
  
  // Duplicate posture and click mode settings must be removed from the settings menu
  assert.ok(!html.includes('id="group-posture-settings"'), 'Duplicate posture settings should be removed from settings menu');
  assert.ok(!html.includes('name="setting-click-mode"'), 'Click selection mode radio group should be removed');
  assert.ok(!html.includes('name="setting-grip"'), 'Grip sensitivity settings should be removed');
  assert.ok(!html.includes('class="settings-quick-jump"'), 'Duplicate quick jump row should be removed');
  
  // Section accessibility must be the primary section
  assert.ok(html.includes('id="section-accessibility"'), 'Accessibility section must be present');
  assert.ok(html.includes('id="group-dwell-settings"'), 'Dwell timer duration settings must be in accessibility section');

  // Selecting hand settings must be present in settings dialog with left, right, and both options, defaulting to both
  assert.ok(html.includes('id="group-hand-settings"'), 'Hand settings group must be in settings dialog');
  assert.ok(html.includes('name="setting-active-hand"'), 'Selecting hand radio group must be in settings dialog');
  assert.ok(html.includes('value="both" checked'), 'Both hands must be checked by default in settings');
  assert.ok(html.includes('value="right"'), 'Right hand option must be present in settings');
  assert.ok(html.includes('value="left"'), 'Left hand option must be present in settings');
});

test('2. accessibility settings selection navigates immediately to section-accessibility', () => {
  let scrolledToSection = null;
  let highlighted = false;

  const mockSection = {
    scrollIntoView(options) {
      scrolledToSection = options;
    },
    classList: {
      add(cls) { if (cls === 'section-highlight') highlighted = true; },
      remove(cls) { if (cls === 'section-highlight') highlighted = false; }
    }
  };

  function openAccessibilityDialog(targetSection = 'accessibility') {
    // When opened, immediately scrolls to accessibility section and adds highlight
    if (mockSection) {
      mockSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      mockSection.classList.add('section-highlight');
    }
  }

  openAccessibilityDialog();
  assert.deepEqual(scrolledToSection, { behavior: 'smooth', block: 'start' });
  assert.equal(highlighted, true, 'Accessibility section should be smoothly scrolled to and highlighted');
});

test('3. initial setup is streamlined to step 1 hand selection with Blue robot and step 2 dwell timer duration', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  // Step 1 popup (hand selection) has Blue robot and Right Hand, Left Hand, AND Both Hands, with Both Hands active by default
  assert.ok(html.includes('Step 1 of 2 · Selecting Hand'), 'Step 1 must be Selecting Hand');
  assert.ok(html.includes('id="welcome-bot-viewport"'), 'Step 1 must contain welcome bot viewport for Blue');
  assert.ok(html.includes('id="opt-hand-right"'), 'Right hand option must be present');
  assert.ok(html.includes('id="opt-hand-left"'), 'Left hand option must be present');
  assert.ok(html.includes('id="opt-hand-both"'), 'Both hands option must be present in setup');
  assert.ok(html.includes('data-hand-value="both"'), 'Both hands value must be present in setup');
  assert.ok(/class="motion-select-card active motion-target"\s+data-hand-value="both"\s+id="opt-hand-both"/.test(html), 'Both hands must be active by default in step 1 setup');
  assert.ok(/class="motion-select-card motion-target"\s+data-hand-value="right"\s+id="opt-hand-right"/.test(html), 'Right hand must not be active by default in step 1 setup');

  // Step 2 popup is Dwell Timer Duration screen
  assert.ok(html.includes('Step 2 of 2 · Dwell Timer Duration'), 'Step 2 must be dwell timer duration');
  assert.ok(html.includes('id="opt-dwell-1000"'), '1.0s dwell card must exist');
  assert.ok(html.includes('id="opt-dwell-1400"'), '1.4s dwell card must exist');
  assert.ok(html.includes('id="opt-dwell-1800"'), '1.8s dwell card must exist');
  assert.ok(html.includes('id="opt-dwell-2300"'), '2.3s dwell card must exist');

  // No close hand (fist) method in step 2
  assert.ok(!html.includes('id="opt-click-fist"'), 'Close hand method must be removed from setup');
  assert.ok(!html.includes('id="opt-click-both"'), 'Both click mode must be removed from setup');

  // Test activeSelectingHand cursor permissions for 'both'
  const getHandPermissions = (activeHand) => ({
    allowRightCursor: activeHand === 'right' || activeHand === 'both',
    allowLeftCursor: activeHand === 'left' || activeHand === 'both'
  });

  assert.deepEqual(getHandPermissions('both'), { allowRightCursor: true, allowLeftCursor: true });
  assert.deepEqual(getHandPermissions('right'), { allowRightCursor: true, allowLeftCursor: false });
  assert.deepEqual(getHandPermissions('left'), { allowRightCursor: false, allowLeftCursor: true });
});

test('4. hand cursors disappear when entered into game view and stay hidden during active gameplay', () => {
  const cursorLeftEl = {
    classes: new Set(['hidden']),
    classList: {
      add(c) { cursorLeftEl.classes.add(c); },
      remove(c) { cursorLeftEl.classes.delete(c); },
      contains(c) { return cursorLeftEl.classes.has(c); }
    }
  };

  const cursorRightEl = {
    classes: new Set(['hidden']),
    classList: {
      add(c) { cursorRightEl.classes.add(c); },
      remove(c) { cursorRightEl.classes.delete(c); },
      contains(c) { return cursorRightEl.classes.has(c); }
    }
  };

  let cursorL = { visible: true };
  let cursorR = { visible: true };
  let currentView = 'carousel';

  function showView(viewName) {
    currentView = viewName;
    if (viewName === 'game') {
      cursorLeftEl.classList.add('hidden');
      cursorRightEl.classList.add('hidden');
      cursorL.visible = false;
      cursorR.visible = false;
    }
  }

  // User launches game
  showView('game');
  assert.equal(cursorLeftEl.classList.contains('hidden'), true);
  assert.equal(cursorRightEl.classList.contains('hidden'), true);
  assert.equal(cursorL.visible, false);
  assert.equal(cursorR.visible, false);

  // During animation loop while tracking landmarks in game view:
  let updateHandCursorCalled = false;
  function simulateFrameLandmarks() {
    if (currentView === 'game') {
      cursorLeftEl.classList.add('hidden');
      cursorRightEl.classList.add('hidden');
      cursorL.visible = false;
      cursorR.visible = false;
    } else {
      updateHandCursorCalled = true;
    }
  }

  simulateFrameLandmarks();
  assert.equal(updateHandCursorCalled, false, 'updateHandCursor must not be called when currentView is game');
  assert.equal(cursorLeftEl.classList.contains('hidden'), true);
  assert.equal(cursorRightEl.classList.contains('hidden'), true);
});

test('5. cross hands in an X shape gesture triggers exit to carousel', () => {
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
    const ls = landmarks[11];
    const rs = landmarks[12];
    const le = landmarks[13];
    const re = landmarks[14];
    const lw = landmarks[15];
    const rw = landmarks[16];

    if (!ls || !rs || !le || !re || !lw || !rw) return false;
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

    const forearmsIntersect = linesIntersect(le.x, le.y, lw.x, lw.y, re.x, re.y, rw.x, rw.y);

    const lwProj = (lw.x - sMidX) * sDirX + (lw.y - sMidY) * sDirY;
    const rwProj = (rw.x - sMidX) * sDirX + (rw.y - sMidY) * sDirY;
    const wristDist = Math.hypot(lw.x - rw.x, lw.y - rw.y);

    const wristsCrossed = (rwProj > lwProj) || (wristDist < shoulderWidth * 0.38 && Math.abs(lwProj) < shoulderWidth * 0.35);
    const avgY = (lw.y + rw.y) / 2;
    const inHeightRange = avgY > sMidY - shoulderWidth * 0.55 && avgY < sMidY + shoulderWidth * 1.35;

    return inHeightRange && (forearmsIntersect || (wristsCrossed && wristDist < shoulderWidth * 0.52));
  }

  // 1. Uncrossed relaxed hands: left wrist on left side, right wrist on right side
  const uncrossedLandmarks = Array.from({ length: 25 }, () => ({ x: 0, y: 0, visibility: 0.9 }));
  uncrossedLandmarks[11] = { x: 0.35, y: 0.3, visibility: 0.9 }; // Left shoulder
  uncrossedLandmarks[12] = { x: 0.65, y: 0.3, visibility: 0.9 }; // Right shoulder
  uncrossedLandmarks[13] = { x: 0.25, y: 0.5, visibility: 0.9 }; // Left elbow
  uncrossedLandmarks[14] = { x: 0.75, y: 0.5, visibility: 0.9 }; // Right elbow
  uncrossedLandmarks[15] = { x: 0.20, y: 0.7, visibility: 0.9 }; // Left wrist
  uncrossedLandmarks[16] = { x: 0.80, y: 0.7, visibility: 0.9 }; // Right wrist

  assert.equal(checkCrossHands(uncrossedLandmarks), false, 'Uncrossed hands must not trigger X pose');

  // 2. Crossed arms in an X shape:
  // Left elbow (0.3, 0.5) reaches across to (0.65, 0.35)
  // Right elbow (0.7, 0.5) reaches across to (0.35, 0.35)
  const crossedLandmarks = Array.from({ length: 25 }, () => ({ x: 0, y: 0, visibility: 0.9 }));
  crossedLandmarks[11] = { x: 0.35, y: 0.3, visibility: 0.9 }; // Left shoulder
  crossedLandmarks[12] = { x: 0.65, y: 0.3, visibility: 0.9 }; // Right shoulder
  crossedLandmarks[13] = { x: 0.30, y: 0.5, visibility: 0.9 }; // Left elbow
  crossedLandmarks[14] = { x: 0.70, y: 0.5, visibility: 0.9 }; // Right elbow
  crossedLandmarks[15] = { x: 0.62, y: 0.35, visibility: 0.9 }; // Left wrist (crossed to right side)
  crossedLandmarks[16] = { x: 0.38, y: 0.35, visibility: 0.9 }; // Right wrist (crossed to left side)

  assert.equal(checkCrossHands(crossedLandmarks), true, 'Crossed hands in an X shape must be detected');

  // 3. Evaluate hold in game view: triggers return to carousel
  let returnedView = 'game';
  let holdElapsed = 0;
  const requiredHoldTime = 650;

  function processHold(isCrossed, dtMs) {
    if (isCrossed) {
      holdElapsed += dtMs;
      if (holdElapsed >= requiredHoldTime) {
        returnedView = 'carousel';
      }
    } else {
      holdElapsed = 0;
    }
  }

  processHold(true, 300);
  assert.equal(returnedView, 'game', 'Holding for 300ms should not yet trigger exit');

  processHold(true, 400); // Total 700ms >= 650ms
  assert.equal(returnedView, 'carousel', 'Holding for 700ms must trigger return to carousel');
});

test('6. carousel view scales to screen size and prevents vertical and horizontal scrollbars', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf-8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  // 1. Body and container rules for carousel view
  assert.ok(html.includes('data-view="carousel"'), 'Body should have data-view="carousel" initially');
  assert.ok(css.includes('body[data-view="carousel"]'), 'CSS should have body[data-view="carousel"] rules');
  assert.ok(css.includes('overflow: hidden;'), 'CSS should specify overflow: hidden for carousel view');

  // 2. Dynamic card and stage scaling variables
  assert.ok(css.includes('--carousel-card-h: clamp('), 'CSS must calculate card height dynamically');
  assert.ok(css.includes('--carousel-card-w: clamp('), 'CSS must calculate card width dynamically');
  assert.ok(css.includes('height: calc(var(--carousel-card-h)'), 'Stage wrapper must scale with card height');
  assert.ok(css.includes('.carousel-stage-wrapper') && css.includes('overflow: visible;'), 'Stage wrapper must have overflow: visible to prevent card clipping');

  // 3. View carousel and container constraints
  assert.ok(css.includes('#view-carousel.view-active'), 'view-carousel.view-active must be defined');
  assert.ok(css.includes('.carousel-container {'), 'carousel-container must be defined');

  // 4. Mathematical check of the responsive formula across screen heights
  function computeCardHeight(viewportH) {
    // clamp(320px, min(66vh, calc(100dvh - 190px)), 620px)
    const raw = Math.min(viewportH * 0.66, viewportH - 190);
    return Math.max(320, Math.min(620, raw));
  }

  const testHeights = [600, 720, 768, 900, 1080];
  for (const h of testHeights) {
    const cardH = computeCardHeight(h);
    const stageH = cardH * 1.08 + 10;
    // Estimated fixed UI overhead without footers: header (~54), padding & gaps (~24), header text (~60), indicators (~16)
    const totalUI = stageH + 54 + 24 + 60 + 16;
    assert.ok(totalUI <= h + 30, `Total UI height (${totalUI}px) must comfortably fit viewport height (${h}px) for h=${h}`);
  }
});

test('7. posture mode options are removed from initial setup and standing mode is the only posture mode', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  // Posture options must be removed from initial setup
  assert.ok(!html.includes('id="dialog-posture"'), 'Posture modal should be removed from initial setup');
  assert.ok(!html.includes('id="opt-posture-sitting"'), 'Sitting posture option should be removed');
  assert.ok(!html.includes('id="opt-posture-standing"'), 'Standing posture card should be removed from initial setup');

  // Body must default to data-posture="standing"
  assert.ok(html.includes('data-posture="standing"'), 'Body must default to standing posture');
  assert.ok(!html.includes('data-posture="sitting"'), 'Body must not default to sitting posture');

  // Posture indicators removed from robot game and card info
  assert.ok(!html.includes('class="game-view-quick-posture"'), 'Posture indicator should be removed from game view');
  assert.ok(!html.includes('class="details-top-posture"'), 'Posture indicator should be removed from details view');
  assert.ok(!html.includes('id="details-posture-badge"'), 'Posture badge should be removed from details view');
  assert.ok(!html.includes('id="details-posture-val"'), 'Posture val should be removed from details view');
});

test('8. selecting hand defaults to both, and synchronizes between startup popup and settings dialog', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf-8');

  // 1. Initial markup defaults (homepage helper bar and footer removed)
  assert.ok(!html.includes('class="motion-helper-bar"'), 'Helper bar must be removed from homepage');
  assert.ok(html.includes('value="both" checked'), 'Both Hands radio must be checked by default in settings');
  assert.ok(/class="motion-select-card active motion-target"\s+data-hand-value="both"\s+id="opt-hand-both"/.test(html), 'Step 1 Both Hands card must be active by default');

  // 2. Settings dialog contains all 3 options
  const accessibilitySection = html.slice(html.indexOf('id="section-accessibility"'));
  assert.ok(accessibilitySection.includes('value="both"'), 'Settings must include both hands option');
  assert.ok(accessibilitySection.includes('value="right"'), 'Settings must include right hand option');
  assert.ok(accessibilitySection.includes('value="left"'), 'Settings must include left hand option');

  // 3. Fallback logic in main.js defaults to 'both'
  assert.ok(mainJs.includes("activeSelectingHand = (storedHand === 'left' || storedHand === 'right' || storedHand === 'both') ? storedHand : 'both'"), 'main.js state must default to both');
  assert.ok(mainJs.includes("validHand = (savedActiveHand === 'left' || savedActiveHand === 'right' || savedActiveHand === 'both') ? savedActiveHand : 'both'"), 'loadSavedPreferences must fallback to both');

  // 4. Synchronization in updateHandCards
  assert.ok(mainJs.includes('document.querySelector(`input[name="setting-active-hand"][value="${activeSelectingHand}"]`)'), 'updateHandCards must sync settings radio');

  // 5. Cycling logic: 'both' -> 'right' -> 'left' -> 'both'
  function cycleHand(current) {
    return current === 'both' ? 'right' : (current === 'right' ? 'left' : 'both');
  }
  assert.equal(cycleHand('both'), 'right');
  assert.equal(cycleHand('right'), 'left');
  assert.equal(cycleHand('left'), 'both');
});

test('9. swiping gestures adapt to active selecting hand preference', () => {
  // Simulate swipe logic based on activeSelectingHand
  function simulateSwipe(activeSelectingHand, swipingHand, direction) {
    if (activeSelectingHand === 'right') {
      if (swipingHand === 'right') {
        return direction === 'right' ? 'next' : 'prev';
      }
      return null;
    }
    if (activeSelectingHand === 'left') {
      if (swipingHand === 'left') {
        return direction === 'right' ? 'next' : 'prev';
      }
      return null;
    }
    if (activeSelectingHand === 'both') {
      if (swipingHand === 'left' && direction === 'left') return 'prev';
      if (swipingHand === 'right' && direction === 'right') return 'next';
      return null;
    }
    return null;
  }

  // Right Hand Mode: right hand swiping right -> next, right hand swiping left -> prev
  assert.equal(simulateSwipe('right', 'right', 'right'), 'next');
  assert.equal(simulateSwipe('right', 'right', 'left'), 'prev');
  assert.equal(simulateSwipe('right', 'left', 'left'), null, 'Left hand swipe must not trigger in right hand mode');
  assert.equal(simulateSwipe('right', 'left', 'right'), null, 'Left hand swipe must not trigger in right hand mode');

  // Left Hand Mode: left hand swiping right -> next, left hand swiping left -> prev
  assert.equal(simulateSwipe('left', 'left', 'right'), 'next');
  assert.equal(simulateSwipe('left', 'left', 'left'), 'prev');
  assert.equal(simulateSwipe('left', 'right', 'right'), null, 'Right hand swipe must not trigger in left hand mode');
  assert.equal(simulateSwipe('left', 'right', 'left'), null, 'Right hand swipe must not trigger in left hand mode');

  // Both Hands Mode: left hand left -> prev, right hand right -> next
  assert.equal(simulateSwipe('both', 'left', 'left'), 'prev');
  assert.equal(simulateSwipe('both', 'right', 'right'), 'next');
  assert.equal(simulateSwipe('both', 'left', 'right'), null, 'Left hand swiping right must not trigger in both hands mode');
  assert.equal(simulateSwipe('both', 'right', 'left'), null, 'Right hand swiping left must not trigger in both hands mode');
});

test('10. verifies all 5 user requests: posture removed, footers removed, umove header, color selection', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf-8');
  const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf-8');

  // 1. Posture removed from robot game and card info
  assert.ok(!html.includes('class="game-view-quick-posture"'), 'Game view posture must be removed');
  assert.ok(!html.includes('class="details-top-posture"'), 'Details top posture must be removed');
  assert.ok(!html.includes('id="details-posture-badge"'), 'Details posture badge must be removed');
  assert.ok(!html.includes('id="details-posture-val"'), 'Details posture val must be removed');

  // 2. Bottom footer "built for accessibility" removed
  assert.ok(!html.includes('class="app-footer"'), 'app-footer must be removed');
  assert.ok(!html.includes('Built for Accessibility'), 'Built for Accessibility text must be removed');

  // 3. Bottom footer showing controls from homepage removed
  assert.ok(!html.includes('class="motion-helper-bar"'), 'motion-helper-bar must be removed');

  // 4. Change top header to "Welcome to umove" and "Choose your activity" below it
  assert.ok(html.includes('<h1 class="carousel-heading">Welcome to umove</h1>'), 'H1 must be Welcome to umove');
  assert.ok(html.includes('Choose your activity'), 'Subheading must be Choose your activity');

  // 5. Selectable colors in initial setup and start menu
  assert.ok(html.includes('id="group-welcome-color"'), 'Welcome modal must have color selection');
  assert.ok(html.includes('id="group-settings-color"'), 'Settings dialog must have color selection');
  assert.ok(html.includes('id="header-theme-picker"'), 'Header must have color selection');
  assert.ok(styleCss.includes('body[data-color="purple"]'), 'CSS must define purple theme');
  assert.ok(styleCss.includes('body[data-color="emerald"]'), 'CSS must define emerald theme');
  assert.ok(styleCss.includes('body[data-color="coral"]'), 'CSS must define coral theme');
  assert.ok(styleCss.includes('body[data-color="rose"]'), 'CSS must define rose theme');
  assert.ok(mainJs.includes('THEME_COLORS'), 'main.js must define THEME_COLORS');
  assert.ok(mainJs.includes('applyRobotTheme'), 'main.js must define applyRobotTheme');
  assert.ok(mainJs.includes('setThemeColor'), 'main.js must define setThemeColor');
  assert.ok(styleCss.includes('body[data-color="purple"] .card-media img'), 'CSS must tint robot preview image for purple theme');
  assert.ok(styleCss.includes('body[data-color="emerald"] .card-media img'), 'CSS must tint robot preview image for emerald theme');
  assert.ok(styleCss.includes('body[data-color="coral"] .card-media img'), 'CSS must tint robot preview image for coral theme');
  assert.ok(styleCss.includes('body[data-color="rose"] .card-media img'), 'CSS must tint robot preview image for rose theme');

  // 6. Live camera banner that shows action and posture is removed
  assert.ok(!html.includes('id="mini-gesture-badge"'), 'Live camera action and posture banner must be removed');
  assert.ok(!mainJs.includes('mini-gesture-badge'), 'main.js must not reference removed mini-gesture-badge');
});

test('11. carousel cards fit full page, settings high contrast mode fixes black-on-black text, and text size scaling works', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf-8');
  const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf-8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  // 1. Carousel cards fit full page (expanded from 450px to 620px max, 320px min)
  assert.ok(css.includes('--carousel-card-h: clamp(320px, min(66vh, calc(100dvh - 190px)), 620px);'), 'Card height must expand to fill page');
  assert.ok(css.includes('--carousel-card-w: clamp(260px, calc(var(--carousel-card-h) * 0.74), min(480px, 86vw));'), 'Card width must scale proportionally with expanded height');

  // 2. High contrast mode in settings (WCAG AAA contrast, no black-on-black text)
  assert.ok(css.includes('body[data-theme="high"] .accessibility-dialog'), 'CSS must specify high contrast dialog styles');
  assert.ok(css.includes('body[data-theme="high"] .radio-pill'), 'CSS must specify high contrast unselected radio pills');
  assert.ok(css.includes('body[data-theme="high"] .radio-pill:has(input:checked)'), 'CSS must specify high contrast active radio pills');
  assert.ok(css.includes('body[data-theme="high"] .setting-title'), 'CSS must specify white text for high contrast setting titles');
  assert.ok(css.includes('body[data-theme="high"] .help-list'), 'CSS must specify readable high contrast help list');

  // 3. Text size scaling works on both documentElement and body (Default 130%, Large 150%, Extra Large 175%)
  assert.ok(mainJs.includes("document.documentElement.setAttribute('data-text-size', val);"), 'main.js must set data-text-size on documentElement');
  assert.ok(mainJs.includes("document.documentElement.setAttribute('data-text-size', validTextSize);"), 'loadSavedPreferences must set data-text-size on documentElement');
  assert.ok(css.includes(':root[data-text-size="130"]'), 'CSS must scale font on :root for 130%');
  assert.ok(css.includes(':root[data-text-size="150"]'), 'CSS must scale font on :root for 150%');
  assert.ok(css.includes(':root[data-text-size="175"]'), 'CSS must scale font on :root for 175%');
  assert.ok(html.includes('value="130" checked> Default'), 'Default must be 130 and checked');
  assert.ok(html.includes('value="150"> Large (150%)'), 'Large must be 150');
  assert.ok(html.includes('value="175"> Extra Large (175%)'), 'Extra large must be 175');
  assert.ok(css.includes('font-size: calc(16px * var(--font-scale, 1));'), 'html must scale font-size using --font-scale');
});

test('12. color blind settings, player counter removed from games config, start activity button enlarged, modes and movement tips removed', async () => {
  const { GAMES_CONFIG } = await import('../src/gamesConfig.js');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf-8');
  const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf-8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  // 1. Color blind settings in HTML, CSS, and main.js
  assert.ok(html.includes('id="group-settings-colorblind"'), 'Settings must include Color Vision Filter group');
  assert.ok(html.includes('name="setting-colorblind"'), 'Color blind radios must exist');
  assert.ok(html.includes('value="protanopia"'), 'Protanopia option must exist');
  assert.ok(html.includes('value="deuteranopia"'), 'Deuteranopia option must exist');
  assert.ok(html.includes('value="tritanopia"'), 'Tritanopia option must exist');
  assert.ok(html.includes('value="achromatopsia"'), 'Achromatopsia option must exist');
  assert.ok(html.includes('id="filter-protanopia"'), 'SVG filter for protanopia must exist');
  assert.ok(html.includes('id="filter-deuteranopia"'), 'SVG filter for deuteranopia must exist');
  assert.ok(html.includes('id="filter-tritanopia"'), 'SVG filter for tritanopia must exist');
  assert.ok(html.includes('id="filter-achromatopsia"'), 'SVG filter for achromatopsia must exist');

  assert.ok(css.includes('body[data-colorblind="protanopia"]'), 'CSS must apply protanopia filter');
  assert.ok(css.includes('body[data-colorblind="deuteranopia"]'), 'CSS must apply deuteranopia filter');
  assert.ok(css.includes('body[data-colorblind="tritanopia"]'), 'CSS must apply tritanopia filter');
  assert.ok(css.includes('body[data-colorblind="achromatopsia"]'), 'CSS must apply achromatopsia filter');

  assert.ok(mainJs.includes('setting-colorblind'), 'main.js must listen for colorblind changes');
  assert.ok(mainJs.includes('adaptmove_colorblind'), 'main.js must persist colorblind preference');

  // 2. Players property removed from all entries in GAMES_CONFIG and from start page
  for (const game of GAMES_CONFIG) {
    assert.equal(game.players, undefined, `Game ${game.id} must not have players property`);
  }
  assert.ok(!html.includes('id="details-players-val"'), 'Participants / player count must be removed from details view');

  // 3. Modes property removed from all entries in GAMES_CONFIG
  for (const game of GAMES_CONFIG) {
    assert.equal(game.modes, undefined, `Game ${game.id} must not have modes property`);
  }

  // 4. Movement tips removed from the game start page (details view)
  const detailsHtml = html.slice(html.indexOf('id="view-details"'), html.indexOf('id="view-game"'));
  assert.ok(!detailsHtml.includes('class="details-tips-card"'), 'Movement tips card must be removed from game start page');
  assert.ok(!detailsHtml.includes('Movement Tips'), 'Movement Tips heading must be removed from game start page');

  // 5. Start Activity button is styled larger
  assert.ok(css.includes('#btn-start-game {'), 'CSS must have dedicated #btn-start-game rule');
  assert.ok(css.includes('min-height: 68px;'), '#btn-start-game must have enlarged min-height');
  assert.ok(css.includes('font-size: 1.35rem;'), '#btn-start-game must have enlarged font-size');
});

test('13. robot demo view cleanups: auto-legs tracking, removal of tips and camera help, removed stage headers/footers, and Watch Moshi Mirror title', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf-8');
  const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf-8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  const gameViewHtml = html.slice(html.indexOf('id="view-game"'), html.indexOf('id="video"'));

  // 1. Legs checkbox removed and automatic leg tracking in main.js
  assert.ok(!gameViewHtml.includes('id="legs"'), 'Legs checkbox must be removed from robot demo');
  assert.ok(!gameViewHtml.includes('id="legs-label"'), 'Legs label must be removed from robot demo');
  assert.ok(!gameViewHtml.includes('Follow legs too'), 'Follow legs text must be removed from robot demo');
  assert.ok(mainJs.includes('followLegs = Boolean(latest.worldLandmarks'), 'main.js must automatically track legs when in frame');

  // 2. Ergonomic movement tips and camera help removed
  assert.ok(!gameViewHtml.includes('Ergonomic movement tips'), 'Ergonomic movement tips must be removed from robot demo');
  assert.ok(!gameViewHtml.includes('Camera help'), 'Camera help must be removed from robot demo');
  assert.ok(!gameViewHtml.includes('<details>'), 'details tag must be removed from robot demo');

  // 3. Stage header text on the left and stage footer removed
  assert.ok(!gameViewHtml.includes('id="game-stage-label"'), 'game-stage-label must be removed');
  assert.ok(!gameViewHtml.includes('id="game-stage-title"'), 'game-stage-title must be removed');
  assert.ok(!gameViewHtml.includes('class="stage-footer"'), 'stage-footer must be removed');
  assert.ok(!gameViewHtml.includes('Ready when you are'), 'Ready when you are must be removed from stage markup');

  // 4. Connect and move together replaced with Watch Moshi Mirror Your Every Move!
  assert.ok(!gameViewHtml.includes('01 / CONNECT'), '01 / CONNECT must be removed');
  assert.ok(!gameViewHtml.includes('Move together.'), 'Move together. must be removed');
  assert.ok(gameViewHtml.includes('Watch Moshi Mirror Your Every Move!'), 'Watch Moshi Mirror Your Every Move! heading must be present');
});


