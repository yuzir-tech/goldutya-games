/* Egg Jump — one-tap basket landing. Extracted Gametion sprites, original code. */

"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const shareBtn = document.getElementById("shareBtn");
const bestEl = document.getElementById("best");
const muteBtn = document.getElementById("muteBtn");
const overlayTitle = document.getElementById("overlayTitle");
const overlaySub = document.getElementById("overlaySub");
const overlayScore = document.getElementById("overlayScore");
const finalScore = document.getElementById("finalScore");
const lbContainer = document.getElementById("leaderboard");

const BEST_KEY = "goldutya-eggjump-best";
const MUTE_KEY = "goldutya-eggjump-muted";
const LIVES_MAX = 3;

let W = 390;
let H = 844;
let DPR = 1;
let IS_MOBILE = false;

/* ---------------- enhanced FX state ---------------- */
let displayScore = 0;          // animated score counter
let slowMoT = 0;               // slow-motion frames remaining
let slowMoFactor = 1;          // current time-scale
let bgFireflies = [];          // ambient background particles
let eggTrail = [];             // motion trail behind egg
let countdownT = 0;            // pre-game countdown
let countdownNum = 0;
let landFlashT = 0;            // screen flash on perfect land
let cameraTargetY = 0;
let cameraSmooth = 0;
let totalJumps = 0;            // stats for game-over
let totalLands = 0;
let perfectLands = 0;
let comboBarT = 0;             // combo bar animation timer
let newBestFlash = 0;          // flash when new best is set during play

/* ---------------- assets ---------------- */

function img(src) {
  const i = new Image();
  i.src = src;
  return i;
}

const IM = {
  bg: img("assets/eggjump/bg.webp"),
  egg: img("assets/eggjump/egg.webp"),
  basket: img("assets/eggjump/basket.webp"),
  menuEgg: img("assets/eggjump/menu-egg.webp"),
  wing: img("assets/eggjump/scorewing.webp"),
  hand: img("assets/eggjump/hand.webp"),
  ring: img("assets/eggjump/ring.webp"),
  glow: img("assets/eggjump/glow.webp"),
};

/* ---------------- audio ---------------- */

let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch (e) {}
let audioReady = false;

const SND = {};
["jump", "land", "fall", "nest", "bg"].forEach((n) => {
  const a = new Audio("assets/eggjump/audio/" + n + ".m4a");
  a.preload = "auto";
  if (n === "bg") {
    a.loop = true;
    a.volume = 0.32;
  }
  SND[n] = a;
});

function initAudio() {
  if (audioReady) return;
  audioReady = true;
  if (!muted) SND.bg.play().catch(() => {});
}

function play(name) {
  if (muted) return;
  const s = SND[name];
  if (!s) return;
  if (name !== "bg") s.currentTime = 0;
  s.play().catch(() => {});
}

function setMuted(v) {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch (e) {}
  if (muted) {
    SND.bg.pause();
  } else if (state === "play" || state === "menu") {
    SND.bg.play().catch(() => {});
  }
  if (muteBtn) {
    muteBtn.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#' +
      (muted ? "volume-off" : "volume-on") +
      '"/></svg>';
  }
}

if (muteBtn)
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    initAudio();
    setMuted(!muted);
  });

function haptic(kind) {
  if (typeof TG !== "undefined" && TG.haptic) TG.haptic(kind);
}

/* ---------------- layout ---------------- */

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  const LOW_END =
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  DPR = Math.min(LOW_END ? 1.5 : 2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * DPR);
  canvas.height = Math.round(cssH * DPR);
  W = cssW;
  H = cssH;
  IS_MOBILE =
    (typeof TG !== "undefined" && TG.platform && ["android", "ios"].includes(TG.platform)) ||
    "ontouchstart" in window ||
    (navigator.maxTouchPoints || 0) > 0 ||
    W < 600;
}

window.addEventListener("resize", () => {
  fitCanvas();
  layoutMetrics();
  renderedPause = false;
});
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    fitCanvas();
    layoutMetrics();
    renderedPause = false;
  }).observe(canvas);
}

/* ---------------- difficulty ---------------- */

function diffMult() {
  const d = typeof Difficulty !== "undefined" ? Difficulty.getDiff("eggjump") : "medium";
  return d === "easy" ? 0.8 : d === "hard" ? 1.25 : 1.0;
}

/* ---------------- world ---------------- */

let state = "menu"; // menu | play | paused | gameover
let paused = false;

