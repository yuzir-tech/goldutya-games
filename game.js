/* Goldutya Fly — performance + animation enhanced build:
   - delta-time physics (consistent feel on any refresh rate)
   - cached sprites/tiles (no per-frame gradient or path churn)
   - parallax hills, squash & stretch, floating score popups,
     speed lines, combo flash, particle caps, DPR cap          */

"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const bestEl = document.getElementById("best");

const GOLD = "#F5C518";
const GOLD2 = "#FFDF59";
const RED = "#D42B2B";
const DARK = "#0B0B0D";

let W = 390;
let H = 844;
let DPR = 1;
let GROUND_H = 70;
let PIPE_W = 70;
let PIPE_GAP = 190;
let PIPE_SPEED = 3.2;
let PIPE_SPACING = 220;
let GRAVITY = 0.45;
let FLAP_V = -8.5;
let DUCK_W = 56;
let DUCK_H = 47;
let IS_MOBILE = false;
const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
let LOW_END = false;

/* ---------- render caches (built once per size/night bucket) ---------- */
const pipeCache = {};   // "PIPE_W-nightBucket" -> {body, cap} tiles
const hillCache = {};   // "layer-nightBucket" -> silhouette tile
const skyCache = {};    // "WxH-nightBucket" -> sky gradient tile
let dashTile = null;    // scrolling ground dash strip
let pebbleTile = null;  // ground 2nd parallax layer
let cloudTile = null;   // soft multi-puff cloud sprite
let coinTile = null;    // gold coin sprite
let shieldTile = null;  // shield bubble sprite
let groundOff = 0;      // shared scroll offset for ground + hills

function nightBucket() { return Math.round(nightPhase * 10); }

function makeTile(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}

function pipeSprites() {
  const b = nightBucket();
  const key = PIPE_W + "-" + b;
  let s = pipeCache[key];
  if (s) return s;
  const n = b / 10;
  const r = Math.round(11 + n * 18);
  const g = Math.round(107 + n * 60);
  const bl = Math.round(58 + n * 30);
  const body = makeTile(PIPE_W, 8, (g2) => {
    const grad = g2.createLinearGradient(0, 0, PIPE_W, 0);
    grad.addColorStop(0, "rgb(" + (r - 5) + "," + (g - 20) + "," + (bl - 10) + ")");
    grad.addColorStop(0.45, "rgb(" + r + "," + g + "," + bl + ")");
    grad.addColorStop(1, "rgb(" + (r - 5) + "," + (g - 20) + "," + (bl - 10) + ")");
    g2.fillStyle = grad;
    g2.fillRect(0, 0, PIPE_W, 8);
  });
  const capEdge = n > 0.3 ? "rgba(245,197,24,0.7)" : "rgba(245,197,24,0.55)";
  const cap = makeTile(PIPE_W + 12, 8, (g2) => {
    g2.fillStyle = "rgb(" + (r - 10) + "," + (g - 30) + "," + (bl - 15) + ")";
    g2.fillRect(0, 0, PIPE_W + 12, 8);
    g2.fillStyle = capEdge;
    g2.fillRect(6, 0, 5, 8);
  });
  s = { body, cap };
  pipeCache[key] = s;
  return s;
}

function hillTile(layer) {
  const b = nightBucket();
  const key = layer + "-" + b;
  let c = hillCache[key];
  if (c) return c;
  const n = b / 10;
  const bases = [[58, 96, 132], [38, 70, 100], [24, 62, 44]];
  const base = bases[Math.min(layer, 2)];
  const r = Math.round(base[0] * (1 - n) + 8 * n);
  const g = Math.round(base[1] * (1 - n) + 12 * n);
  const bl = Math.round(base[2] * (1 - n) + 20 * n);
  const tw = 480, th = 200;
  const periods = [2, 2, 3][Math.min(layer, 2)];
  const amp = [60, 70, 96][Math.min(layer, 2)];
  c = makeTile(tw, th, (g2) => {
    g2.fillStyle = "rgb(" + r + "," + g + "," + bl + ")";
    g2.beginPath();
    g2.moveTo(0, th);
    for (let x = 0; x <= tw; x += 6) {
      const ph = (x / tw) * Math.PI * 2 * periods;
      const y = th - 36 - (Math.sin(ph) * 0.5 + 0.5) * amp;
      g2.lineTo(x, y);
    }
    g2.lineTo(tw, th);
    g2.closePath();
    g2.fill();
  });
  hillCache[key] = c;
  return c;
}

function skyTile() {
  const b = nightBucket();
  const key = Math.round(W) + "x" + Math.round(H) + "-" + b;
  let c = skyCache[key];
  if (c) return c;
  const n = b / 10;
  const dayTop = [26, 58, 102], nightTop = [8, 15, 30];
  const dayBot = [18, 48, 72], nightBot = [4, 8, 18];
  const dayMid = [dayTop[0] * 0.85, dayTop[1] * 0.85, dayTop[2] * 0.9];
  const nightMid = [nightTop[0] * 0.85, nightTop[1] * 0.85, nightTop[2] * 0.9];
  c = makeTile(Math.max(1, Math.round(W)), Math.max(1, Math.round(H)), (g2, w, h) => {
    const g = g2.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, lerpRGB(dayTop, nightTop, n));
    g.addColorStop(0.55, lerpRGB(dayMid, nightMid, n));
    g.addColorStop(1, lerpRGB(dayBot, nightBot, n));
    g2.fillStyle = g;
    g2.fillRect(0, 0, w, h);
  });
  skyCache[key] = c;
  return c;
}

