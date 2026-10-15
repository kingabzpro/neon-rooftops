// ============================================================================
// NEON ROOFTOPS - an original endless runner
//
// Core mechanics are ported from the shipped Chrome dino engine (offline.js,
// Chrome 155.0.8059.41, resource 40019 of resources.pak) that we reverse-
// engineered earlier in this repo. Where a constant or formula came from the
// dino evidence, the comment says so. All art is original, generated in code.
//
// Runs in the browser (index.html) and headless under Node (`node game.js`
// runs the self-test).
// ============================================================================
'use strict';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

// --- tuning constants (dino provenance noted) ------------------------------
const FPS = 60;                            // dino: const FPS = 60
const MS_PER_FRAME = 1000 / FPS;           // dino: msPerFrame = 1e3/FPS
const GRAVITY = 0.6;                       // dino: normalJumpConfig.gravity
const INITIAL_JUMP_VELOCITY = 10.5;        // dino: -10 (negated: our y grows upward)
const DROP_VELOCITY = 5;                   // dino: dropVelocity -5 (early release clamp)
const MIN_JUMP_HEIGHT = 30;                // dino: minJumpHeight 30
const SPEED_DROP_COEFFICIENT = 3;          // dino: speedDropCoefficient 3 (dive)
const SPEED_START = 6;                     // dino: normalModeConfig.speed
const ACCELERATION = 0.001;                // dino: normalModeConfig.acceleration
const MAX_SPEED = 13;                      // dino: normalModeConfig.maxSpeed
const GAP_COEFFICIENT = 0.6;               // dino: normalModeConfig.gapCoefficient
const MAX_GAP_COEFFICIENT = 1.5;           // dino: spriteDef.maxGapCoefficient
const SCORE_COEFFICIENT = 0.025;           // dino: Config$2.COEFFICIENT
const ACHIEVEMENT_DISTANCE = 100;          // dino: Config$2.ACHIEVEMENT_DISTANCE
const FLASH_DURATION = 250;                // dino: Config$2.FLASH_DURATION
const FLASH_ITERATIONS = 3;                // dino: Config$2.FLASH_ITERATIONS
const CLEAR_TIME = 2500;                   // dino: clearTime 3000 (grace before obstacles)
const MAX_OBSTACLE_DUPLICATION = 2;        // dino: maxObstacleDuplication
const JUMP_KEYS = [32, 38];                // dino: runnerKeycodes.jump = [38, 32]
const DUCK_KEY = 40;                       // dino: duck [40] -> we only use it to dive
const RESTART_KEYS = [13, 32];             // dino: restart [13]

// --- pure helpers (direct ports of dino functions) -------------------------