let baskets = []; // {idx, x, y, w, h, move:{cx, amp, phase, speed}}
let egg = null; // {x, y, vy, phase:'rest'|'fly', squash}
let camY = 0;
let lives = LIVES_MAX;
let score = 0;
let best = 0;
let bestSaved = 0;
try {
  best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestSaved = best;
} catch (e) {}
let lastScoredIdx = 0;
let lastBasket = null;
let topIdx = 0;
let combo = 0;
let maxCombo = 0;
let shakeT = 0;
let lifeFlash = 0;
let hintT = 0;
let floaters = []; // {x, y, text, color, life, vy, fontSize}
let particles = []; // {x, y, vx, vy, life, color, size, rot, vr}
let rings = [];
let deadT = 0; // respawn timer after life lost
let lostThisFall = false;
let scorePopScale = 0; // pop animation for HUD score

const BASKET_AR = 512 / 264;
const EGG_AR = 256 / 324;

let BW = 150; // basket width
let BH = BW / BASKET_AR;
let EW = 44;
let EH = EW / EGG_AR;
let G = 1;
let V0 = 1;

function layoutMetrics() {
  BW = Math.max(120, Math.min(W * 0.40, 190));
  BH = BW / BASKET_AR;
  EW = Math.max(34, BW * 0.29);
  EH = EW / EGG_AR;
  G = H * 0.00135;
}

function gapFor() {
  return Math.min(H * 0.205 + score * 2.6, H * 0.29);
}

function zoneScale() {
  const d = typeof Difficulty !== "undefined" ? Difficulty.getDiff("eggjump") : "medium";
  return d === "easy" ? 1.5 : d === "hard" ? 0.85 : 1.0;
}

function cleanZone(b) {
  return b.w * 0.16 * zoneScale();
}

function edgeZone(b) {
  return b.w * 0.40 * zoneScale();
}

function restY(b) {
  return b.y + b.h * 0.15;
}

function screenY(wy) {
  return H * 0.75 - wy + camY;
}

function resetWorld() {
  baskets = [];
  floaters = [];
  particles = [];
  rings = [];
  eggTrail = [];
  camY = 0;
  cameraTargetY = 0;
  cameraSmooth = 0;
  lives = LIVES_MAX;
  score = 0;
  displayScore = 0;
  lastScoredIdx = 0;
  combo = 0;
  maxCombo = 0;
  shakeT = 0;
  lifeFlash = 0;
  deadT = 0;
  lostThisFall = false;
  hintT = 0;
  slowMoT = 0;
  slowMoFactor = 1;
  landFlashT = 0;
  totalJumps = 0;
  totalLands = 0;
  perfectLands = 0;
  comboBarT = 0;
  scorePopScale = 0;
  newBestFlash = 0;

  initFireflies();

  const start = makeBasket(0, W / 2, 0, false, 0);
  baskets.push(start);
  topIdx = 0;
  lastBasket = start;
  egg = { x: W / 2, y: restY(start), vy: 0, phase: "rest", squash: 0 };
  spawnAhead();
}

function initFireflies() {
  bgFireflies = [];
  const count = Math.max(12, Math.round(W * H / 8000));
  for (let i = 0; i < count; i++) {
    bgFireflies.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.15,
      phase: Math.random() * Math.PI * 2,
      speed: 0.012 + Math.random() * 0.02,
      size: 1.2 + Math.random() * 2.5,
      color: Math.random() < 0.5 ? "rgba(245,197,24," : "rgba(86,217,255,",
    });
  }
}

function makeBasket(idx, x, y, moving, lvl) {
  const b = {
    idx: idx,
    x: x,
    y: y,
    w: BW,
    h: BH,
    move: null,
  };
  if (moving) {
    const margin = b.w * 0.5 + 14;
    const cx = Math.max(margin, Math.min(W - margin, x));
    const amp = Math.min(W * 0.13 + lvl * 2.5, W * 0.22) * (0.75 + Math.random() * 0.4);
    b.move = {
      cx: cx,
      amp: Math.min(amp, cx - margin, W - margin - cx) || 0,
      phase: Math.random() * Math.PI * 2,
      speed: (0.017 + lvl * 0.0009) * (0.85 + Math.random() * 0.3),
    };
    if (b.move.amp < 12) b.move = null;
  }
  return b;
}