function getCloudTile() {
  if (cloudTile) return cloudTile;
  cloudTile = makeTile(128, 64, (g2) => {
    const puffs = [[40, 40, 28], [68, 32, 22], [96, 42, 20], [26, 46, 18]];
    for (const [cx, cy, r] of puffs) {
      const rg = g2.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
      rg.addColorStop(0, "rgba(255,255,255,0.95)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g2.fillStyle = rg;
      g2.beginPath();
      g2.arc(cx, cy, r, 0, Math.PI * 2);
      g2.fill();
    }
  });
  return cloudTile;
}

function getPebbleTile() {
  if (pebbleTile) return pebbleTile;
  pebbleTile = makeTile(184, 26, (g2) => {
    g2.fillStyle = "rgba(255,255,255,0.10)";
    const dots = [[20, 16, 5, 3], [78, 8, 4, 2.5], [140, 18, 6, 3], [170, 6, 3, 2]];
    for (const [dx, dy, rx, ry] of dots) {
      g2.beginPath();
      g2.ellipse(dx, dy, rx, ry, 0, 0, Math.PI * 2);
      g2.fill();
    }
  });
  return pebbleTile;
}

function getCoinTile() {
  if (coinTile) return coinTile;
  coinTile = makeTile(28, 28, (g2) => {
    const rg = g2.createRadialGradient(14, 14, 2, 14, 14, 13);
    rg.addColorStop(0, "#FFDF59");
    rg.addColorStop(0.7, "#F5C518");
    rg.addColorStop(1, "#B8860B");
    g2.fillStyle = rg;
    g2.beginPath();
    g2.arc(14, 14, 12, 0, Math.PI * 2);
    g2.fill();
    g2.strokeStyle = "rgba(255,255,255,0.55)";
    g2.lineWidth = 1.5;
    g2.beginPath();
    g2.arc(14, 14, 8, 0, Math.PI * 2);
    g2.stroke();
  });
  return coinTile;
}

function getShieldTile() {
  if (shieldTile) return shieldTile;
  shieldTile = makeTile(40, 40, (g2) => {
    g2.strokeStyle = "rgba(86,217,255,0.9)";
    g2.lineWidth = 2.5;
    g2.fillStyle = "rgba(86,217,255,0.15)";
    g2.beginPath();
    g2.arc(20, 20, 17, 0, Math.PI * 2);
    g2.fill();
    g2.stroke();
    g2.fillStyle = "rgba(255,255,255,0.85)";
    g2.beginPath();
    g2.arc(20, 20, 4, 0, Math.PI * 2);
    g2.fill();
  });
  return shieldTile;
}

function getDashTile() {
  if (dashTile) return dashTile;
  const dash = 46;
  dashTile = makeTile(dash * 2, 4, (g2) => {
    g2.fillStyle = "rgba(255,255,255,0.16)";
    g2.fillRect(0, 0, dash * 0.65, 4);
  });
  return dashTile;
}

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  LOW_END = ((navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));
  DPR = Math.min(LOW_END ? 1.5 : 2, window.devicePixelRatio || 1); /* cap DPR: big perf win on hi-dpi phones */
  MAX_PARTICLES = LOW_END ? 100 : 160;
  canvas.width = Math.round(cssW * DPR);
  canvas.height = Math.round(cssH * DPR);
  W = cssW;
  H = cssH;
  IS_MOBILE = (typeof TG !== "undefined" && TG.platform && ["android","ios"].includes(TG.platform)) || ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0 || W < 600;
  const diff = typeof Difficulty !== "undefined" ? Difficulty.getDiff("fly") : "medium";
  const diffSpeedMult = diff === "easy" ? 0.8 : diff === "hard" ? 1.2 : 1.0;
  const diffGapAdd = diff === "easy" ? 35 : diff === "hard" ? -25 : 0;
  const diffGravMult = diff === "easy" ? 0.85 : diff === "hard" ? 1.15 : 1.0;

  GROUND_H = Math.max(64, Math.round(H * 0.13));
  PIPE_W = Math.max(58, Math.min(90, Math.round(W * 0.18)));
  PIPE_GAP = Math.max(170, Math.min(350, Math.round(H * 0.32) + diffGapAdd));
  PIPE_SPEED = Math.max(1.8, Math.min(4.8, (W * 0.006) * diffSpeedMult));
  PIPE_SPACING = Math.max(260, Math.round(W * 0.78));
  if (IS_MOBILE) {
    GRAVITY = H * 0.00075 * diffGravMult;
    FLAP_V = -H * 0.022;
  } else {
    GRAVITY = H * 0.001 * diffGravMult;
    FLAP_V = -H * 0.022;
  }
  DUCK_W = Math.max(48, Math.min(72, Math.min(W, H) * 0.12));
  DUCK_H = DUCK_W * 0.83;
}

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(fitCanvas).observe(canvas);
} else {
  window.addEventListener("resize", fitCanvas);
}

/* ---------- duck skin ---------- */
const SKINS = [
  { name: "Gold", min: 0, filter: "" },
  { name: "Pirate", min: 10, filter: "" },
  { name: "Crown", min: 25, filter: "" },
  { name: "Rainbow", min: 50, filter: "hue-rotate(180deg) saturate(1.6)" },
  { name: "Ghost", min: 100, filter: "opacity(0.55) brightness(1.4)" },
];
let unlockedSkins = JSON.parse(localStorage.getItem("goldutya-fly-skins") || "[0]");
let activeSkin = unlockedSkins[unlockedSkins.length - 1] || 0;

