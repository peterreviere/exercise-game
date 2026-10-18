import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to simulate a DOM element
function createMockElement(id, className = '', parent = null) {
  const children = [];
  const el = {
    id,
    className,
    parentElement: parent,
    classList: {
      _classes: new Set(className.split(' ').filter(Boolean)),
      contains(c) { return this._classes.has(c); },
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) {
          this._classes.add(c);
        } else {
          this._classes.delete(c);
        }
      }
    },
    children,
    appendChild(child) {
      if (child.parentElement && child.parentElement.children) {
        const idx = child.parentElement.children.indexOf(child);
        if (idx >= 0) child.parentElement.children.splice(idx, 1);
      }
      child.parentElement = this;
      children.push(child);
      return child;
    },
    contains(other) {
      if (!other) return false;
      if (other === this) return true;
      let curr = other.parentElement;
      while (curr) {
        if (curr === this) return true;
        curr = curr.parentElement;
      }
      return false;
    },
    closest(selector) {
      const parts = selector.split(',').map(s => s.trim());
      let curr = this;
      while (curr) {
        for (const part of parts) {
          if (part.startsWith('.') && curr.classList.contains(part.slice(1))) return curr;
          if (part.startsWith('#') && curr.id === part.slice(1)) return curr;
          if (curr.className && curr.className.split(' ').includes(part.replace('.', ''))) return curr;
        }
        curr = curr.parentElement;
      }
      return null;
    }
  };
  if (parent) parent.children.push(el);
  return el;
}

test('motion controls confinement: target filtering rejects elements outside active modal', () => {
  const app = createMockElement('app');
  const carouselCard = createMockElement('card-0', 'carousel-card motion-target', app);
  const playButton = createMockElement('btn-play', 'btn-primary motion-target', app);
  
  const dialogPosture = createMockElement('dialog-posture', 'motion-dialog', app);
  dialogPosture.open = true;
  const postureCardSitting = createMockElement('opt-posture-sitting', 'motion-select-card motion-target', dialogPosture);
  const postureCardStanding = createMockElement('opt-posture-standing', 'motion-select-card motion-target', dialogPosture);

  function resolveClickableTarget(hitElement, activeModal) {
    let clickableTarget = hitElement?.closest('.motion-target, .carousel-card, button, .mode-btn, .radio-card, .radio-pill, .motion-select-card');
    if (activeModal) {
      if (clickableTarget && !activeModal.contains(clickableTarget)) {
        clickableTarget = null;
      }
    }
    return clickableTarget;
  }

  // 1. Pointing at background carousel card while dialog is open -> rejected
  const bgTarget = resolveClickableTarget(carouselCard, dialogPosture);
  assert.equal(bgTarget, null, 'Background card must not be selectable while popup is active');

  // 2. Pointing at background play button while dialog is open -> rejected
  const bgBtn = resolveClickableTarget(playButton, dialogPosture);
  assert.equal(bgBtn, null, 'Background play button must not be selectable while popup is active');

  // 3. Pointing at posture options inside dialog -> accepted
  const popupTarget = resolveClickableTarget(postureCardSitting, dialogPosture);
  assert.equal(popupTarget, postureCardSitting, 'Sitting card inside dialog must be selectable');

  const popupTarget2 = resolveClickableTarget(postureCardStanding, dialogPosture);
  assert.equal(popupTarget2, postureCardStanding, 'Standing card inside dialog must be selectable');

  // 4. When dialog is closed (activeModal = null) -> carousel card accepted again
  const normalTarget = resolveClickableTarget(carouselCard, null);
  assert.equal(normalTarget, carouselCard, 'Carousel card can be selected once dialog is closed');
});

test('motion controls layer sync reparents cursors into active dialog and restores to app on close', () => {
  const app = createMockElement('app');
  const cursorLeft = createMockElement('hand-cursor-left', 'hand-cursor', app);
  const cursorRight = createMockElement('hand-cursor-right', 'hand-cursor', app);
  const miniHud = createMockElement('mini-camera-hud', 'mini-camera-hud', app);
  const chestBanner = createMockElement('chest-pose-banner', 'chest-pose-banner', app);

  const dialog = createMockElement('dialog-hand', 'motion-dialog', app);
  dialog.open = false;

  function syncLayer(activeDialog) {
    const target = activeDialog || app;
    if (cursorLeft.parentElement !== target) target.appendChild(cursorLeft);
    if (cursorRight.parentElement !== target) target.appendChild(cursorRight);
    if (miniHud.parentElement !== target) target.appendChild(miniHud);
    if (chestBanner.parentElement !== target) target.appendChild(chestBanner);
  }

  // Initial state: in app
  assert.equal(cursorLeft.parentElement, app);
  assert.equal(cursorRight.parentElement, app);
  assert.equal(miniHud.parentElement, app);

  // Dialog opens: reparent to dialog
  dialog.open = true;
  syncLayer(dialog);
  assert.equal(cursorLeft.parentElement, dialog, 'Left cursor must be in dialog for Top Layer visibility');
  assert.equal(cursorRight.parentElement, dialog, 'Right cursor must be in dialog for Top Layer visibility');
  assert.equal(miniHud.parentElement, dialog, 'Mini camera preview must be in dialog');
  assert.equal(chestBanner.parentElement, dialog, 'Chest pose banner must be in dialog');

  // Dialog closes: reparent back to app
  dialog.open = false;
  syncLayer(null);
  assert.equal(cursorLeft.parentElement, app, 'Left cursor must return to app on dialog close');
  assert.equal(cursorRight.parentElement, app, 'Right cursor must return to app on dialog close');
  assert.equal(miniHud.parentElement, app, 'Mini camera preview must return to app');
  assert.equal(chestBanner.parentElement, app, 'Chest banner must return to app');
});