function spawnAhead() {
  const limit = camY + H * 1.6;
  while (baskets[baskets.length - 1].y < limit) {
    const prev = baskets[baskets.length - 1];
    const idx = prev.idx + 1;
    const gap = gapFor();
    const y = prev.y + gap;

    const tol = prev.w * 0.3 - EW * 0.5 - 4; // moving-bowl spawn spread
    const lvl = idx;
    let moving = false;
    if (idx >= 2) {
      const p = idx < 7 ? 0.5 : 0.7;
      moving = Math.random() < p;
    }

    let b;
    if (!moving) {
      const off = (Math.random() * 2 - 1) * BW * 0.14; // inside clean zone
      b = makeBasket(idx, clamp(prev.x + off, BW * 0.5 + 14, W - BW * 0.5 - 14), y, false, lvl);
    } else {
      const off = (Math.random() * 2 - 1) * Math.max(0, tol * 1.6);
      b = makeBasket(idx, clamp(prev.x + off, BW * 0.5 + 14, W - BW * 0.5 - 14), y, true, lvl);
    }
    baskets.push(b);
    topIdx = idx;
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/* ---------------- particles / fx ---------------- */

const CONFETTI_COLORS = ["#ff2d55", "#ff00d4", "#38b6ff", "#22c55e", "#00e5ff", "#8b5cf6", "#ff9500", "#a3e635", "#facc15"];

function spawnSparkles(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 1,
      life: 30 + Math.random() * 18,
      color: color || "#fff7c2",
      size: 2 + Math.random() * 3.5,
      rot: 0,
      vr: 0,
      grav: 0.08,
    });
  }
}

function spawnConfetti(x, y, n) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + (Math.random() * 2 - 1) * 60,
      y: y,
      vx: (Math.random() * 2 - 1) * 3.2,
      vy: 2 + Math.random() * 4,
      life: 60 + Math.random() * 40,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() * 2 - 1) * 0.3,
      grav: 0.14,
    });
  }
}

function spawnLandBurst(x, y, n, color) {
  // radial burst that fans upward on landing
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
    const sp = 2 + Math.random() * 3.5;
    particles.push({
      x: x + (Math.random() - 0.5) * 20,
      y: y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * -1,
      life: 25 + Math.random() * 15,
      color: color,
      size: 1.5 + Math.random() * 2.5,
      rot: 0,
      vr: 0,
      grav: 0.06,
    });
  }
}

function addFloater(x, y, text, color, fontSize) {
  floaters.push({ x: x, y: y, text: text, color: color || "#fff", life: 55, vy: 0.9, fontSize: fontSize || 22 });
}

/* ---------------- game flow ---------------- */

function startGame() {
  initAudio();
  resetWorld();
  state = "play";
  paused = false;
  hintT = 1000000; // until first jump
  countdownT = 150; // ~2.5 seconds countdown (3, 2, 1, GO!)
  countdownNum = 3;
  overlayTitle.textContent = "EGG JUMP";
  overlay.classList.add("hidden");
  if (!muted) SND.bg.play().catch(() => {});
  haptic("light");
}

function jump() {
  if (state !== "play" || paused || !egg || egg.phase !== "rest" || deadT > 0 || countdownT > 0) return;
  // impulse measured against the ACTUAL next bowl geometry (precise height)
  const target = baskets.find((b) => b.y > lastBasket.y + lastBasket.h);
  const top = target ? target.y + target.h / 2 : lastBasket.y + gapFor();
  const dist = top - egg.y + EH * 0.3;
  V0 = Math.sqrt(2 * G * Math.max(dist, H * 0.1));
  egg.vy = V0;
  egg.phase = "fly";
  egg.tipped = false;
  egg.squash = 0;
  totalJumps++;
  play("jump");
  haptic("light");
  hintT = 0;
}

function loseLife() {
  lives--;
  play("fall");
  haptic("heavy");
  shakeT = 18;
  lifeFlash = 30;
  combo = 0;
  if (lives <= 0) {
    gameOver();
  } else {
    addFloater(W / 2, camY + H * 0.35, "LIFE LOST", "#ff5d7a");
    deadT = 45;
  }
}

function respawn() {
  if (!baskets.includes(lastBasket)) lastBasket = baskets[0];
  egg.x = lastBasket.x;
  egg.y = restY(lastBasket) + H * 0.18;
  egg.vy = -2.2;
  egg.phase = "fly"; // drop-in
  egg.dropping = true;
  egg.tipped = false;
  egg.perchB = null;
}

function gameOver() {
  state = "gameover";
  SND.bg.pause();
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch (e) {}
  bestEl.textContent = best;
  try {
    Leaderboard.addScore("eggjump", score, { combo: maxCombo });
  } catch (e) {}
  // delayed reveal for drama
  setTimeout(() => showGameOver(), 600);
  bestSaved = best;
}