function unlockCheck(score) {
  let changed = false;
  for (const s of SKINS) {
    if (score >= s.min && !unlockedSkins.includes(s.min)) {
      unlockedSkins.push(s.min);
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem("goldutya-fly-skins", JSON.stringify(unlockedSkins));
    activeSkin = unlockedSkins[unlockedSkins.length - 1];
    updateSkinUI();
  }
}

function updateSkinUI() {
  const picker = document.getElementById("skinPicker");
  if (!picker) return;
  picker.innerHTML = "";
  const icons = ["", "🏴‍☠️", "👑", "🌈", "👻"];
  for (let i = 0; i < SKINS.length; i++) {
    const s = SKINS[i];
    const unlocked = unlockedSkins.includes(s.min);
    const btn = document.createElement("button");
    btn.className = "skin-swatch" + (activeSkin === s.min ? " active" : "");
    btn.disabled = !unlocked;
    btn.title = unlocked ? s.name : "Score " + s.min + " to unlock";
    if (i === 0 && unlocked) {
      const img = document.createElement("img");
      img.src = "assets/duck-mid.png";
      img.style.width = "32px";
      img.style.height = "32px";
      img.style.objectFit = "contain";
      btn.textContent = "";
      btn.appendChild(img);
    } else {
      btn.textContent = unlocked ? icons[i] : "🔒";
    }
    if (unlocked) {
      btn.onclick = () => { activeSkin = s.min; updateSkinUI(); };
    }
    picker.appendChild(btn);
  }
}

const duckUp = new Image(); duckUp.src = "assets/duck-up.png";
const duckMid = new Image(); duckMid.src = "assets/duck-mid.png";
const duckDown = new Image(); duckDown.src = "assets/duck-down.png";
const duckFallback = new Image(); duckFallback.src = "assets/duck.svg";

const DUCK_FRAMES = {
  up:   { img: duckUp,   sx: 120, sy: 114, sw: 471, sh: 443 },
  mid:  { img: duckMid,  sx: 75,  sy: 117, sw: 561, sh: 438 },
  down: { img: duckDown, sx: 20,  sy: 20,  sw: 671, sh: 632 },
};

function getDuckFrame() {
  if (duck.flapT > 5) return DUCK_FRAMES.up;
  if (duck.flapT > 0) return DUCK_FRAMES.mid;
  if (duck.vy < -1) return DUCK_FRAMES.up;
  if (duck.vy > 1) return DUCK_FRAMES.down;
  return DUCK_FRAMES.mid;
}

const states = { READY: "ready", PLAY: "play", OVER: "over" };
let duck, pipes, clouds, coins, shields, score, best, state, frame, playFrame, particles, invuln;
let popups, trailAcc, flashA;
let shakeX = 0, shakeY = 0, shakeDur = 0;
let scoreScale = 1, combo = 0, maxCombo = 0, pipeCount = 0, comboTimer = 0;
let nightPhase = 0, nightDir = 0, nightTimer = 0;
let muteOn = false;
let paused = false;
let shareShown = false;
let coinCount = 0, coinTotal = 0, shield = false, multiplier = 1;
let shownScore = 0, deathSlow = 0, timeScale = 1;
let shootT = 0, shootX = 0, shootY = 0;
let hintShown = localStorage.getItem("goldutya-fly-hinted") === "1";
let hintTimer = 0;
let MAX_PARTICLES = 160;

best = Number(localStorage.getItem("goldutya-fly-best") || 0);
coinTotal = Number(localStorage.getItem("goldutya-fly-coins") || 0);
bestEl.textContent = best;
muteOn = localStorage.getItem("goldutya-fly-mute") === "1";

/* ---------- audio ---------- */
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
}
function beep(freq, dur, type, vol) {
  if (!audioCtx || muteOn) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function quack() { beep(340, 0.14, "sawtooth", 0.16); }
function scoreBlip() { beep(980, 0.09, "square", 0.1); }
function comboBlip(c) { beep(660 + c * 60, 0.1, "sine", 0.12); }
function thud() { beep(110, 0.28, "sine", 0.28); }

/* ---------- share ---------- */
function shareScore() {
  const text = "I scored " + score + " in Goldutya Fly! " + (maxCombo > 1 ? "(" + maxCombo + "x combo!) " : "") + "Can you beat me? 🦆";
  if (navigator.share) {
    navigator.share({ title: "Goldutya Fly", text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("shareBtn");
      if (btn) btn.textContent = "COPIED!";
      setTimeout(() => { if (btn) btn.textContent = "SHARE SCORE"; }, 2000);
    }).catch(() => {});
  }
}

/* ---------- mute ---------- */
function toggleMute() {
  muteOn = !muteOn;
  localStorage.setItem("goldutya-fly-mute", muteOn ? "1" : "0");
  const btn = document.getElementById("muteBtn");
  if (btn) btn.innerHTML = muteOn ? '<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#volume-off"/></svg>' : '<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#volume-on"/></svg>';
}

function reset() {
  fitCanvas();
  duck = {
    x: W * 0.32,
    y: H * 0.42,
    w: DUCK_W,
    h: DUCK_H,
    vy: 0,
    rot: 0,
    targetRot: 0,
    rotVel: 0,
    flapT: 0,
    t: 0,
    sq: 0, /* squash & stretch spring, 1 on flap */
  };
  pipes = [];
  coins = [];
  shields = [];
  coinCount = 0;
  shield = false;
  multiplier = 1;
  shownScore = 0;
  deathSlow = 0;
  shootT = 0;
  const medalEl = document.getElementById("medal");
  if (medalEl) medalEl.hidden = true;
  const nbEl = document.getElementById("newBest");
  if (nbEl) nbEl.hidden = true;
  clouds = [];
  for (let i = 0; i < 12; i++) {
    const layer = i % 3;
    clouds.push({
      x: Math.random() * W * 1.5,
      y: H * (0.05 + Math.random() * 0.45),
      baseY: 0,
      speed: [0.15, 0.35, 0.6][layer],
      alpha: [0.08, 0.14, 0.22][layer],
      size: [0.6, 1, 1.4][layer],
      phase: Math.random() * Math.PI * 2,
    });
  }
  for (const c of clouds) c.baseY = c.y;
  score = 0;
  frame = 0;
  playFrame = 0;
  particles = [];
  popups = [];
  trailAcc = 0;
  flashA = 0;
  invuln = 40;
  shakeX = 0;
  shakeY = 0;
  shakeDur = 0;
  scoreScale = 1;
  combo = 0;
  maxCombo = 0;
  pipeCount = 0;
  comboTimer = 0;
  nightPhase = 0;
  nightDir = 0;
  nightTimer = 0;
  paused = false;
  shareShown = false;
  state = states.READY;
}

reset();

/* ---------- duck ---------- */
function drawDuck() {
  const bob = state === states.READY ? Math.sin(duck.t * 0.12) * 6 : 0;
  ctx.save();
  ctx.translate(duck.x, duck.y + bob);
  ctx.rotate(duck.rot);
  /* squash & stretch: stretch up on flap, settle back */
  const sq = duck.sq;
  ctx.scale(1 - 0.14 * sq, 1 + 0.22 * sq);
  const dframe = getDuckFrame();
  if (!REDUCED && state === states.PLAY && combo >= 5 && dframe.img.complete && dframe.img.naturalWidth > 0) {
    ctx.globalAlpha = 0.16;
    for (let g = 1; g <= 2; g++) {
      ctx.drawImage(dframe.img, dframe.sx, dframe.sy, dframe.sw, dframe.sh, -duck.w / 2 - g * 7, -duck.h / 2, duck.w, duck.h);
    }
    ctx.globalAlpha = 1;
  }
  if (dframe.img.complete && dframe.img.naturalWidth > 0) {
    ctx.save();
    const skinData = SKINS.find(s => s.min === activeSkin);
    if (skinData && skinData.filter) ctx.filter = skinData.filter;
    ctx.drawImage(dframe.img, dframe.sx, dframe.sy, dframe.sw, dframe.sh, -duck.w / 2, -duck.h / 2, duck.w, duck.h);
    ctx.restore();
    if (activeSkin === 1) {
      ctx.fillStyle = DARK;
      ctx.fillRect(-duck.w * 0.1, -duck.h * 0.18, duck.w * 0.28, duck.h * 0.12);
    }
    if (activeSkin === 2) {
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(-duck.w * 0.15, -duck.h * 0.42);
      ctx.lineTo(0, -duck.h * 0.62);
      ctx.lineTo(duck.w * 0.15, -duck.h * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(0, -duck.h * 0.58, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (duckFallback.complete && duckFallback.naturalWidth > 0) {
    ctx.drawImage(duckFallback, -duck.w / 2, -duck.h / 2, duck.w, duck.h);
  } else {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.ellipse(0, 0, duck.w / 2, duck.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (shield) {
    const pr = REDUCED ? 1 : 1 + Math.sin(duck.t * 0.2) * 0.05;
    ctx.strokeStyle = "rgba(86,217,255,0.85)";
    ctx.lineWidth = 2.5;
    ctx.fillStyle = "rgba(86,217,255,0.12)";
    ctx.beginPath();
    ctx.arc(0, 0, duck.w * 0.62 * pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (state === states.PLAY && combo >= 3) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3 + Math.sin(duck.t * 0.2) * 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, duck.w * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ---------- pipes ---------- */
function spawnPipe() {
  const gap = pipeCount < 3 ? PIPE_GAP + 40 : PIPE_GAP;
  const playable = H - GROUND_H;
  const minCenter = gap / 2 + 24;
  const maxCenter = playable - gap / 2 - 24;
  const center = minCenter + Math.random() * Math.max(1, maxCenter - minCenter);
  pipes.push({ x: W + PIPE_W, gapY: center, scored: false, spawnFrame: frame, gapOverride: pipeCount < 3 });
  const np = pipes[pipes.length - 1];
  if (pipeCount > 0 && pipeCount % 15 === 0 && !shields.length) {
    shields.push({ x: np.x + PIPE_W / 2, y: center, got: false, bob: Math.random() * Math.PI * 2 });
  } else if (pipeCount > 2 && Math.random() < 0.6) {
    coins.push({ x: np.x + PIPE_W / 2, y: center, got: false, spin: Math.random() * Math.PI * 2 });
  }
}

function drawPipes() {
  const spr = pipeSprites();
  for (const p of pipes) {
    const gap = p.gapOverride ? PIPE_GAP + 40 : PIPE_GAP;
    const topH = p.gapY - gap / 2;
    const botY = p.gapY + gap / 2;
    const botH = H - GROUND_H - botY;
    const cap = Math.max(18, Math.round(H * 0.028));
    const age = frame - p.spawnFrame;
    if (age < 30) {
      ctx.fillStyle = "rgba(245,197,24," + (0.25 * (1 - age / 30)) + ")";
      ctx.fillRect(p.x - 10, 0, PIPE_W + 20, H);
    }
    if (topH > 0) ctx.drawImage(spr.body, 0, 0, PIPE_W, 8, p.x, 0, PIPE_W, topH);
    if (botH > 0) ctx.drawImage(spr.body, 0, 0, PIPE_W, 8, p.x, botY, PIPE_W, botH);
    if (!REDUCED && topH > 60) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, 0, PIPE_W, topH);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(p.x + PIPE_W * 0.18, (frame * 2.2 + p.spawnFrame * 3) % topH, PIPE_W * 0.5, 26);
      ctx.restore();
    }
    if (!REDUCED && botH > 60) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, botY, PIPE_W, botH);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(p.x + PIPE_W * 0.18, botY + (botH - ((frame * 2.2 + p.spawnFrame * 3) % botH)), PIPE_W * 0.5, 26);
      ctx.restore();
    }
    ctx.drawImage(spr.cap, 0, 0, PIPE_W + 12, 8, p.x - 6, topH - cap, PIPE_W + 12, cap);
    ctx.drawImage(spr.cap, 0, 0, PIPE_W + 12, 8, p.x - 6, botY, PIPE_W + 12, cap);
  }
}

/* ---------- coins & shield orbs ---------- */
function drawCoins() {
  const t = getCoinTile();
  for (const c of coins) {
    if (c.got) continue;
    const sx = Math.abs(Math.cos(c.spin));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(Math.max(0.15, sx), 1);
    ctx.drawImage(t, -14, -14, 28, 28);
    ctx.restore();
  }
}

function drawShieldOrbs() {
  const t = getShieldTile();
  for (const s of shields) {
    if (s.got) continue;
    const by = s.y + Math.sin(frame * 0.06 + s.bob) * 5;
    const pulse = REDUCED ? 1 : 1 + Math.sin(frame * 0.1 + s.bob) * 0.08;
    const r = 20 * pulse;
    ctx.drawImage(t, s.x - r, by - r, r * 2, r * 2);
  }
}

/* ---------- sky / hills / clouds / ground ---------- */
function lerpRGB(a, b, n) {
  return "rgb(" + Math.round(a[0] * (1 - n) + b[0] * n) + "," + Math.round(a[1] * (1 - n) + b[1] * n) + "," + Math.round(a[2] * (1 - n) + b[2] * n) + ")";
}

function drawSky() {
  const n = nightPhase;
  ctx.drawImage(skyTile(), 0, 0, W, H);
  if (n < 0.5) {
    const pulse = REDUCED ? 1 : 1 + Math.sin(frame * 0.02) * 0.06;
    const sun = ctx.createRadialGradient(W * 0.82, H * 0.14, 8, W * 0.82, H * 0.14, Math.max(80, W * 0.35) * pulse);
    sun.addColorStop(0, "rgba(245,197,24," + (0.22 * (1 - n * 2)) + ")");
    sun.addColorStop(1, "rgba(245,197,24,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
  }
  if (n > 0.4) {
    const sn = Math.min(1, (n - 0.4) / 0.3);
    for (let i = 0; i < 14; i++) {
      const sx = ((i * 89) % 97) / 97 * W;
      const sy = ((i * 53) % 89) / 89 * H * 0.5;
      const tw = REDUCED ? 0.8 : 0.5 + 0.5 * Math.sin(frame * 0.03 + i * 1.7);
      ctx.globalAlpha = sn * tw;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx, sy, 1.3 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const ma = Math.min(1, (n - 0.4) / 0.3);
    const mx = W * 0.78, my = H * 0.12, mr = Math.max(16, W * 0.05);
    ctx.globalAlpha = ma * 0.9;
    ctx.fillStyle = "#F4F1DE";
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(200,196,170,0.6)";
    ctx.beginPath();
    ctx.arc(mx - mr * 0.3, my - mr * 0.15, mr * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (shootT > 0) {
    const p = 1 - shootT / 20;
    const sx2 = shootX - p * W * 0.25;
    const sy2 = shootY + p * H * 0.12;
    ctx.strokeStyle = "rgba(255,255,255," + (0.7 * (1 - p)) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx2, sy2);
    ctx.lineTo(sx2 + 34, sy2 - 16);
    ctx.stroke();
  }
  /* clouds: cached soft sprite, bob + slow breathing */
  const cl = getCloudTile();
  for (const c of clouds) {
    const cy = c.baseY + Math.sin(frame * 0.01 + c.phase) * 4;
    const br = REDUCED ? 1 : 1 + Math.sin(frame * 0.005 + c.phase) * 0.04;
    const s = c.size * br;
    ctx.globalAlpha = c.alpha * (1 - n * 0.5);
    ctx.drawImage(cl, c.x - 64 * s, cy - 26 * s, 128 * s, 64 * s);
  }
  ctx.globalAlpha = 1;
}

/* two parallax hill layers for depth — cached tiles, seamless wrap */
function drawHills() {
  const gy = H - GROUND_H;
  for (let layer = 0; layer < 3; layer++) {
    const tile = hillTile(layer);
    const hh = Math.round(H * [0.07, 0.1, 0.15][layer]);
    const speed = [0.08, 0.2, 0.42][layer];
    const off = (groundOff * speed) % 480;
    const y = gy - hh + 14;
    for (let x = -off; x < W; x += 480) {
      ctx.drawImage(tile, Math.round(x), y, 480, hh);
    }
  }
}

function drawGround() {
  const gy = H - GROUND_H;
  const n = nightPhase;
  const r = Math.round(14 - n * 8);
  const gv = Math.round(124 - n * 50);
  const b = Math.round(69 - n * 25);
  ctx.fillStyle = "rgb(" + r + "," + gv + "," + b + ")";
  ctx.fillRect(0, gy, W, GROUND_H);
  ctx.fillStyle = "rgb(" + (r - 4) + "," + (gv - 20) + "," + (b - 12) + ")";
  ctx.fillRect(0, gy, W, 10);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, gy, W, 3);
  const tile = getDashTile();
  const tw = 92;
  const off = groundOff % tw;
  const dy = gy + GROUND_H * 0.45;
  for (let x = -off; x < W; x += tw) {
    ctx.drawImage(tile, Math.round(x), dy, tw, 4);
  }
  /* 2nd parallax layer: pebbles, scrolls faster */
  const pw = 184;
  const poff = (groundOff * 1.9) % pw;
  const py = gy + GROUND_H * 0.28;
  for (let x = -poff; x < W; x += pw) {
    ctx.drawImage(getPebbleTile(), Math.round(x), py, pw, 26);
  }
}

/* ---------- particles & popups ---------- */
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    if (particles.length >= MAX_PARTICLES) return;
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 4;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, life: 28 + Math.random() * 18, color, r: 2 + Math.random() * 3 });
  }
}
function updateParticles(dtF) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dtF;
    p.y += p.vy * dtF;
    p.vy += 0.14 * dtF;
    if (p.feather) p.rot += (p.rotV || 0) * dtF;
    p.life -= dtF;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / 24);
    ctx.fillStyle = p.color;
    if (p.feather) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.6, p.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  if (!popups.length) return;
  ctx.save();
  ctx.textAlign = "center";
  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.life / 22);
    const t = Math.min(1, (p.age || 0) / 8);
    let sc = 1;
    if (!REDUCED) {
      const c1 = 1.70158, c3 = c1 + 1;
      sc = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(sc, sc);
    ctx.font = '700 ' + Math.round(Math.max(20, H * 0.032)) + 'px "Bebas Neue", sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = GOLD2;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/* wind speed lines at high combo */
function drawSpeedLines() {
  if (state !== states.PLAY || combo < 5) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 2;
  const n = Math.min(6, combo - 2);
  for (let i = 0; i < n; i++) {
    const seed = i * 137.5;
    const y = (seed + frame * PIPE_SPEED * 3) % (H - GROUND_H);
    const len = 40 + (i % 3) * 26;
    const x = W - ((seed * 3 + frame * PIPE_SPEED * 6) % (W + len));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- input ---------- */
function flap() {
  if (paused) return;
  initAudio();
  TG.haptic("light");
  if (state === states.OVER) reset();
  if (state === states.READY || state === states.OVER) {
    state = states.PLAY;
    overlay.classList.add("hidden");
    invuln = 36;
    if (!hintShown) hintTimer = 120;
    TG.disableVerticalSwipes();
    TG.lockOrientation();
  }
  if (state !== states.PLAY) return;
  duck.vy = FLAP_V;
  duck.targetRot = -0.62;
  duck.rotVel = -0.15; /* snappy upward kick */
  duck.sq = 1.2;
  duck.flapT = 10;
  quack();
  burst(duck.x - duck.w * 0.3, duck.y + duck.h * 0.2, GOLD, 6);
  burst(duck.x - duck.w * 0.2, duck.y + duck.h * 0.3, GOLD2, 4);
}

function handleKey(e) {
  if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); togglePause(); return; }
  if (e.code === "KeyR" || e.code === "Enter") {
    if (state === states.OVER) {
      e.preventDefault();
      reset();
      flap();
      return;
    }
  }
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    if (paused) { setPaused(false); return; }
    flap();
  }
}
function tap(e) {
  e.preventDefault();
  if (paused) { setPaused(false); return; }
  flap();
}
document.addEventListener("keydown", handleKey);
canvas.addEventListener("pointerdown", tap);
overlay.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button, a, input")) return;
  flap();
});
startBtn.addEventListener("click", (e) => { e.stopPropagation(); flap(); });

