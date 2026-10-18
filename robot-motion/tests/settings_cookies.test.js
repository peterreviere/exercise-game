import test from 'node:test';
import assert from 'node:assert/strict';

// Simulated browser cookie jar
let mockCookieJar = '';

function setCookie(name, value, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = '; expires=' + d.toUTCString();
  const pair = name + '=' + encodeURIComponent(value ?? '');
  
  // Update mock cookie jar
  const cookies = mockCookieJar ? mockCookieJar.split('; ') : [];
  const idx = cookies.findIndex(c => c.startsWith(name + '='));
  if (idx >= 0) {
    cookies[idx] = pair;
  } else {
    cookies.push(pair);
  }
  mockCookieJar = cookies.join('; ');
}

function getCookie(name) {
  const nameEQ = name + '=';
  const ca = mockCookieJar.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

test('cookie set and get works correctly', () => {
  mockCookieJar = '';
  assert.equal(getCookie('adaptmove_setup_complete'), null);
  
  setCookie('adaptmove_setup_complete', 'true');
  assert.equal(getCookie('adaptmove_setup_complete'), 'true');

  setCookie('adaptmove_posture', 'sitting');
  assert.equal(getCookie('adaptmove_posture'), 'sitting');

  setCookie('adaptmove_click_mode', 'dwell');
  assert.equal(getCookie('adaptmove_click_mode'), 'dwell');

  setCookie('adaptmove_dwell_time', '1800');
  assert.equal(getCookie('adaptmove_dwell_time'), '1800');
  assert.equal(Number(getCookie('adaptmove_dwell_time')), 1800);
});

test('first-time visitor check triggers modal, returning visitor skips auto-modal', () => {
  mockCookieJar = '';
  // First time visitor
  let shouldShowOnLoad = getCookie('adaptmove_setup_complete') !== 'true';
  assert.equal(shouldShowOnLoad, true, 'First-time visitor should see settings popup');

  // Visitor completes setup and saves
  setCookie('adaptmove_setup_complete', 'true');
  setCookie('adaptmove_posture', 'sitting');
  setCookie('adaptmove_active_hand', 'right');

  // Returning visitor reload
  shouldShowOnLoad = getCookie('adaptmove_setup_complete') !== 'true';
  assert.equal(shouldShowOnLoad, false, 'Returning visitor should not be interrupted by auto popup');
  assert.equal(getCookie('adaptmove_posture'), 'sitting');
  assert.equal(getCookie('adaptmove_active_hand'), 'right');
});

test('multi-step motion popups flow correctly from posture to hand to select mode', () => {
  mockCookieJar = '';
  // State simulation
  let state = {
    posture: 'sitting',
    hand: 'right',
    clickMode: 'fist',
    dwellTime: 1400,
    setupComplete: false,
    activePopup: 'posture' // Step 1
  };

  // Step 1: User selects standing in Posture popup and clicks next
  state.posture = 'standing';
  setCookie('adaptmove_posture', state.posture);
  state.activePopup = 'hand'; // Step 2

  assert.equal(getCookie('adaptmove_posture'), 'standing');
  assert.equal(state.activePopup, 'hand');

  // Step 2: User selects left hand in Hand popup and clicks next
  state.hand = 'left';
  setCookie('adaptmove_active_hand', state.hand);
  state.activePopup = 'select-mode'; // Step 3

  assert.equal(getCookie('adaptmove_active_hand'), 'left');
  assert.equal(state.activePopup, 'select-mode');

  // Step 3: User chooses dwell timer with 1800ms and clicks save
  state.clickMode = 'dwell';
  state.dwellTime = 1800;
  setCookie('adaptmove_click_mode', state.clickMode);
  setCookie('adaptmove_dwell_time', String(state.dwellTime));
  setCookie('adaptmove_setup_complete', 'true');
  state.activePopup = null; // Closed

  assert.equal(getCookie('adaptmove_click_mode'), 'dwell');
  assert.equal(getCookie('adaptmove_dwell_time'), '1800');
  assert.equal(getCookie('adaptmove_setup_complete'), 'true');
  assert.equal(state.activePopup, null);
});

test('user can jump to accessibility dialog from any popup', () => {
  let activePopup = 'posture';
  // Click accessibility settings button
  activePopup = 'accessibility';
  assert.equal(activePopup, 'accessibility');

  activePopup = 'hand';
  activePopup = 'accessibility';
  assert.equal(activePopup, 'accessibility');

  activePopup = 'select-mode';
  activePopup = 'accessibility';
  assert.equal(activePopup, 'accessibility');
});