function showGameOver() {
  overlayTitle.textContent = "GAME OVER";
  const isNewBest = score > bestSaved && score > 0;
  overlaySub.textContent = isNewBest
    ? "🏆 NEW BEST! The nests respect you."
    : "The egg broke. Shake it off.";
  overlayScore.hidden = false;
  finalScore.textContent = score;
  startBtn.textContent = "PLAY AGAIN";
  shareBtn.style.display = score > 0 ? "" : "none";

  // build stats line
  let statsEl = document.getElementById("goStats");
  if (!statsEl) {
    statsEl = document.createElement("p");
    statsEl.id = "goStats";
    statsEl.className = "overlay-sub";
    statsEl.style.marginTop = "2px";
    overlayScore.parentNode.insertBefore(statsEl, overlayScore.nextSibling);
  }
  const accuracy = totalJumps > 0 ? Math.round((totalLands / totalJumps) * 100) : 0;
  statsEl.innerHTML =
    '<span style="color:var(--cyan)">MAX COMBO ' + maxCombo + '</span> · ' +
    '<span style="color:var(--gold)">ACCURACY ' + accuracy + '%</span>' +
    (perfectLands > 0 ? ' · <span style="color:#ffe98a">PERFECTS ' + perfectLands + '</span>' : '');
  statsEl.hidden = false;

  if (lbContainer) {
    try {
      Leaderboard.renderBoard(lbContainer, "eggjump", score);
    } catch (e) {}
  }
  overlay.classList.remove("hidden");
}

function showMenu() {
  state = "menu";
  overlayTitle.textContent = "EGG JUMP";
  overlaySub.textContent =
    "Tap once. Time the jump. Land the egg in the next basket and climb as high as you can.";
  overlayScore.hidden = true;
  const statsEl = document.getElementById("goStats");
  if (statsEl) statsEl.hidden = true;
  startBtn.textContent = "START";
  shareBtn.style.display = "none";
  overlay.classList.remove("hidden");
}

/* ---------------- input ---------------- */

function onPointer(e) {
  if (e.target && e.target.closest && e.target.closest("a, button, .overlay, .topbar")) return;
  initAudio();
  if (state === "play") {
    if (paused) {
      paused = false;
      if (!muted) SND.bg.play().catch(() => {});
      return;
    }
    jump();
  }
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  onPointer(e);
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    if (state === "play") {
      e.preventDefault();
      if (e.repeat) return;
      initAudio();
      if (paused) {
        paused = false;
        if (!muted) SND.bg.play().catch(() => {});
      } else jump();
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (state === "play") paused = true;
    SND.bg.pause();
  } else if (state === "play" && !paused && !muted) {
    SND.bg.play().catch(() => {});
  }
});

startBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  startGame();
});

function shareScore() {
  const accuracy = totalJumps > 0 ? Math.round((totalLands / totalJumps) * 100) : 0;
  let text = "🥚 I scored " + score + " in Egg Jump!";
  if (maxCombo > 1) text += " (x" + maxCombo + " combo streak)";
  if (accuracy >= 80) text += " 🎯 " + accuracy + "% accuracy";
  text += " Can you land higher?";
  const url = location.href.split("#")[0];
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text + " " + url).then(() => {
      shareBtn.textContent = "COPIED!";
      setTimeout(() => {
        shareBtn.textContent = "SHARE SCORE";
      }, 2000);
    });
  }
}

if (shareBtn) shareBtn.addEventListener("click", (e) => { e.stopPropagation(); shareScore(); });

/* ---------------- update ---------------- */