/* ---------- collision ---------- */
function hitbox() {
  const hw = duck.w * 0.22;
  const hh = duck.h * 0.22;
  return { l: duck.x - hw, r: duck.x + hw, t: duck.y - hh, b: duck.y + hh };
}

function collides() {
  const hb = hitbox();
  if (hb.t < 0) return true;
  if (hb.b > H - GROUND_H) return true;
  for (const p of pipes) {
    const gap = p.gapOverride ? PIPE_GAP + 40 : PIPE_GAP;
    const topH = p.gapY - gap / 2;
    const botY = p.gapY + gap / 2;
    const inX = hb.r > p.x && hb.l < p.x + PIPE_W;
    if (inX && (hb.t < topH || hb.b > botY)) return true;
  }
  return false;
}

/* ---------- game over ---------- */
function gameOver() {
  if (state !== states.PLAY) return;
  state = states.OVER;
  thud();
  TG.haptic("heavy");
  paused = false;
  combo = 0;
  TG.enableVerticalSwipes();
  TG.unlockOrientation();
  updateLive();
  shakeDur = REDUCED ? 0 : 24;
  duck.sq = -0.7; /* impact squash */
  if (!REDUCED) deathSlow = 1;
  burst(duck.x, duck.y, RED, REDUCED ? 10 : 18);
  burst(duck.x, duck.y, GOLD, REDUCED ? 6 : 12);
  const wasBest = score > best;
  unlockCheck(score);
  if (score > best) {
    best = score;
    localStorage.setItem("goldutya-fly-best", String(best));
    bestEl.textContent = best;
  }
  coinTotal += coinCount;
  try { localStorage.setItem("goldutya-fly-coins", String(coinTotal)); } catch (e) {}
  if (score > 0) { Leaderboard.addScore("fly", score, { combo: maxCombo, coins: coinCount, mult: multiplier }); }
  setTimeout(() => {
    if (state !== states.OVER) return;
    overlay.classList.remove("hidden");
    const duckImgEl = overlay.querySelector(".overlay-duck-img");
    if (duckImgEl) duckImgEl.src = "assets/duck-mid.png?" + Date.now();
    const sub = overlay.querySelector(".overlay-sub");
    let msg = score > 0 ? "Score: " + score : "Quack. Try again.";
    if (maxCombo > 1) msg += " | Max combo: " + maxCombo + "x";
    if (coinCount > 0) msg += " | Coins: " + coinCount;
    sub.textContent = msg;
    const medalEl = document.getElementById("medal");
    if (medalEl) {
      const m = score >= 50 ? "🥇 GOLD DUCK" : score >= 25 ? "🥈 SILVER DUCK" : score >= 10 ? "🥉 BRONZE DUCK" : "";
      medalEl.hidden = !m;
      medalEl.textContent = m;
    }
    const nbEl = document.getElementById("newBest");
    if (nbEl) nbEl.hidden = !wasBest;
    overlay.querySelector(".btn").textContent = "PLAY AGAIN";
    const shareBtn = document.getElementById("shareBtn");
    if (shareBtn) {
      shareBtn.style.display = score > 0 ? "" : "none";
      shareBtn.textContent = "SHARE SCORE";
    }
    const lbContainer = document.getElementById("leaderboard");
    if (lbContainer) Leaderboard.renderBoard(lbContainer, "fly", score);
  }, 850);
}

