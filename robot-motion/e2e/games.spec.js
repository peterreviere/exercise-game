import { test, expect } from '@playwright/test';

// Run against the local Vite preview: GAME_TEST_URL=http://127.0.0.1:5174
// npx playwright test e2e/games.spec.js --project=chromium
// Hooks are injected into the test response only; the shipped app has no test API.
test.use({ channel: 'chrome', viewport: { width: 1200, height: 900 }, launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('stretch and flight retain branch gameplay inside the final UI', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('adaptmove_setup_complete', 'true'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source + `
      renderer.setPixelRatio(.5);
      window.gameTest = {
        openGameDetails, launchActiveGame, returnToCarousel, updateGameplay,
        stretchingState, flightRace, initStretchingSection, boxingRound, boxingOpponent,
        async motionSelect(id, hand = 'right') {
          const button = document.getElementById(id);
          const rect = button.getBoundingClientRect();
          const x = rect.x + rect.width/2;
          const y = rect.y + rect.height/2;
          const points = Array.from({length:33}, () => ({x:0,y:0,visibility:0}));
          points[hand === 'right' ? 16 : 15] = {x:1-(.16+x/window.innerWidth*.68),y:.12+y/window.innerHeight*.76,visibility:1};
          activeSelectingHand = 'both';
          for (let i=0; i<140 && getCompletionScreen(); i++) {
            lastSeen = performance.now();
            updateMotionHands(points, lastSeen);
            await new Promise(resolve => setTimeout(resolve,20));
          }
        },
        finishPractice() { practiceDeadline = performance.now()-1; },
        showBoxingCue(move) { boxingRound.start(performance.now()-3100, [move]); },
        simulateCamera() { stopCamera(); mode = "camera"; },
        get ready() { return stretchingEnvironments.length === 3 && !!rig && !!robotWingRig; },
        get readiness() { return {environments:stretchingEnvironments.length,robot:!!rig,wings:!!robotWingRig}; },
        get wingsVisible() { return attachedWings?.visible; },
        get propName() { return activeProp?.name; },
        setImage(points) { stretchingState.latestImage = points; },
      };
    ` });
  });
  await page.goto(process.env.GAME_TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => window.gameTest?.ready, null, { timeout: 20_000 }).catch(async error => { throw new Error(`${error.message}; browser errors: ${errors.join('; ')}; readiness: ${JSON.stringify(await page.evaluate(() => window.gameTest?.readiness))}`); });
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
  await expect(page.locator('#card-robot-buddy-2')).toHaveCount(0);
  await expect(page.locator('.carousel-card')).toHaveCount(4);
  if (process.env.GAME_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.GAME_SCREENSHOT_DIR}/carousel.png`});
  const launchState = await page.evaluate(() => {
    gameTest.simulateCamera(); gameTest.openGameDetails(1); gameTest.launchActiveGame();
    return { active:gameTest.boxingRound.active, countdown:document.getElementById('game-countdown-number').textContent };
  });
  expect(launchState).toEqual({active:false,countdown:'3'});
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  expect(await page.evaluate(() => gameTest.boxingRound.active)).toBe(true);
  expect(await page.evaluate(() => !!gameTest.boxingOpponent.modelRig)).toBe(true);
  await expect(page.locator('#boxing-cue-list')).toHaveCount(0);
  for (const [move, side, label] of [
    ['move-left','left','Dodge Left'], ['move-right','right','Dodge Right'],
    ['punch-left','left','Left Punch'], ['punch-right','right','Right Punch'],
    ['duck','left','Duck Down'], ['block','right','Block'],
  ]) {
    await page.evaluate(move => gameTest.showBoxingCue(move), move);
    await expect(page.locator('#boxing-action')).toBeVisible();
    await expect(page.locator('#boxing-action')).toHaveAttribute('data-side',side);
    await expect(page.locator('#boxing-action-label')).toHaveText(label);
  }

  await expect(page.locator('#game-controls')).toBeHidden();
  await expect(page.locator('.game-camera-pip')).toBeVisible();
  if (process.env.GAME_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.GAME_SCREENSHOT_DIR}/boxing.png`});
  await page.evaluate(() => { gameTest.boxingRound.startedAt = performance.now()-45_001; });
  await expect(page.locator('#round-end-screen')).toBeVisible();
  await expect(page.locator('#round-end-title')).toHaveText('Round Complete');
  await page.evaluate(() => gameTest.motionSelect('btn-round-restart','right'));
  await expect(page.locator('#game-countdown')).toBeVisible();
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  expect(await page.evaluate(() => gameTest.boxingRound.active)).toBe(true);
  const layout = await page.locator('.game-layout').boundingBox();
  const stage = await page.locator('.stage').boundingBox();
  expect(Math.abs(layout.width - stage.width)).toBeLessThan(2);
  await page.evaluate(() => { gameTest.returnToCarousel(); gameTest.openGameDetails(3); gameTest.launchActiveGame(); });
  await expect(page.locator('#stretching-hud')).toBeVisible();
  await expect(page.locator('#game-countdown')).toBeVisible();
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  await expect(page.locator('.game-camera-pip')).toBeVisible();
  await expect(page.locator('#game-controls')).toBeHidden();
  await expect(page.locator('#flying-hud')).toBeHidden();
  if (process.env.GAME_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.GAME_SCREENSHOT_DIR}/stretching.png`});

  // Exercise the real pose path: mirrored wrist reaches, delivery with that same
  // wrist, a continuous wingspan hold, cell direction, charge, then leg edges.
  const result = await page.evaluate(() => {
    const g = gameTest;
    const targets = [[.15,.58],[.85,.56],[.28,.24],[.72,.22],[.12,.38],[.88,.35]];
    const neutral = { valid: true, lean: 0, neutral: true, squat: 1 };
    const frame = (metrics, dt = .05) => g.updateGameplay(dt, metrics);
    for (const [x,y] of targets) {
      g.setImage(Array.from({length:33}, (_,i) => i === 15 ? {x:1-x,y,visibility:1} : {x:0,y:0,visibility:0}));
      frame(neutral);
      // Include carrying between target and socket, exercising the trail.
      g.setImage(Array.from({length:33}, (_,i) => i === 15 ? {x:.7,y:.4,visibility:1} : {x:0,y:0,visibility:0}));
      frame(neutral);
      g.setImage(Array.from({length:33}, (_,i) => i === 15 ? {x:.5,y:.58,visibility:1} : {x:0,y:0,visibility:0}));
      frame(neutral);
    }
    const wingsPhase = g.stretchingState.phase;
    g.setImage(null);
    for(let i=0;i<53;i++) frame({...neutral, armsWide:true});
    const powerSection = g.stretchingState.section;
    const cells=[];
    for(const direction of [-1,1,-1]) {
      cells.push(g.propName);
      for(let i=0;i<10;i++) frame({...neutral,lean:direction});
      frame({...neutral,diagonal:true});
    }
    const chargePhase=g.stretchingState.phase;
    for(let i=0;i<53;i++) frame(neutral);
    const launchSection=g.stretchingState.section;
    // Entering sector 3, standing still, losing tracking, or holding one knee
    // must never bypass marching, bridge crossings, and the three squats.
    for(let i=0;i<100;i++) frame(neutral);
    for(let i=0;i<100;i++) frame({...neutral,leftKnee:true});
    const heldSteps=g.stretchingState.steps;
    for(let i=0;i<100;i++) frame({valid:false});
    const entrySafe=g.stretchingState.section===2 && g.stretchingState.phase==='march' && heldSteps===1 && g.stretchingState.steps===1;
    g.initStretchingSection(2);
    for(let i=0;i<8;i++) {
      for(let n=0;n<5;n++) frame(neutral);
      g.stretchingState.lastMovement=-Infinity;
      frame({...neutral,leftKnee:true});
      frame(neutral);
      if(g.stretchingState.phase==='sidestep') for(let n=0;n<6;n++) frame({...neutral,lean:g.stretchingState.sideDirection});
    }
    // A held knee cannot count as repeated marching; squats need release edges.
    frame({...neutral,squat:1});
    for(let i=0;i<3;i++) {
      g.stretchingState.lastMovement=-Infinity;
      for(let n=0;n<5;n++) frame({...neutral,squat:1.3});
      frame({...neutral,squat:1});
    }
    return {entrySafe,wingsPhase,powerSection,cells,chargePhase,launchSection,phase:g.stretchingState.phase,steps:g.stretchingState.steps,launchMoves:g.stretchingState.launchMoves};
  });
  expect(result).toEqual({entrySafe:true,wingsPhase:'assemble',powerSection:1,cells:['Power_Cell_1','Power_Cell_2','Power_Cell_3'],chargePhase:'charge',launchSection:2,phase:'complete',steps:8,launchMoves:3});
  await expect(page.locator('#stretching-end-screen')).toBeVisible();
  await expect(page.locator('#stretching-end-title')).toHaveText('Round Complete');
  await page.evaluate(() => gameTest.motionSelect('btn-stretching-replay','left'));
  await expect(page.locator('#game-countdown')).toBeVisible();
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  expect(await page.evaluate(() => gameTest.stretchingState.part)).toBe(0);
  await page.evaluate(() => { gameTest.returnToCarousel(); gameTest.openGameDetails(2); gameTest.launchActiveGame(); });
  await expect(page.locator('#flying-hud')).toBeVisible();
  expect(await page.evaluate(() => gameTest.flightRace.phase)).toBe('ready');
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  await expect(page.locator('.game-camera-pip')).toBeVisible();
  await expect(page.locator('#game-controls')).toBeHidden();
  await expect(page.locator('#stretching-hud')).toBeHidden();
  await page.evaluate(() => { gameTest.flightRace.recordRing(true); gameTest.flightRace.startedAt=performance.now()-60_001; });
  await expect(page.locator('#flying-end-screen')).toBeVisible();
  await expect(page.locator('#flying-end-title')).toHaveText('Round Complete');
  await expect(page.locator('#flying-end-result')).toContainText('1 rings cleared');
  await page.evaluate(() => gameTest.motionSelect('btn-flying-replay','right'));
  await expect(page.locator('#game-countdown')).toBeVisible();
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  expect(await page.evaluate(() => ({ phase:gameTest.flightRace.phase, score:gameTest.flightRace.score }))).toEqual({phase:'flying',score:0});
  await page.evaluate(() => { gameTest.returnToCarousel(); gameTest.openGameDetails(0); gameTest.launchActiveGame(); });
  expect(await page.evaluate(() => gameTest.wingsVisible)).toBe(false);
  await expect(page.locator('#flying-hud')).toBeHidden();
  await expect(page.locator('#game-countdown')).toBeVisible();
  await page.evaluate(() => gameTest.returnToCarousel());
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  await page.waitForTimeout(3100);
  await expect(page.locator('#view-carousel')).toBeVisible();
  await page.evaluate(() => { gameTest.openGameDetails(0); gameTest.launchActiveGame(); });
  await expect(page.locator('#game-countdown')).toBeHidden({timeout:15000});
  await page.evaluate(() => gameTest.finishPractice());
  await expect(page.locator('#round-end-screen')).toBeVisible();
  await expect(page.locator('#round-end-result')).toContainText('One minute');
  await page.evaluate(() => gameTest.motionSelect('btn-round-menu','left'));
  await expect(page.locator('#view-carousel')).toBeVisible();
  await expect(page.locator('#round-end-screen')).toBeHidden();
  expect(errors).toEqual([]);
});