function update(dt) {
  let f = Math.min(2.5, dt / 16.6667);

  // slow-motion effect
  if (slowMoT > 0) {
    slowMoT -= 1;
    slowMoFactor = 0.25 + 0.75 * (1 - slowMoT / 18);
  } else {
    slowMoFactor = 1;
  }
  const gf = f * slowMoFactor; // game-time factor (affected by slow-mo)

  if (state === "play" && !paused) {
    // countdown
    if (countdownT > 0) {
      countdownT -= f;
      const prev = countdownNum;
      if (countdownT > 100) countdownNum = 3;
      else if (countdownT > 50) countdownNum = 2;
      else if (countdownT > 0) countdownNum = 1;
      else countdownNum = 0;
      if (countdownNum !== prev && countdownNum > 0) haptic("light");
    }

    if (shakeT > 0) shakeT -= f;
    if (lifeFlash > 0) lifeFlash -= f;
    if (landFlashT > 0) landFlashT -= f;
    if (scorePopScale > 0) scorePopScale = Math.max(0, scorePopScale - 0.06 * f);
    if (newBestFlash > 0) newBestFlash -= f;
    if (comboBarT > 0) comboBarT -= 0.008 * f;

    // animated score display
    if (displayScore < score) {
      displayScore = Math.min(score, displayScore + Math.max(1, Math.ceil((score - displayScore) * 0.2)));
    }

    // move baskets
    for (const b of baskets) {
      if (b.move) {
        b.move.phase += b.move.speed * gf * diffMult();
        b.x = b.move.cx + Math.sin(b.move.phase) * b.move.amp;
      }
    }

    if (deadT > 0) {
      deadT -= f;
      if (deadT <= 0) respawn();
    } else if (egg && countdownT <= 0) {
      if (egg.dropping) {
        egg.vy -= G * gf;
        egg.y += egg.vy * gf;
        egg.x += (lastBasket.x - egg.x) * 0.2 * gf;
        const top = lastBasket.y + lastBasket.h / 2;
        if (egg.vy < 0 && egg.y - EH / 2 <= top) {
          egg.dropping = false;
          land(lastBasket, true);
        }
      } else if (egg.phase === "perch") {
        const b = egg.perchB;
        egg.x = b.x + egg.perchDx;
        egg.y = restY(b);
        egg.squash = 0.25 + Math.abs(Math.sin(egg.perchT * 0.55)) * 0.3;
        egg.perchT -= gf;
        if (egg.perchT <= 0) {
          const sign = egg.perchDx >= 0 ? 1 : -1;
          egg.x = b.x + sign * edgeZone(b) * 1.05;
          egg.phase = "fly";
          egg.tipped = true;
          egg.vy = -1;
          play("fall");
          haptic("medium");
          addFloater(egg.x, egg.y + 34, "OFF!", "#ff5d7a");
        }
      } else if (egg.phase === "rest") {
        const b = baskets.find((x) => x.idx === lastBasket.idx) || lastBasket;
        egg.x = b.x;
        egg.y = restY(b);
      } else if (egg.phase === "fly") {
        const prevBottom = egg.y - EH / 2;
        egg.vy -= G * gf;
        egg.y += egg.vy * gf;

        // egg trail while flying
        if (Math.abs(egg.vy) > 1) {
          eggTrail.push({
            x: egg.x,
            y: egg.y,
            life: 12,
            maxLife: 12,
            size: EW * 0.3,
          });
        }

        // falling (vy < 0, y-up world) → catch: precision zones
        if (egg.vy < 0 && !egg.dropping && !egg.tipped) {
          const bottom = egg.y - EH / 2;
          for (const b of baskets) {
            if (b.idx <= lastScoredIdx) continue;
            const top = b.y + b.h / 2;
            const deep = top - b.h * 0.95;
            if (bottom <= top + 2 && prevBottom >= deep) {
              const dx = egg.x - b.x;
              const adx = Math.abs(dx);
              if (adx <= cleanZone(b)) {
                land(b, false);
              } else if (adx <= edgeZone(b)) {
                egg.phase = "perch";
                egg.perchT = 26;
                egg.perchB = b;
                egg.perchDx = dx;
                play("land");
                haptic("light");
              }
              break;
            }
          }
        }

        // fell below the basket it left → life lost
        if (
          !lostThisFall &&
          egg.phase === "fly" &&
          !egg.dropping &&
          (egg.y < lastBasket.y - H * 0.30 || screenY(egg.y) > H + 120)
        ) {
          lostThisFall = true;
          loseLife();
        }
      }
    }

    // smooth camera follow
    cameraTargetY = Math.max(cameraTargetY, egg.y - H * 0.40);
    camY += (cameraTargetY - camY) * Math.min(1, 0.12 * f);

    // cull + spawn
    while (baskets.length > 2 && screenY(baskets[0].y) > H + 260) {
      baskets.shift();
    }
    spawnAhead();
  }

  // egg trail tick
  let tw = 0;
  for (let i = 0; i < eggTrail.length; i++) {
    eggTrail[i].life -= f;
    if (eggTrail[i].life > 0) eggTrail[tw++] = eggTrail[i];
  }
  eggTrail.length = tw;

  // fx always tick
  for (const p of particles) {
    p.x += p.vx * f;
    p.y += p.vy * f;
    p.vy -= (p.grav || 0) * f;
    p.rot += (p.vr || 0) * f;
    p.life -= f;
  }
  let w = 0;
  for (let i = 0; i < particles.length; i++) {
    const o = particles[i];
    if (o.life > 0) particles[w++] = o;
  }
  particles.length = w;
  for (const t of floaters) {
    t.y += t.vy * f;
    t.life -= f;
  }
  w = 0;
  for (let i = 0; i < floaters.length; i++) {
    const o = floaters[i];
    if (o.life > 0) floaters[w++] = o;
  }
  floaters.length = w;
  for (const r of rings) {
    r.t += f;
    r.life -= f;
  }
  w = 0;
  for (let i = 0; i < rings.length; i++) {
    const o = rings[i];
    if (o.life > 0) rings[w++] = o;
  }
  rings.length = w;
  if (egg && egg.squash > 0) egg.squash = Math.max(0, egg.squash - 0.06 * f);

  // fireflies ambient
  for (const ff of bgFireflies) {
    ff.phase += ff.speed * f;
    ff.x += ff.vx * f;
    ff.y += ff.vy * f;
    // wrap
    if (ff.x < -10) ff.x = W + 10;
    if (ff.x > W + 10) ff.x = -10;
    if (ff.y < -10) ff.y = H + 10;
    if (ff.y > H + 10) ff.y = -10;
  }
}