/* ---------- update (dtF = 1 at 60fps) ---------- */
function update(dtF) {
  frame++;
  duck.t += dtF;
  groundOff += PIPE_SPEED * 0.55 * dtF;

  if (flashA > 0) flashA = Math.max(0, flashA - 0.012 * dtF);

  if (shakeDur > 0) {
    shakeDur -= dtF;
    shakeX = (Math.random() - 0.5) * shakeDur * 1.2;
    shakeY = (Math.random() - 0.5) * shakeDur * 1.2;
  } else {
    shakeX = 0;
    shakeY = 0;
  }

  if (scoreScale > 1.01) scoreScale += (1 - scoreScale) * Math.min(1, 0.12 * dtF);

  for (const c of clouds) {
    const spd = (state === states.PLAY ? PIPE_SPEED : PIPE_SPEED * 0.25) * c.speed;
    c.x -= spd * dtF;
    if (c.x < -100) { c.x = W + 60 + Math.random() * 120; c.baseY = H * (0.05 + Math.random() * 0.45); }
  }

  if (shootT > 0) {
    shootT -= dtF;
  } else if (nightPhase > 0.5 && Math.random() < 0.0025 * dtF) {
    shootT = 20;
    shootX = W * (0.3 + Math.random() * 0.6);
    shootY = H * (0.05 + Math.random() * 0.15);
  }
  if (deathSlow > 0) deathSlow = Math.max(0, deathSlow - dtF / 54);
  shownScore += (score - shownScore) * Math.min(1, 0.25 * dtF);
  if (Math.abs(score - shownScore) < 0.05) shownScore = score;

  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.y += p.vy * dtF;
    p.age = (p.age || 0) + dtF;
    p.life -= dtF;
    if (p.life <= 0) popups.splice(i, 1);
  }

  if (hintTimer > 0) {
    hintTimer -= dtF;
    if (hintTimer <= 0 && !hintShown) {
      hintShown = true;
      localStorage.setItem("goldutya-fly-hinted", "1");
    }
  }

  duck.sq += (0 - duck.sq) * Math.min(1, 0.18 * dtF);

  if (state === states.READY) {
    duck.rot = Math.sin(duck.t * 0.12) * 0.08;
    duck.sq = Math.sin(duck.t * 0.22) * 0.05; /* idle wing flutter */
    updateParticles(dtF);
    return;
  }

  duck.vy += GRAVITY * dtF;
  duck.y += duck.vy * dtF;
  if (duck.flapT > 0) duck.flapT -= dtF;
  duck.targetRot = Math.max(-0.65, Math.min(1.25, duck.vy * 0.055));
  duck.rotVel += (duck.targetRot - duck.rot) * 0.14 * dtF;
  duck.rotVel *= Math.pow(0.80, dtF);
  duck.rot += duck.rotVel * dtF;

  if (state === states.OVER) {
    if (duck.y > H - GROUND_H - duck.h * 0.25) {
      duck.y = H - GROUND_H - duck.h * 0.25;
      duck.vy = 0;
    }
    updateParticles(dtF);
    return;
  }

  /* golden trail while rising — time-accumulated, not frame-modulo */
  if (duck.vy < 0) {
    trailAcc += dtF;
    while (trailAcc >= 3) {
      trailAcc -= 3;
      if (particles.length < MAX_PARTICLES) {
        particles.push({
          x: duck.x - duck.w * 0.3 + Math.random() * 4,
          y: duck.y + duck.h * 0.2 + Math.random() * 4,
          vx: -1.2 - Math.random() * 1.5,
          vy: 0.5 + Math.random(),
          life: 18 + Math.random() * 10,
          color: GOLD,
          r: 2 + Math.random() * 2,
          feather: true,
          rot: Math.random() * Math.PI * 2,
          rotV: (Math.random() - 0.5) * 0.2,
        });
      }
    }
  } else {
    trailAcc = 0;
  }

  if (comboTimer > 0) {
    comboTimer -= dtF;
    if (comboTimer <= 0) combo = 0;
  }

  const nightTarget = nightDir === 1 ? 1 : 0;
  nightPhase += (nightTarget - nightPhase) * Math.min(1, 0.02 * dtF);
  if (nightDir !== 0) {
    nightTimer -= dtF;
    if (nightTimer <= 0) {
      if (nightDir === 1) { nightDir = -1; nightTimer = 90; }
      else { nightDir = 0; }
    }
  }

  playFrame += dtF;
  if (invuln > 0) invuln -= dtF;

  if (pipes.length === 0 && playFrame >= 70) spawnPipe();
  const last = pipes[pipes.length - 1];
  if (last && last.x < W - PIPE_SPACING) spawnPipe();

  for (const p of pipes) p.x -= PIPE_SPEED * dtF;
  pipes = pipes.filter((p) => p.x + PIPE_W > -20);

  /* coins + shield orbs (with pickup magnet) */
  for (const c of coins) {
    c.x -= PIPE_SPEED * dtF;
    c.spin += 0.12 * dtF;
    if (!c.got) {
      const dx = c.x - duck.x, dy = c.y - duck.y;
      if (Math.abs(dx) < 70 && Math.abs(dy) < 90) {
        c.x -= dx * 0.25 * dtF;
        c.y -= dy * 0.25 * dtF;
      }
      if (Math.abs(c.x - duck.x) < duck.w * 0.35 + 12 && Math.abs(c.y - duck.y) < duck.h * 0.35 + 12) {
        c.got = true;
        coinCount++;
        score += 2;
        shownScore = score;
        scoreBlip();
        TG.haptic("light");
        burst(c.x, c.y, GOLD2, 8);
        popups.push({ x: c.x, y: c.y - 22, text: "+2", life: 40, vy: -1.2, age: 0 });
        updateLive();
      }
    }
  }
  coins = coins.filter((c) => !c.got && c.x > -30);
  for (const s of shields) {
    s.x -= PIPE_SPEED * dtF;
    if (!s.got) {
      const dx = s.x - duck.x, dy = s.y - duck.y;
      if (Math.abs(dx) < 80 && Math.abs(dy) < 100) {
        s.x -= dx * 0.22 * dtF;
        s.y -= dy * 0.22 * dtF;
      }
      if (Math.abs(s.x - duck.x) < duck.w * 0.35 + 16 && Math.abs(s.y - duck.y) < duck.h * 0.35 + 16) {
        s.got = true;
        shield = true;
        comboBlip(8);
        TG.haptic("success");
        burst(s.x, s.y, "#56D9FF", 12);
        popups.push({ x: s.x, y: s.y - 26, text: "SHIELD UP", life: 48, vy: -1.2, age: 0 });
      }
    }
  }
  shields = shields.filter((s) => !s.got && s.x > -40);

  for (const p of pipes) {
    if (!p.scored && p.x + PIPE_W < duck.x) {
      p.scored = true;
      score++;
      pipeCount++;
      combo++;
      comboTimer = Math.max(90, (PIPE_SPACING / PIPE_SPEED) * 1.3);
      if (combo > maxCombo) maxCombo = combo;
      multiplier = Math.min(5, 1 + Math.floor(combo / 5));
      const pts = multiplier;
      score += pts - 1;
      const pgap = p.gapOverride ? PIPE_GAP + 40 : PIPE_GAP;
      const clr = Math.min(duck.y - (p.gapY - pgap / 2), (p.gapY + pgap / 2) - duck.y);
      if (clr < duck.h * 0.55) {
        score += 2;
        if (flashA < 0.12) flashA = 0.12;
        popups.push({ x: duck.x + 10, y: duck.y - 48, text: "PERFECT +2", life: 46, vy: -1.2, age: 0 });
      }
      scoreScale = 1.4;
      TG.haptic("light");
      if (combo >= 3) comboBlip(combo);
      else scoreBlip();
      burst(duck.x + 16, duck.y - 18, GOLD2, 7);
      popups.push({ x: duck.x + 24, y: duck.y - 26, text: "+" + pts, life: 42, vy: -1.3 });
      if (combo > 0 && combo % 3 === 0) flashA = 0.16;
      if (score > 0 && score % 10 === 0) {
        burst(W / 2, H * 0.35, GOLD2, 24);
        burst(W / 2, H * 0.35, "#56D9FF", 16);
        popups.push({ x: W / 2, y: H * 0.32, text: score + " POINTS! 🎉", life: 60, vy: -0.9, age: 0 });
        TG.haptic("heavy");
      }
      if (pipeCount > 0 && pipeCount % 10 === 0) {
        PIPE_GAP = Math.max(H * 0.24, PIPE_GAP - 3);
        PIPE_SPEED = Math.min(PIPE_SPEED + 0.1, (W * 0.006) * 2);
        PIPE_SPACING = Math.max(W * 0.55, PIPE_SPACING - 4);
        popups.push({ x: W / 2, y: H * 0.28, text: "SPEED UP", life: 54, vy: -0.8, age: 0 });
      }
      updateLive();
    }
  }

  updateParticles(dtF);

  if (invuln <= 0 && collides()) {
    if (shield) {
      shield = false;
      invuln = 70;
      shakeDur = REDUCED ? 0 : 16;
      thud();
      TG.haptic("medium");
      burst(duck.x, duck.y, "#56D9FF", 16);
      popups.push({ x: duck.x, y: duck.y - 34, text: "SHIELD SAVED YOU", life: 52, vy: -1, age: 0 });
    } else {
      gameOver();
    }
  }
}