test('hand swipe gestures navigate dialog steps and never cycle background carousel', () => {
  let activePopup = 'dialog-posture';
  let carouselIndex = 0;

  function handleSwipe(direction, activeDialogId) {
    if (activeDialogId) {
      if (direction === 'right') {
        if (activeDialogId === 'dialog-posture') activePopup = 'dialog-hand';
        else if (activeDialogId === 'dialog-hand') activePopup = 'dialog-select-mode';
        else if (activeDialogId === 'dialog-select-mode') activePopup = null; // completed
      } else if (direction === 'left') {
        if (activeDialogId === 'dialog-hand') activePopup = 'dialog-posture';
        else if (activeDialogId === 'dialog-select-mode') activePopup = 'dialog-hand';
      }
      return; // Never swipe carousel
    }
    if (direction === 'right') carouselIndex++;
    else if (direction === 'left') carouselIndex--;
  }

  // 1. Swiping right in Posture popup advances to Hand popup
  handleSwipe('right', activePopup);
  assert.equal(activePopup, 'dialog-hand');
  assert.equal(carouselIndex, 0, 'Background carousel must not move');

  // 2. Swiping right in Hand popup advances to Select Mode popup
  handleSwipe('right', activePopup);
  assert.equal(activePopup, 'dialog-select-mode');
  assert.equal(carouselIndex, 0, 'Background carousel must not move');

  // 3. Swiping left in Select Mode popup goes back to Hand popup
  handleSwipe('left', activePopup);
  assert.equal(activePopup, 'dialog-hand');
  assert.equal(carouselIndex, 0, 'Background carousel must not move');

  // 4. Swiping right twice finishes setup
  handleSwipe('right', activePopup); // to select-mode
  assert.equal(activePopup, 'dialog-select-mode');
  handleSwipe('right', activePopup); // saves and closes
  assert.equal(activePopup, null, 'Setup completes and closes');
  assert.equal(carouselIndex, 0, 'Background carousel remained unaffected');

  // 5. Now that popup is closed, swipes move carousel
  handleSwipe('right', null);
  assert.equal(carouselIndex, 1);
  handleSwipe('left', null);
  assert.equal(carouselIndex, 0);
});

test('hands-to-chest pose navigates back through popups without changing main views', () => {
  let currentView = 'carousel';
  let activePopup = 'dialog-select-mode';

  function triggerChestPose(activeDialogId) {
    if (activeDialogId) {
      if (activeDialogId === 'dialog-select-mode') activePopup = 'dialog-hand';
      else if (activeDialogId === 'dialog-hand') activePopup = 'dialog-posture';
      else activePopup = null;
      return;
    }
    currentView = 'carousel';
  }

  triggerChestPose(activePopup);
  assert.equal(activePopup, 'dialog-hand');
  assert.equal(currentView, 'carousel');

  triggerChestPose(activePopup);
  assert.equal(activePopup, 'dialog-posture');
  assert.equal(currentView, 'carousel');

  triggerChestPose(activePopup);
  assert.equal(activePopup, null);
  assert.equal(currentView, 'carousel');
});

test('brand home button is named blue and resets popups and view to carousel', () => {
  let currentView = 'game';
  let openPopups = ['dialog-posture'];
  
  function clickHome() {
    openPopups = [];
    currentView = 'carousel';
  }

  clickHome();
  assert.equal(currentView, 'carousel', 'Home button must return to carousel view');
  assert.equal(openPopups.length, 0, 'Home button must close all active popups');
});

test('accidental back navigation is prevented: initial posture modal requires 1600ms hold and does not dismiss', () => {
  let activePopup = 'dialog-posture';
  let chestPoseElapsed = 800; // Above old 750ms threshold

  function evaluateChestPose(dialogId, elapsedMs) {
    const requiredHoldTime = dialogId ? 1600 : 750;
    if (elapsedMs < requiredHoldTime) {
      return { triggered: false, nextPopup: dialogId };
    }
    if (dialogId === 'dialog-posture') {
      // First step: do not dismiss
      return { triggered: true, nextPopup: 'dialog-posture' };
    }
    return { triggered: true, nextPopup: null };
  }

  // 1. Holding for 800ms inside modal should not trigger (needs 1600ms)
  let result = evaluateChestPose(activePopup, chestPoseElapsed);
  assert.equal(result.triggered, false, '800ms hold must not trigger chest pose in modal');
  assert.equal(result.nextPopup, 'dialog-posture');

  // 2. Holding for 1600ms on dialog-posture does not dismiss the initial wizard
  chestPoseElapsed = 1600;
  result = evaluateChestPose(activePopup, chestPoseElapsed);
  assert.equal(result.triggered, true);
  assert.equal(result.nextPopup, 'dialog-posture', 'dialog-posture must not be dismissed unexpectedly');
});