function land(b, isRespawn) {
  const landDx = Math.abs(egg.x - b.x);
  egg.phase = "rest";
  egg.vy = 0;
  egg.x = b.x;
  egg.y = restY(b);
  egg.squash = 0.45;
  egg.tipped = false;
  egg.perchB = null;
  lostThisFall = false;
  lastBasket = b;
  rings.push({ x: b.x, y: b.y, t: 0, life: 26 });
  totalLands++;

  if (isRespawn) {
    play("nest");
    return;
  }

  const perfect = landDx < b.w * 0.09;

  if (b.idx > lastScoredIdx) {
    lastScoredIdx = b.idx;

    if (perfect) {
      combo++;
      perfectLands++;
      maxCombo = Math.max(maxCombo, combo);

      score++;
      scorePopScale = 1;

      play("nest");

      // slow-motion on perfect
      slowMoT = 14;
      landFlashT = 10;

      // enhanced particles
      spawnSparkles(egg.x, egg.y, 16, "#ffe98a");
      spawnLandBurst(egg.x, egg.y, 10, "#F5C518");

      // combo display
      const label = combo > 1
        ? "PERFECT x" + combo
        : "PERFECT!";
      addFloater(egg.x, egg.y + 30, label, "#ffe98a", combo > 2 ? 28 : 22);
      comboBarT = 1;
      haptic("medium");
    } else {
      combo = 0;
      score++;
      scorePopScale = 0.5;
      play("land");
      spawnSparkles(egg.x, egg.y, 6, "#ffffff");
      spawnLandBurst(egg.x, egg.y, 5, "#9dff70");
      addFloater(egg.x, egg.y + 26, "+1", "#9dff70");
    }

    if (score > best) {
      const wasBelow = best < score;
      best = score;
      bestEl.textContent = best;
      if (wasBelow && score > bestSaved) {
        newBestFlash = 80;
        addFloater(W / 2, camY + H * 0.22, "🏆 NEW BEST!", "#F5C518", 30);
      }
    }

    // milestone confetti every 10 points
    if (score > 0 && score % 10 === 0) {
      spawnConfetti(egg.x, egg.y + 40, 34);
      addFloater(egg.x, egg.y + 70, score + "!", "#56D9FF", 32);
      haptic("heavy");
    }
  } else {
    play("nest");
  }
}

/* ---------------- render ---------------- */