/* ---------- hint ---------- */
function drawHint() {
  if (hintShown || hintTimer <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, hintTimer / 30);
  ctx.font = '700 ' + Math.round(H * 0.04) + 'px "Bebas Neue", sans-serif';
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText("TAP TO FLAP", W / 2, H / 2);
  ctx.restore();
}

/* ---------- live region + pause ---------- */
function updateLive() {
  const el = document.getElementById("liveScore");
  if (el) el.textContent = "Score " + score;
}

function setPaused(v) {
  if (v && state !== states.PLAY) return;
  paused = !!v;
  if (paused) {
    TG.enableVerticalSwipes();
    TG.unlockOrientation();
  } else if (state === states.PLAY) {
    TG.disableVerticalSwipes();
    TG.lockOrientation();
  }
}

function togglePause() {
  if (state !== states.PLAY) return;
  setPaused(!paused);
  TG.haptic("light");
}

function drawPaused() {
  ctx.save();
  ctx.fillStyle = "rgba(6,8,12,0.72)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = GOLD;
  ctx.font = '700 ' + Math.round(H * 0.06) + 'px "Bebas Neue", sans-serif';
  ctx.fillText("PAUSED", W / 2, H * 0.44);
  ctx.fillStyle = "#fff";
  ctx.font = '700 ' + Math.round(H * 0.02) + 'px "Space Mono", monospace';
  ctx.fillText("TAP OR PRESS P TO RESUME", W / 2, H * 0.52);
  ctx.restore();
}