// dino boxCompare (offline.js @97192): strict AABB overlap, touching edges = no hit
function boxCompare(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

// dino createAdjustedCollisionBox (@96744): shift a sub-box by its owner's outer box
function adjustedBox(box, outer) {
  return { x: box.x + outer.x, y: box.y + outer.y, width: box.width, height: box.height };
}

// dino Obstacle.getGap (@~47700): min gap grows with width*speed, max is 1.5x
function getGap(width, speed, minGapBase, gapCoefficient) {
  const minGap = Math.round(width * speed + minGapBase * gapCoefficient);
  const maxGap = Math.round(minGap * MAX_GAP_COEFFICIENT);
  return minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
}

// dino DistanceMeter.getActualDistance (@21566)
function getActualDistance(distanceRan) {
  return distanceRan ? Math.round(distanceRan * SCORE_COEFFICIENT) : 0;
}

function getRandomNum(min, max) {          // dino getRandomNum: inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// deterministic rng for scenery only (so tests / screenshots are stable)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- evolving night palette: sky and skyline tint drift with distance ------
const SKY_PHASES = [
  { at: 0,    top: [11, 13, 36], mid: [29, 23, 64], bot: [43, 28, 78], far: [25, 28, 60], near: [16, 18, 42] }, // indigo night
  { at: 2500, top: [42, 10, 50], mid: [60, 20, 82], bot: [92, 32, 94], far: [44, 24, 74], near: [28, 16, 54] }, // magenta dusk
  { at: 5500, top: [9, 30, 44],  mid: [16, 58, 74], bot: [26, 92, 88], far: [20, 48, 64], near: [14, 32, 48] }, // teal dawn
  { at: 9000, top: [11, 13, 36], mid: [29, 23, 64], bot: [43, 28, 78], far: [25, 28, 60], near: [16, 18, 42] }, // cycle back
];
function themeColors(distance) {
  const cycle = SKY_PHASES[SKY_PHASES.length - 1].at;
  const d = ((distance % cycle) + cycle) % cycle;
  let a = SKY_PHASES[0], b = SKY_PHASES[SKY_PHASES.length - 1];
  for (let i = 0; i < SKY_PHASES.length - 1; i++) {
    if (d >= SKY_PHASES[i].at && d <= SKY_PHASES[i + 1].at) { a = SKY_PHASES[i]; b = SKY_PHASES[i + 1]; break; }
  }
  const t = b.at === a.at ? 0 : (d - a.at) / (b.at - a.at);
  const mix3 = (c1, c2) => c1.map((u, i) => Math.round(u + (c2[i] - u) * t));
  return {
    top: mix3(a.top, b.top), mid: mix3(a.mid, b.mid), bot: mix3(a.bot, b.bot),
    far: mix3(a.far, b.far), near: mix3(a.near, b.near),
  };
}
const cssRgb = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';

// ============================================================================
// ORIGINAL PIXEL ART - the cat. String maps, one char per pixel.
// .  transparent   o orange   d dark-orange stripe   w cream
// g green eye      k black    p pink
// ============================================================================
const CAT_SCALE = 2;                       // 16x14 grid -> 32x28 px on screen
const CAT_PALETTE = {
  o: '#f39b3f', d: '#c96a1e', w: '#ffe9c4', g: '#5df08a', k: '#1a1226', p: '#ff8fb0',
};

const CAT_FRAMES = {
  // side view, facing right. tail curls up on the left.
  run1: [
        "................",
        "..........k..k..",
        ".........kpk.kpk",
        "........kooooook",
        "........koooggok",
        "dd......kwwwwwpk",
        ".dd.....koowwook",
        "..ddooooooooodd.",
        "...doooooooood..",
        "....oowwwwoo....",
        "....oowwwwoo....",
        "....ok....ko....",
        "....ok....ko....",
        "...ok......ko..."],
  run2: [
        "................",
        "..........k..k..",
        ".........kpk.kpk",
        "........kooooook",
        "........koooggok",
        "dd......kwwwwwpk",
        ".dd.....koowwook",
        "..ddooooooooodd.",
        "...doooooooood..",
        "....oowwwwoo....",
        "....oowwwwoo....",
        ".....ok..ok.....",
        ".....ok..ok.....",
        ".....ok..ok....."],
  jump: [
        "................",
        "..........k..k..",
        ".........kpk.kpk",
        "........kooooook",
        "........koooggok",
        "dd......kwwwwwpk",
        ".dd.....koowwook",
        "..ddooooooooodd.",
        "...doooooooood..",
        "...oowwwwwwoo...",
        "...oowwwwwwoo...",
        "..ok......ko....",
        "..ok.......ko...",
        "................"],
  fall: [
        "................",
        "..........k..k..",
        ".........kpk.kpk",
        "........kooooook",
        "........koooggok",
        "dd......kwwwwwpk",
        ".dd.....koowwook",
        "..ddooooooooodd.",
        "...doooooooood..",
        "....oowwwwoo....",
        "....oowwwwwoo...",
        "....ookk.kkoo...",
        ".....ok...ok....",
        "................"],
  crash: [
        "................",
        "................",
        "..........k..k..",
        ".........kpk.kpk",
        "........kooooook",
        "........kookkook",
        "dd......kwwwwwpk",
        ".dd.....koowwook",
        "..ddooooooooodd.",
        "...doooooood....",
        "...ooowwwwooo...",
        "...oowwwwwwoo...",
        "...oowwwwwwwoo..",
        "....kk....kk...."],
};

// cat collision sub-boxes (px, relative to 32x28 sprite) - the dino uses
// per-sprite sub-boxes so grazing pixels don't kill you
const CAT_BOXES_RUNNING = [
  { x: 16, y: 2, width: 15, height: 10 },  // head
  { x: 4, y: 12, width: 24, height: 10 },  // body
  { x: 6, y: 22, width: 16, height: 5 },   // legs
];
const CAT_BOXES_JUMPING = [
  { x: 16, y: 2, width: 15, height: 10 },  // head
  { x: 4, y: 12, width: 22, height: 10 },  // tucked body
];

// ============================================================================
// OBSTACLES - chimneys (ground, like cacti) and a drone (air, like ptero).
// multipleSpeed/minSpeed are dino concepts: clusters unlock with speed,
// drone only appears once you're fast.
// ============================================================================
const OBSTACLE_TYPES = {
  chimneySmall: {
    width: 16, height: 26,
    minGap: 120, minSpeed: 0, multipleSpeed: 4, maxLength: 3,
    boxes: [{ x: 0, y: 0, width: 16, height: 6 }, { x: 2, y: 6, width: 12, height: 20 }],
  },
  chimneyLarge: {
    width: 20, height: 40,
    minGap: 120, minSpeed: 0, multipleSpeed: 7, maxLength: 2,
    boxes: [{ x: 0, y: 0, width: 20, height: 7 }, { x: 3, y: 7, width: 14, height: 33 }],
  },
  dish: {                                   // rooftop satellite dish
    width: 22, height: 30,
    minGap: 130, minSpeed: 0, multipleSpeed: 5, maxLength: 1,
    boxes: [{ x: 2, y: 0, width: 18, height: 12 }, { x: 9, y: 12, width: 5, height: 18 }],
  },
  ac: {                                     // wide low AC unit: quick low jumps
    width: 34, height: 18,
    minGap: 140, minSpeed: 0, multipleSpeed: 999, maxLength: 1,
    boxes: [{ x: 2, y: 2, width: 30, height: 14 }],
  },
  drone: {
    width: 30, height: 18,
    minGap: 150, minSpeed: 7.2, multipleSpeed: 999, maxLength: 1,
    numFrames: 2, frameRate: 1000 / 6, speedOffset: 0.8, // dino pterodactyl values
    yOffsets: [44, 20, 8],
    boxes: [{ x: 2, y: 0, width: 26, height: 4 }, { x: 6, y: 4, width: 18, height: 10 }],
  },
};

// ============================================================================
// GAME STATE + CORE LOOP (pure enough to run headless)
// ============================================================================
const CAT_X = 70;                          // fixed x, like the dino
const CAT_W = 16 * CAT_SCALE;
const CAT_H = 14 * CAT_SCALE;

function createGame(canvasWidth, canvasHeight, hiScore) {
  return {
    W: canvasWidth, H: canvasHeight,
    roofY: canvasHeight - 58,              // roof surface y
    cat: { y: 0, vy: 0, jumping: false, dropping: false, reachedMinHeight: false, frame: 0, frameTimer: 0 },
    obstacles: [],
    history: [],                           // recent obstacle types (dupe guard)
    speed: SPEED_START,
    distanceRan: 0,
    score: 0,
    hiScore: hiScore || 0,
    runningTime: 0,
    timeMs: 0,
    started: false,
    crashed: false,
    achievement: false, flashTimer: 0, flashIterations: 0, // dino score flash
    crashBoxPair: null,
  };
}

// dino Runner.onKeyDown -> Trex.startJump: velocity gains with speed (dino:
// initialJumpVelocity - speed/10, negative-up; here positive-up)
function jumpDown(g) {
  if (!g.started) { g.started = true; return; }
  if (g.crashed) { restart(g); return; }
  const cat = g.cat;
  if (!cat.jumping) {
    cat.vy = INITIAL_JUMP_VELOCITY + g.speed / 10;
    cat.jumping = true;
    cat.reachedMinHeight = false;
    cat.dropping = false;
  }
}

// dino Trex.endJump: releasing early clamps upward velocity -> variable height
function jumpUp(g) {
  const cat = g.cat;
  if (cat.jumping && cat.reachedMinHeight && cat.vy > DROP_VELOCITY) {
    cat.vy = DROP_VELOCITY;
  }
}

function diveDown(g, on) {                 // dino speedDrop: ArrowDown mid-air
  if (g.cat.jumping) g.cat.dropping = on;
}

function restart(g) {                      // dino restart(): fresh run, HI kept
  const hi = g.hiScore;
  const fresh = createGame(g.W, g.H, hi);
  Object.assign(g, fresh);
  g.started = true;
}

// dino Trex.updateJump (up-positive y): integrate gravity per elapsed frame
function updateJump(g, deltaTime) {
  const cat = g.cat;
  const fe = deltaTime / MS_PER_FRAME;
  const dy = cat.vy * fe * (cat.dropping ? SPEED_DROP_COEFFICIENT : 1);
  cat.y += dy;
  cat.vy -= GRAVITY * fe;
  if (cat.y >= MIN_JUMP_HEIGHT) cat.reachedMinHeight = true;
  if (cat.y <= 0) {                        // landed
    cat.y = 0; cat.vy = 0; cat.jumping = false; cat.dropping = false;
  }
}

// dino Horizon.addNewObstacle: random type, dupe guard, minSpeed gate,
// cluster size downgraded until speed allows (multipleSpeed)
function addNewObstacle(g) {
  const names = Object.keys(OBSTACLE_TYPES);
  let type = null, name;
  for (let attempts = 0; attempts < 8 && !type; attempts++) {
    name = names[getRandomNum(0, names.length - 1)];
    const candidate = OBSTACLE_TYPES[name];
    if (g.speed < candidate.minSpeed) continue;            // drone gate
    const duplicated = g.history.slice(0, MAX_OBSTACLE_DUPLICATION).includes(name);
    if (!duplicated) type = candidate;
  }
  if (!type) return;                     // nothing eligible this frame; retry next
  let size = getRandomNum(1, type.maxLength);
  if (size > 1 && type.multipleSpeed > g.speed) size = 1;  // dino init() rule
  const width = type.width * size;
  const gap = getGap(width, g.speed, type.minGap, GAP_COEFFICIENT);
  const yOff = type.yOffsets ? type.yOffsets[getRandomNum(0, type.yOffsets.length - 1)] : 0;
  const speedOffset = type.speedOffset && Math.random() > 0.5 ? type.speedOffset : -type.speedOffset;
  g.obstacles.push({
    name, type, size, width, gap,
    x: g.W + 20,
    y: g.roofY - type.height - yOff,       // drones hover, chimneys sit on roof
    speedOffset: speedOffset || 0,
    frame: 0, timer: 0, remove: false,
  });
  g.history.unshift(name);
  g.history.splice(MAX_OBSTACLE_DUPLICATION + 1);
}

// dino Runner.checkForCollision + Obstacle sub-boxes: outer inset AABB first,
// then sub-boxes - grazing pixels don't kill you
function checkForCollision(g, ob) {
  const catTop = g.roofY - CAT_H - g.cat.y;
  const catOuter = { x: CAT_X + 1, y: catTop + 1, width: CAT_W - 2, height: CAT_H - 2 };
  const obOuter = { x: ob.x + 1, y: ob.y + 1, width: ob.width - 2, height: ob.type.height - 2 };
  if (!boxCompare(catOuter, obOuter)) return null;
  const catBoxes = g.cat.jumping ? CAT_BOXES_JUMPING : CAT_BOXES_RUNNING;
  for (const cb of catBoxes) {
    for (const obBox of ob.type.boxes) {
      const a = adjustedBox(cb, catOuter);
      const b = adjustedBox(obBox, obOuter);
      if (boxCompare(a, b)) return [a, b];
    }
  }
  return null;
}

function step(g, deltaTime) {
  if (!g.started || g.crashed) return;
  deltaTime = Math.min(deltaTime, 50);     // tab-switch guard
  const fe = deltaTime / MS_PER_FRAME;
  g.timeMs += deltaTime;
  g.runningTime += deltaTime;

  if (g.cat.jumping) updateJump(g, deltaTime);

  // score + difficulty (dino Runner.update): distance grows with speed,
  // speed accelerates to max
  g.distanceRan += g.speed * fe;
  if (g.speed < MAX_SPEED) g.speed += ACCELERATION * fe;
  const score = getActualDistance(g.distanceRan);
  if (!g.achievement && score > 0 && score % ACHIEVEMENT_DISTANCE === 0 && score !== g.score) {
    g.achievement = true; g.flashTimer = 0; g.flashIterations = 0; // dino: flash + sound
  }
  g.score = score;
  if (g.achievement) {                     // dino flash: 3 iterations x 250ms
    g.flashTimer += deltaTime;
    if (g.flashTimer >= FLASH_DURATION) { g.flashTimer = 0; g.flashIterations++; }
    if (g.flashIterations >= FLASH_ITERATIONS) g.achievement = false;
  }

  // move + recycle obstacles (dino Obstacle.update / Horizon.updateObstacles)
  for (const ob of g.obstacles) {
    ob.x -= Math.floor((g.speed + (ob.speedOffset || 0)) * fe);
    if (ob.type.numFrames) {               // drone wing flap (dino ptero frames)
      ob.timer += deltaTime;
      if (ob.timer >= ob.type.frameRate) { ob.timer = 0; ob.frame = 1 - ob.frame; }
    }
    if (ob.x + ob.width < 0) ob.remove = true;
  }
  g.obstacles = g.obstacles.filter(o => !o.remove);

  // spawn (dino: only after clearTime; next spawns when the last one is
  // fully on screen and its gap has scrolled past the right edge)
  const hasObstacles = g.runningTime > CLEAR_TIME;
  if (hasObstacles) {
    const last = g.obstacles[g.obstacles.length - 1];
    if (!last || (last.x + last.width + last.gap < g.W && last.x + last.width > 0)) {
      addNewObstacle(g);
    }
  }

  // collide (dino: only checks horizon.obstacles[0])
  if (hasObstacles && g.obstacles.length > 0) {
    const hit = checkForCollision(g, g.obstacles[0]);
    if (hit) {
      g.crashed = true;
      g.crashBoxPair = hit;
      if (g.score > g.hiScore) g.hiScore = g.score;
    }
  }

  // run animation frame (only while grounded)
  if (!g.cat.jumping) {
    g.cat.frameTimer += deltaTime;
    if (g.cat.frameTimer >= 100) { g.cat.frameTimer = 0; g.cat.frame = 1 - g.cat.frame; }
  }
}

// ============================================================================
// RENDERING (browser only)
// ============================================================================
if (IS_BROWSER) {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const W = canvas.width, H = canvas.height;
  let g = createGame(W, H, Number(localStorage.getItem('neonRoofHi') || 0));

  // bake cat frames to offscreen canvases; validate art dims while at it
  const sprites = {};
  for (const [name, rows] of Object.entries(CAT_FRAMES)) {
    const w = Math.max(...rows.map(r => r.length));
    const c = document.createElement('canvas');
    c.width = w * CAT_SCALE; c.height = rows.length * CAT_SCALE;
    const cc = c.getContext('2d');
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = CAT_PALETTE[row[x]];
        if (!col) continue;
        cc.fillStyle = col;
        cc.fillRect(x * CAT_SCALE, y * CAT_SCALE, CAT_SCALE, CAT_SCALE);
      }
    });
    sprites[name] = c;
  }

  // --- deterministic scenery -------------------------------------------------
  const rand = mulberry32(20260215);
  const STARS = Array.from({ length: 30 }, () => ({
    x: rand() * W, y: rand() * 165, s: rand() > 0.75 ? 2 : 1,
    phase: rand() * Math.PI * 2, rate: 0.8 + rand() * 1.6,
  }));
  function makeSkyline(seed, count, minH, maxH, minW, maxW, litChance) {
    const r = mulberry32(seed);
    const builds = []; let x = 0;
    for (let i = 0; i < count; i++) {
      const w = minW + Math.floor(r() * (maxW - minW));
      const h = minH + Math.floor(r() * (maxH - minH));
      const cols = Math.max(2, Math.floor(w / 12));
      const rowsN = Math.max(2, Math.floor(h / 14));
      const windows = [];
      for (let wy = 0; wy < rowsN; wy++) for (let wx = 0; wx < cols; wx++) {
        const lit = r() > (1 - litChance);
        windows.push({ wx, wy, lit, warm: r() > 0.3, blink: r() > 0.93, phase: Math.floor(r() * 4) });
      }
      builds.push({ x, w, h, windows, antenna: r() > 0.6 });
      x += w + 4 + Math.floor(r() * 14);
    }
    return { builds, span: x };
  }
  const FAR = makeSkyline(7, 26, 70, 150, 26, 64, 0.18);
  const NEAR = makeSkyline(11, 30, 18, 55, 34, 80, 0);

  // --- juice: particles, streaks, shooting stars ---
  const particles = [];
  function spawnBurst(x, y, n, colors, power, up) {
    for (let i = 0; i < n; i++) {
      const ang = up ? (-Math.PI / 2) + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const sp = power * (0.4 + Math.random() * 0.6);
      particles.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 350 + Math.random() * 400, max: 750,
        size: Math.random() > 0.6 ? 3 : 2, grav: up ? 0.02 : 0.06,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }
  function stepParticles(dt) {
    const fe = dt / MS_PER_FRAME;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * fe; p.y += p.vy * fe; p.vy += p.grav * fe; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life / 250);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  const streaks = Array.from({ length: 14 }, () => ({
    x: Math.random() * W, y: 40 + Math.random() * (g.roofY - 90), len: 30 + Math.random() * 50,
  }));
  function drawSpeedLines(dt) {
    if (g.speed < 8.2 || !g.started || g.crashed) return;
    const fe = dt / MS_PER_FRAME;
    const heat = Math.min(1, (g.speed - 8.2) / 4);   // 0..1 as we approach max speed
    ctx.globalAlpha = 0.06 + 0.12 * heat;
    ctx.fillStyle = '#aeb8ff';
    for (const s of streaks) {
      s.x -= (g.speed * 1.9) * fe;
      if (s.x + s.len < 0) { s.x = W + Math.random() * 80; s.y = 40 + Math.random() * (g.roofY - 90); }
      ctx.fillRect(s.x, s.y, s.len * (0.5 + heat), 1);
    }
    ctx.globalAlpha = 1;
  }

  let shootingStar = null, nextStarAt = 4000 + Math.random() * 6000;
  function stepShootingStar(dt, t) {
    if (!shootingStar && t > nextStarAt && !g.crashed) {
      shootingStar = { x: W * (0.3 + Math.random() * 0.6), y: 20 + Math.random() * 60, life: 700 };
      nextStarAt = t + 7000 + Math.random() * 9000;
    }
    if (shootingStar) {
      const fe = dt / MS_PER_FRAME;
      shootingStar.x -= 7 * fe; shootingStar.y += 2.4 * fe; shootingStar.life -= dt;
      ctx.globalAlpha = Math.min(1, shootingStar.life / 300);
      ctx.fillStyle = '#eef1ff';
      ctx.fillRect(shootingStar.x, shootingStar.y, 4, 2);
      ctx.globalAlpha *= 0.5;
      ctx.fillRect(shootingStar.x + 4, shootingStar.y - 2, 8, 1);
      ctx.fillRect(shootingStar.x + 4, shootingStar.y + 2, 6, 1);
      ctx.globalAlpha = 1;
      if (shootingStar.life <= 0 || shootingStar.x < -20) shootingStar = null;
    }
  }

  function drawSkyline(layer, scroll, baseY, bodyColor, winOn, winOff) {
    const off = scroll % layer.span;
    for (let rep = -1; rep <= Math.ceil(W / layer.span); rep++) {
      for (const b of layer.builds) {
        const x = b.x - off + rep * layer.span;
        if (x > W || x + b.w < 0) continue;
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x, baseY - b.h, b.w, b.h);
        if (b.antenna) {
          ctx.fillRect(x + Math.floor(b.w / 2), baseY - b.h - 10, 2, 10);
          ctx.fillStyle = (Math.floor(performance.now() / 600) % 2) ? '#ff5566' : '#551122';
          ctx.fillRect(x + Math.floor(b.w / 2), baseY - b.h - 12, 2, 2);
          ctx.fillStyle = bodyColor;
        }
        for (const win of b.windows) {
          const wx = x + 4 + win.wx * 12, wy = baseY - b.h + 6 + win.wy * 14;
          if (wx + 6 > x + b.w) continue;
          const blinkOff = win.blink && (Math.floor(performance.now() / 900 + win.phase) % 3 === 0);
          ctx.fillStyle = win.lit && !blinkOff ? winOn : winOff;
          ctx.fillRect(wx, wy, 6, 8);
        }
      }
    }
  }

  function drawBackground(t, dt) {
    const th = themeColors(g.distanceRan);
    // sky gradient, slowly evolving with distance
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, cssRgb(th.top));
    grad.addColorStop(0.7, cssRgb(th.mid));
    grad.addColorStop(1, cssRgb(th.bot));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // stars (twinkle)
    for (const s of STARS) {
      ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(t / 1000 * s.rate + s.phase));
      ctx.fillStyle = '#e8ecff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    stepShootingStar(dt, t);
    // crescent moon with soft glow
    ctx.save();
    ctx.shadowColor = '#cfd4ff'; ctx.shadowBlur = 24;
    ctx.fillStyle = '#ece9ff';
    ctx.beginPath(); ctx.arc(W - 160, 54, 17, 0, 7); ctx.fill();
    ctx.restore();
    ctx.fillStyle = cssRgb(th.top);
    ctx.beginPath(); ctx.arc(W - 152, 48, 15, 0, 7); ctx.fill();
    // skylines (parallax), tinted by the current phase
    drawSkyline(FAR, g.distanceRan * 0.15, g.roofY + 6, cssRgb(th.far), '#a8823f', '#141632');
    drawSkyline(NEAR, g.distanceRan * 0.4, g.roofY + 4, cssRgb(th.near), '#2a2f55', '#0c0e22');
  }

  function drawRoof() {
    const y = g.roofY;
    ctx.fillStyle = '#14162b';
    ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = '#4a517f';             // lit roof edge
    ctx.fillRect(0, y, W, 2);
    const off = Math.floor(g.distanceRan) % 44;
    ctx.fillStyle = '#232550';
    for (let x = -off; x < W; x += 44) {   // scrolling roof seams
      ctx.fillRect(x, y + 8, 2, H - y - 8);
      ctx.fillRect(x + 20, y + 20, 6, 2);  // rivet detail
    }
  }

  function drawChimney(ob) {
    const t = ob.type, x = ob.x, y = ob.y;
    for (let i = 0; i < ob.size; i++) {
      const cx = x + i * t.width;
      // shaft with brick seams
      ctx.fillStyle = '#434a78';
      ctx.fillRect(cx + 2, y + 7, t.width - 4, t.height - 7);
      ctx.fillStyle = '#2b2f50';
      for (let by = y + 12; by < y + t.height; by += 8) ctx.fillRect(cx + 2, by, t.width - 4, 1);
      // pot rim (glowing warm edge)
      ctx.fillStyle = '#4d5480';
      ctx.fillRect(cx, y, t.width, 7);
      ctx.fillStyle = '#ff8f5e';
      ctx.fillRect(cx, y, t.width, 2);
    }
  }

  function drawDrone(ob, t) {
    const x = ob.x, y = ob.y;
    ctx.fillStyle = '#4a5382';
    ctx.fillRect(x + 6, y + 4, 18, 10);            // body
    ctx.save();
    ctx.shadowColor = '#7ef0ff'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#7ef0ff';
    ctx.fillRect(x + 10, y + 7, 6, 4);             // lens
    ctx.restore();
    ctx.fillStyle = '#ff5566';                     // tail beacon (blinks)
    if (Math.floor(g.timeMs / 300) % 2) ctx.fillRect(x + 26, y + 8, 3, 3);
    ctx.fillStyle = '#cdd3ff';                     // rotor, 2 frames
    if (ob.frame === 0) { ctx.fillRect(x + 2, y, 26, 2); }
    else { ctx.fillRect(x + 4, y, 6, 2); ctx.fillRect(x + 20, y, 6, 2); }
    ctx.fillStyle = '#3d4470';
    ctx.fillRect(x + 8, y + 2, 2, 3); ctx.fillRect(x + 20, y + 2, 2, 3);
  }

  function drawDish(ob) {                 // rooftop satellite dish
    const x = ob.x, y = ob.y;
    ctx.fillStyle = '#434a78';            // dome (stacked rects)
    ctx.fillRect(x + 2, y + 8, 18, 4);
    ctx.fillRect(x + 4, y + 4, 14, 4);
    ctx.fillRect(x + 7, y + 1, 8, 3);
    ctx.save();
    ctx.shadowColor = '#7ef0ff'; ctx.shadowBlur = 10;
    ctx.fillStyle = Math.floor(g.timeMs / 500) % 2 ? '#7ef0ff' : '#2a4a66';
    ctx.fillRect(x + 11, y, 3, 3);        // blinking feed horn
    ctx.restore();
    ctx.fillStyle = '#4a5382';            // stalk + base
    ctx.fillRect(x + 9, y + 12, 4, 18);
    ctx.fillStyle = '#3a4066';
    ctx.fillRect(x + 5, y + 26, 12, 4);
  }

  function drawAC(ob) {                   // wide low AC unit
    const x = ob.x, y = ob.y;
    ctx.fillStyle = '#434a78';            // case
    ctx.fillRect(x, y + 2, 34, 14);
    ctx.fillStyle = '#3a4066';            // top vent + feet
    ctx.fillRect(x, y + 2, 34, 3);
    ctx.fillRect(x + 2, y + 16, 4, 2);
    ctx.fillRect(x + 28, y + 16, 4, 2);
    ctx.fillStyle = '#232550';            // fan well + grill slats
    ctx.fillRect(x + 5, y + 6, 11, 8);
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 20, y + 6 + i * 4, 11, 2);
    ctx.save();
    ctx.shadowColor = '#7ef0ff'; ctx.shadowBlur = 9;
    ctx.fillStyle = Math.floor(g.timeMs / 400) % 2 ? '#7ef0ff' : '#3d5a70';
    ctx.fillRect(x + 9, y + 9, 3, 3);     // compressor light
    ctx.restore();
  }

  // squash and stretch state (render-side juice)
  let stretchUntil = 0, squashUntil = 0;
  function drawCat() {
    let name = 'run1';
    if (g.crashed) name = 'crash';
    else if (g.cat.jumping) name = g.cat.vy > 0 ? 'jump' : 'fall';
    else name = g.cat.frame ? 'run2' : 'run1';
    // stretch on takeoff, squash on landing, easing back to 1
    let sx = 1, sy = 1;
    if (g.timeMs < stretchUntil) { const k = (stretchUntil - g.timeMs) / 130; sy = 1 + 0.16 * k; sx = 1 - 0.10 * k; }
    else if (g.timeMs < squashUntil) { const k = (squashUntil - g.timeMs) / 130; sy = 1 - 0.20 * k; sx = 1 + 0.18 * k; }
    const sw = CAT_W * sx, sh = CAT_H * sy;
    ctx.drawImage(sprites[name], CAT_X - (sw - CAT_W) / 2, g.roofY - sh - g.cat.y, sw, sh);
  }

  function drawHUD() {
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#cdd3ff';
    const pad = (n) => String(n).padStart(5, '0');
    if (g.hiScore > 0) {
      ctx.fillStyle = '#8b93c9';
      ctx.fillText('HI ' + pad(g.hiScore), W - 110, 30);
    }
    const flashOff = g.achievement && Math.floor(g.flashTimer / (FLASH_DURATION / 2)) % 2 === 1;
    if (!flashOff) {
      ctx.fillStyle = '#eef1ff';
      ctx.fillText(pad(g.score), W - 20, 30);
    }
    ctx.textAlign = 'left';
    if (!g.started) {
      ctx.fillStyle = '#eef1ff';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.fillText('NEON ROOFTOPS', 60, 96);
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = '#8b93c9';
      if (Math.floor(performance.now() / 600) % 2) ctx.fillText('PRESS SPACE / TAP TO RUN', 60, 124);
    } else if (g.crashed) {
      ctx.fillStyle = '#ff8fb0';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.fillText('GAME OVER', 60, 96);
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = '#8b93c9';
      if (Math.floor(performance.now() / 600) % 2) ctx.fillText('SPACE / ENTER / TAP TO RETRY', 60, 124);
    }
  }

  // --- input ---
  addEventListener('keydown', e => {
    if (JUMP_KEYS.includes(e.keyCode)) { e.preventDefault(); jumpDown(g); }
    else if (e.keyCode === DUCK_KEY) { e.preventDefault(); diveDown(g, true); }
    else if (e.keyCode === 13 && g.crashed) restart(g);
  });
  addEventListener('keyup', e => {
    if (JUMP_KEYS.includes(e.keyCode)) jumpUp(g);
    else if (e.keyCode === DUCK_KEY) diveDown(g, false);
  });
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); jumpDown(g); });
  addEventListener('pointerup', () => jumpUp(g));

  // --- main loop (dino: requestAnimationFrame-driven update) ---
  let last = performance.now();
  let prevHi = g.hiScore;
  let prevJumping = false, prevCrashed = false, prevAchievement = false;
  let shakeUntil = 0, crashFlashUntil = 0, nextRunDust = 0;
  function frame(now) {
    const dt = now - last; last = now;
    step(g, dt);

    // juice transitions
    if (!prevJumping && g.cat.jumping) stretchUntil = g.timeMs + 130;           // takeoff: stretch
    if (prevJumping && !g.cat.jumping && !g.crashed) {                         // landing: squash + dust
      squashUntil = g.timeMs + 130;
      spawnBurst(CAT_X + CAT_W / 2, g.roofY - 2, 8, ['#8b93c9', '#565e8c', '#cdd3ff'], 1.6, true);
    }
    if (!g.started || (!g.cat.jumping && !g.crashed)) {                        // lazy running dust
      if (now > nextRunDust) {
        nextRunDust = now + 170 + Math.random() * 160;
        spawnBurst(CAT_X + 2, g.roofY - 2, 1, ['#565e8c'], 0.8, true);
      }
    }
    if (!prevAchievement && g.achievement) {                                   // milestone burst
      spawnBurst(W - 70, 34, 18, ['#7ef0ff', '#ff8fb0', '#ffe9c4', '#5df08a'], 2.6, false);
    }
    if (!prevCrashed && g.crashed) {                                           // crash: shake + flash + burst
      shakeUntil = now + 350;
      crashFlashUntil = now + 420;
      spawnBurst(CAT_X + CAT_W / 2, g.roofY - CAT_H / 2, 26,
        ['#f39b3f', '#ff8fb0', '#ffe9c4', '#f39b3f'], 3, false);
    }
    prevJumping = g.cat.jumping; prevCrashed = g.crashed; prevAchievement = g.achievement;
    stepParticles(dt);

    // draw, with a decaying screen shake while the crash flash lasts
    ctx.save();
    if (now < shakeUntil) {
      const k = (shakeUntil - now) / 350;
      ctx.translate((Math.random() - 0.5) * 10 * k, (Math.random() - 0.5) * 8 * k);
    }
    drawBackground(now, dt);
    drawSpeedLines(dt);
    drawRoof();
    const DRAW = { chimneySmall: drawChimney, chimneyLarge: drawChimney, dish: drawDish, ac: drawAC, drone: drawDrone };
    for (const ob of g.obstacles) DRAW[ob.name](ob);
    drawCat();
    drawParticles();
    drawHUD();
    if (now < crashFlashUntil) {                // red flash vignette on crash
      ctx.fillStyle = 'rgba(255, 90, 130, ' + (0.28 * (crashFlashUntil - now) / 420) + ')';
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }
    ctx.restore();
    if (g.hiScore !== prevHi) { localStorage.setItem('neonRoofHi', g.hiScore); prevHi = g.hiScore; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ============================================================================
// SELF-TEST (node game/game.js) - every mechanic ported from dino gets a check
// ============================================================================
if (!IS_BROWSER) {
  const assert = require('assert');

  // 1. collision boxes (dino boxCompare semantics: touching edges is NOT a hit)
  const A = { x: 0, y: 0, width: 10, height: 10 };
  assert.strictEqual(boxCompare(A, { x: 10, y: 0, width: 10, height: 10 }), false, 'edge touch must not collide');
  assert.strictEqual(boxCompare(A, { x: 9, y: 9, width: 10, height: 10 }), true, 'overlap must collide');
  assert.strictEqual(boxCompare(A, { x: 20, y: 20, width: 5, height: 5 }), false);
  assert.deepStrictEqual(adjustedBox({ x: 1, y: 2, width: 3, height: 4 }, { x: 10, y: 20 }),
    { x: 11, y: 22, width: 3, height: 4 });

  // 2. gap formula grows with speed (dino getGap)
  const g1 = getGap(20, 6, 120, GAP_COEFFICIENT);
  const g2 = getGap(20, 12, 120, GAP_COEFFICIENT);
  assert.ok(g2 > g1, 'faster game must produce wider gaps');
  assert.strictEqual(getGap(20, 6, 120, GAP_COEFFICIENT) >= Math.round(20 * 6 + 120 * 0.6), true);

  // 3. score conversion (dino COEFFICIENT 0.025)
  assert.strictEqual(getActualDistance(4000), 100);
  assert.strictEqual(getActualDistance(0), 0);

  // 4. jump physics: held key goes higher than early release (variable jump)
  function simJump(releaseAtMs) {
    const g = createGame(900, 300, 0); g.started = true;
    jumpDown(g);
    let apex = 0, t = 0;
    while (t < 2000) {
      step(g, MS_PER_FRAME); t += MS_PER_FRAME;
      if (releaseAtMs !== null && t >= releaseAtMs) { jumpUp(g); releaseAtMs = null; }
      apex = Math.max(apex, g.cat.y);
      if (!g.cat.jumping) break;
    }
    return { apex, landed: !g.cat.jumping && g.cat.y === 0 };
  }
  const held = simJump(null);
  const early = simJump(120);
  assert.ok(held.apex > early.apex && early.apex > 0, `variable jump: held=${held.apex} early=${early.apex}`);
  assert.ok(held.landed && early.landed, 'cat must land in both cases');
  assert.ok(held.apex < 120, 'apex bounded');

  // 5. dive descends faster than normal fall (used like a player: at descent)
  function simFall(dive) {
    const g = createGame(900, 300, 0); g.started = true;
    jumpDown(g);
    let t = 0; while (t < 2000 && g.cat.jumping) { step(g, MS_PER_FRAME); t += MS_PER_FRAME; if (dive && g.cat.vy < 0) diveDown(g, true); }
    return t;
  }
  assert.ok(simFall(true) < simFall(false), 'dive must land sooner');

  // 6. difficulty: speed accelerates to MAX_SPEED and stops; score grows
  {
    const g = createGame(900, 300, 0); g.started = true;
    for (let i = 0; i < 60 * 130; i++) { g.runningTime = 0; step(g, MS_PER_FRAME); } // 130 s, no obstacles
    assert.ok(Math.abs(g.speed - MAX_SPEED) < 0.01, `speed caps at ${MAX_SPEED}, got ${g.speed}`);
    assert.ok(g.score > 0, 'score must grow while running');
  }

  // 7. spawn invariant: obstacles appear after clearTime, spawn at the right
  //    edge, and never overlap each other
  {
    const g = createGame(900, 300, 0); g.started = true;
    let prevCount = 0, sawSpawn = false, maxCoexisting = 0;
    for (let i = 0; i < 60 * 60; i++) {     // 60 s of frames
      step(g, MS_PER_FRAME);
      if (g.obstacles.length > prevCount) { // a fresh spawn happened
        const last = g.obstacles[g.obstacles.length - 1];
        assert.strictEqual(last.x, g.W + 20, 'new obstacle must spawn at right edge');
        sawSpawn = true;
      }
      prevCount = g.obstacles.length;
      for (let i2 = 1; i2 < g.obstacles.length; i2++) {
        const left = g.obstacles[i2 - 1], right = g.obstacles[i2]; // [0] is oldest/leftmost (dino checks obstacles[0])
        assert.ok(right.x >= left.x + left.width, 'obstacles must never overlap');
      }
      maxCoexisting = Math.max(maxCoexisting, g.obstacles.length);
      if (g.crashed) break;                // physics freeze; invariants hold trivially
    }
    assert.ok(sawSpawn, 'obstacles must spawn during the run');
    assert.ok(g.runningTime > CLEAR_TIME || g.crashed);
  }

  // 8. collision + game over + restart (HI retained, run reset)
  {
    const g = createGame(900, 300, 0); g.started = true;
    g.runningTime = CLEAR_TIME + 1;
    g.obstacles.push({ name: 'chimneySmall', type: OBSTACLE_TYPES.chimneySmall, size: 1,
      width: OBSTACLE_TYPES.chimneySmall.width, gap: 200, x: CAT_X, y: g.roofY - 26,
      speedOffset: 0, frame: 0, timer: 0, remove: false });
    assert.strictEqual(g.crashed, false);
    step(g, MS_PER_FRAME);
    assert.strictEqual(g.crashed, true, 'overlapping obstacle must crash');
    assert.ok(g.hiScore >= 0);
    g.hiScore = 42;                       // simulate a previous best
    step(g, MS_PER_FRAME);                  // frozen while crashed
    restart(g);
    assert.strictEqual(g.crashed, false);
    assert.strictEqual(g.obstacles.length, 0);
    assert.strictEqual(g.distanceRan, 0);
    assert.strictEqual(g.speed, SPEED_START);
    assert.strictEqual(g.hiScore, 42, 'HI score survives restart');
    assert.strictEqual(g.started, true, 'restart puts us straight into the run');
  }

  // 9. variety: at speed 6 several ground types appear and the drone never
  //    does; at speed 8 the drone is reachable
  {
    const g = createGame(900, 300, 0); g.started = true; g.speed = 6; g.history = [];
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const before = g.obstacles.length;
      g.history = [];                     // don't let the dupe guard mask variety
      addNewObstacle(g);
      if (g.obstacles.length > before) seen.add(g.obstacles[g.obstacles.length - 1].name);
    }
    assert.ok(!seen.has('drone'), 'drone must not spawn below minSpeed 7.2');
    assert.ok(seen.size >= 4, `early game must offer >=4 hurdle types, saw ${[...seen].join(',')}`);
    const g8 = createGame(900, 300, 0); g8.started = true; g8.speed = 8; g8.history = [];
    let drone = false;
    for (let i = 0; i < 500 && !drone; i++) {
      g8.history = [];
      const before = g8.obstacles.length;
      addNewObstacle(g8);
      if (g8.obstacles.length > before && g8.obstacles[before].name === 'drone') drone = true;
    }
    assert.ok(drone, 'drone must be able to spawn at speed 8');
  }

  // 10. the night palette must visibly evolve and cycle
  {
    const dRGB = (x, y) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
    const night = themeColors(0), dusk = themeColors(2250), dawn = themeColors(4100);
    assert.ok(dRGB(night.top, dusk.top) > 15, 'night and dusk skies must differ');
    assert.ok(dRGB(dusk.top, dawn.top) > 15, 'dusk and dawn skies must differ');
    assert.ok(dRGB(night.near, dawn.near) > 10, 'skyline tint must shift with the sky');
    assert.deepStrictEqual(themeColors(9000).top, themeColors(0).top, 'palette must wrap cleanly');
  }

  console.log('self-test OK (10 groups)');
}