function drawBg() {
  if (!IM.bg.complete || !IM.bg.naturalWidth) {
    ctx.fillStyle = "#132211";
    ctx.fillRect(0, 0, W, H);
    return;
  }
  // single cover image with limited parallax (no tiling seams)
  const h = H * 1.35;
  const w = h;
  const slack = h - H;
  const off = Math.min(slack, camY * 0.07);
  const x = (W - w) / 2;
  const y = H - h + (slack - off);
  ctx.drawImage(IM.bg, x, y, w, h);
  ctx.fillStyle = "rgba(4,10,4,0.34)";
  ctx.fillRect(0, 0, W, H);

  // ambient fireflies
  for (const ff of bgFireflies) {
    const a = (Math.sin(ff.phase) * 0.5 + 0.5) * 0.6;
    if (a < 0.05) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = ff.color + a.toFixed(2) + ")";
    ctx.beginPath();
    ctx.arc(ff.x, ff.y, ff.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBasket(b) {
  if (!IM.basket.complete || !IM.basket.naturalWidth) return;
  const sy = screenY(b.y);
  if (sy < -b.h || sy > H + b.h) return;

  // soft glow under basket
  if (IM.glow.complete && IM.glow.naturalWidth) {
    ctx.globalAlpha = 0.25;
    const gw = b.w * 1.3;
    const gh = gw * 0.4;
    ctx.drawImage(IM.glow, b.x - gw / 2, sy + b.h * 0.15, gw, gh);
    ctx.globalAlpha = 1;
  }

  ctx.drawImage(IM.basket, b.x - b.w / 2, sy - b.h / 2, b.w, b.h);
}

function drawEggTrail() {
  if (!IM.egg.complete || !IM.egg.naturalWidth) return;
  for (const t of eggTrail) {
    const a = (t.life / t.maxLife) * 0.25;
    if (a < 0.02) continue;
    const sy = screenY(t.y);
    if (sy < -EH || sy > H + EH) continue;
    ctx.globalAlpha = a;
    const s = t.size;
    ctx.drawImage(IM.egg, t.x - s / 2, sy - s / 2, s, s * (1 / EGG_AR));
    ctx.globalAlpha = 1;
  }
}

function drawEgg() {
  if (!egg || !IM.egg.complete || !IM.egg.naturalWidth) return;
  const sy = screenY(egg.y);
  if (sy < -EH || sy > H + EH * 2) return;

  // shadow under egg
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  const shadowY = sy + EH * 0.4;
  ctx.ellipse(egg.x, shadowY, EW * 0.35, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  let ang = 0;
  if (egg.phase === "fly") {
    ang = clamp(egg.vy * 0.018, -0.5, 0.5);
  }
  if (egg.phase === "perch") {
    ang = (egg.perchDx > 0 ? 1 : -1) * Math.sin(egg.perchT * 0.6) * 0.35;
  }
  const sq = egg.squash || 0;
  const sx = 1 + sq * 0.45;
  const sy2 = 1 - sq * 0.45;

  ctx.save();
  ctx.translate(egg.x + (ctx.__shakeX || 0), sy + (ctx.__shakeY || 0));
  ctx.rotate(ang);
  ctx.scale(sx, sy2);
  ctx.drawImage(IM.egg, -EW / 2, -EH / 2, EW, EH);
  ctx.restore();
}

function drawHud() {
  if (!IM.wing.complete || !IM.wing.naturalWidth) return;
  // score wing medallion — below topbar
  const ww = Math.min(W * 0.34, 140);
  const wh = (ww * 112) / 208;
  const wy = 62;

  // pop animation
  const pop = scorePopScale > 0 ? 1 + scorePopScale * 0.18 : 1;
  ctx.save();
  ctx.translate(W / 2, wy + wh / 2);
  ctx.scale(pop, pop);
  ctx.translate(-W / 2, -(wy + wh / 2));

  ctx.drawImage(IM.wing, W / 2 - ww / 2, wy, ww, wh);
  ctx.fillStyle = "#fff";
  ctx.font = "700 " + Math.round(wh * 0.42) + "px 'Bebas Neue', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(displayScore), W / 2, wy + wh * 0.52);
  ctx.restore();

  // combo bar below score wing
  if (combo > 0 && comboBarT > 0) {
    const barW = ww * 0.85;
    const barH = 4;
    const barX = W / 2 - barW / 2;
    const barY = wy + wh + 6;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(barX, barY, barW, barH);
    const gradient = ctx.createLinearGradient(barX, barY, barX + barW * comboBarT, barY);
    gradient.addColorStop(0, "#ffe98a");
    gradient.addColorStop(1, "#F5C518");
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, barY, barW * Math.max(0, comboBarT), barH);

    // combo text
    if (combo > 1) {
      ctx.font = "700 " + Math.round(wh * 0.22) + "px 'Bebas Neue', sans-serif";
      ctx.fillStyle = "#ffe98a";
      ctx.globalAlpha = 0.9;
      ctx.fillText("x" + combo + " COMBO", W / 2, barY + barH + 14);
      ctx.globalAlpha = 1;
    }
  }

  // new best flash
  if (newBestFlash > 0) {
    const a = Math.min(1, newBestFlash / 30);
    ctx.globalAlpha = a * 0.85;
    ctx.font = "700 16px 'Bebas Neue', sans-serif";
    ctx.fillStyle = "#F5C518";
    ctx.textAlign = "center";
    ctx.fillText("🏆 NEW BEST!", W / 2, wy - 8);
    ctx.globalAlpha = 1;
  }

  // lives: mini eggs below topbar, left
  const lw = Math.min(W * 0.07, 28);
  const lh = (lw * 324) / 256;
  for (let i = 0; i < LIVES_MAX; i++) {
    const alive = i < lives;
    ctx.globalAlpha = alive ? 1 : 0.22;
    const pulse = !alive && lifeFlash > 0 ? Math.sin(lifeFlash * 0.8) * 2 : 0;
    const lostScale = !alive && lifeFlash > 0 ? 1 + Math.sin(lifeFlash * 0.5) * 0.15 : 1;
    ctx.save();
    const lx = 14 + i * (lw + 8) + lw / 2;
    const ly = 68 + pulse + lh / 2;
    ctx.translate(lx, ly);
    ctx.scale(lostScale, lostScale);
    ctx.drawImage(IM.egg, -lw / 2, -lh / 2, lw, lh);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawHint() {
  if (hintT <= 0 || state !== "play" || countdownT > 0) return;
  if (!IM.hand.complete) return;
  const bob = Math.sin(performance.now() / 220) * 8;
  const hw = Math.min(W * 0.22, 92);
  const hh = (hw * 312) / 336;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(IM.hand, egg.x - hw * 0.3, screenY(egg.y) - EH - hh * 0.85 + bob, hw, hh);
  ctx.globalAlpha = 1;
}

function drawCountdown() {
  if (countdownT <= 0) return;
  const num = countdownNum;
  const text = num > 0 ? String(num) : "GO!";
  const phase = countdownT % 50;
  const scale = 1 + Math.max(0, (phase - 40) / 10) * 0.6; // pop-in
  const alpha = Math.min(1, phase / 5);

  ctx.save();
  ctx.globalAlpha = alpha * 0.95;
  ctx.font = "700 " + Math.round(72 * scale) + "px 'Bebas Neue', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.strokeText(text, W / 2, H * 0.4);
  ctx.fillStyle = num > 0 ? "#fff" : "#F5C518";
  ctx.fillText(text, W / 2, H * 0.4);
  ctx.restore();
}

function drawFx() {
  for (const r of rings) {
    const p = 1 - r.life / 26;
    const rad = 20 + p * 70;
    ctx.globalAlpha = r.life / 26 * 0.8;
    const s = rad * 2;
    ctx.drawImage(IM.ring, r.x - rad, screenY(r.y) - rad, s, s);
  }
  ctx.globalAlpha = 1;

  for (const p of particles) {
    const a = Math.min(1, p.life / 20);
    ctx.globalAlpha = a;
    if (p.vr) {
      ctx.save();
      ctx.translate(p.x, screenY(p.y));
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, screenY(p.y), p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of floaters) {
    const life01 = Math.min(1, t.life / 22);
    ctx.globalAlpha = life01;
    const fsize = t.fontSize || 22;
    // scale-in effect
    const scaleIn = t.life > 45 ? 0.6 + 0.4 * ((55 - t.life) / 10) : 1;
    ctx.save();
    ctx.translate(t.x, screenY(t.y));
    ctx.scale(scaleIn, scaleIn);
    ctx.font = "700 " + fsize + "px 'Bebas Neue', sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(t.text, 0, 0);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawLandFlash() {
  if (landFlashT <= 0) return;
  const a = (landFlashT / 10) * 0.18;
  ctx.fillStyle = "rgba(255,233,138," + a.toFixed(3) + ")";
  ctx.fillRect(0, 0, W, H);
}

function drawLifeFlashOverlay() {
  if (lifeFlash <= 0) return;
  const a = (lifeFlash / 30) * 0.12;
  ctx.fillStyle = "rgba(255,40,40," + a.toFixed(3) + ")";
  ctx.fillRect(0, 0, W, H);
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  let shx = 0;
  let shy = 0;
  if (shakeT > 0) {
    shx = (Math.random() * 2 - 1) * shakeT * 0.6;
    shy = (Math.random() * 2 - 1) * shakeT * 0.6;
  }
  ctx.__shakeX = shx;
  ctx.__shakeY = shy;

  ctx.save();
  ctx.translate(shx, shy);

  drawBg();

  for (const b of baskets) drawBasket(b);
  drawEggTrail();
  drawEgg();
  drawFx();
  drawLandFlash();
  drawLifeFlashOverlay();

  if (state === "play" || state === "paused") drawHud();
  drawHint();
  drawCountdown();

  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "700 42px 'Bebas Neue', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PAUSED", W / 2, H / 2);
    ctx.font = "400 16px 'Space Mono', monospace";
    ctx.fillStyle = "#A5ADBC";
    ctx.fillText("tap to resume", W / 2, H / 2 + 40);

    // show score + lives on pause
    ctx.font = "700 20px 'Bebas Neue', sans-serif";
    ctx.fillStyle = "#F5C518";
    ctx.fillText("SCORE: " + score + "  ·  LIVES: " + lives, W / 2, H / 2 + 76);
  }

  ctx.restore();
  ctx.__shakeX = 0;
  ctx.__shakeY = 0;
}

/* ---------------- loop ---------------- */

let lastT = performance.now();
let renderedPause = false;

function loop(t) {
  const dt = Math.min(50, t - lastT);
  lastT = t;
  update(dt);
  if (!paused || !renderedPause) {
    renderedPause = paused;
    render();
  }
  requestAnimationFrame(loop);
}

/* ---------------- boot ---------------- */

fitCanvas();
layoutMetrics();
resetWorld();
bestEl.textContent = best;
showMenu();
if (typeof Difficulty !== "undefined" && Difficulty.renderPicker)
  Difficulty.renderPicker(document.getElementById("diffPicker"), "eggjump");
setMuted(muted);
requestAnimationFrame(loop);