/* ---------- HUD ---------- */
function drawScore() {
  if (state === states.READY) return;
  const size = Math.max(42, Math.round(H * 0.07)) * scoreScale;
  const sy = Math.max(72, H * 0.13);
  ctx.save();
  ctx.font = "700 " + Math.round(size) + 'px "Bebas Neue", sans-serif';
  ctx.textAlign = "center";
  ctx.lineWidth = Math.max(4, size * 0.1);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(String(Math.round(shownScore)), W / 2, sy);
  ctx.fillStyle = GOLD;
  ctx.fillText(String(Math.round(shownScore)), W / 2, sy);
  if (combo >= 3) {
    const cs = Math.round(size * 0.48);
    ctx.font = "700 " + cs + 'px "Bebas Neue", sans-serif';
    ctx.fillStyle = GOLD2;
    ctx.fillText("COMBO x" + combo + (multiplier > 1 ? " · " + multiplier + "× PTS" : ""), W / 2, sy + size * 0.65);
  }
  if (state === states.PLAY && combo > 0) {
    const mw = Math.max(90, W * 0.28);
    const mx = W / 2 - mw / 2;
    const my = sy + size * 0.8;
    const frac = multiplier >= 5 ? 1 : (combo % 5) / 5;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(mx, my, mw, 5);
    ctx.fillStyle = multiplier >= 5 ? GOLD2 : GOLD;
    ctx.fillRect(mx, my, mw * frac, 5);
  }
  if (state === states.PLAY && coinCount > 0) {
    ctx.drawImage(getCoinTile(), W - 64, sy - 46, 16, 16);
    ctx.font = '700 18px "Bebas Neue", sans-serif';
    ctx.textAlign = "left";
    ctx.fillStyle = GOLD2;
    ctx.fillText("x" + coinCount, W - 44, sy - 33);
  }
  ctx.restore();
}

/* ---------- render ---------- */
function render() {
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.translate(shakeX, shakeY);
  if (deathSlow > 0) {
    const z = 1 + 0.12 * deathSlow;
    ctx.translate(duck.x, duck.y);
    ctx.scale(z, z);
    ctx.translate(-duck.x, -duck.y);
  }
  drawSky();
  drawHills();
  drawPipes();
  drawCoins();
  drawShieldOrbs();
  drawGround();
  drawSpeedLines();
  drawParticles();
  drawPopups();
  drawDuck();
  drawHint();
  drawScore();
  if (paused) drawPaused();
  if (flashA > 0) {
    ctx.fillStyle = "rgba(245,197,24," + flashA + ")";
    ctx.fillRect(-10, -10, W + 20, H + 20);
  }
  if (deathSlow > 0) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(120,0,0," + (0.35 * deathSlow).toFixed(3) + ")");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

let lastT = 0;
function loop(t) {
  if (!lastT) lastT = t;
  const dtMs = Math.min(50, t - lastT); /* clamp: tab-switch safe */
  lastT = t;
  const ts = (state === states.OVER && !REDUCED) ? (1 - 0.65 * deathSlow) : 1;
  if (!paused) update((dtMs / 16.6667) * ts);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
document.addEventListener("pointerdown", initAudio, { once: true });
updateSkinUI();
const muteBtn = document.getElementById("muteBtn");
if (muteBtn) muteBtn.innerHTML = muteOn ? '<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#volume-off"/></svg>' : '<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#volume-on"/></svg>';
if (muteBtn) muteBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleMute(); });
const shareBtn = document.getElementById("shareBtn");
if (shareBtn) shareBtn.addEventListener("click", (e) => { e.stopPropagation(); shareScore(); });
const pauseBtn = document.getElementById("pauseBtn");
if (pauseBtn) pauseBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePause(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === states.PLAY && !paused) setPaused(true);
});
if (typeof TG !== "undefined" && TG.onDeactivated) {
  TG.onDeactivated(() => { if (state === states.PLAY && !paused) setPaused(true); });
}
if (typeof TG !== "undefined" && TG.onViewportChange) {
  TG.onViewportChange(() => {
    if (state === states.PLAY && !paused) setPaused(true);
    fitCanvas();
  });
}
if (typeof Difficulty !== "undefined") {
  Difficulty.renderPicker(document.getElementById("diffPicker"), "fly", () => { fitCanvas(); reset(); });
}
