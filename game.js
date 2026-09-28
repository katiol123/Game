'use strict';

/* =========================================================
 *  Три в ряд — ИИ против ИИ
 * ========================================================= */

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const MOVES_PER_PLAYER = 20;

// [светлый, основной, тёмный]
const GEM_COLORS = [
  ['#ffb3b3', '#f0304a', '#7a0c1a'], // рубин — круг
  ['#ffe0a8', '#ff8c1a', '#8a3b00'], // янтарь — квадрат
  ['#fffbc2', '#ffd21f', '#8a6a00'], // топаз — звезда
  ['#c2ffcc', '#22c55e', '#0b5a2a'], // изумруд — ромб
  ['#bfe6ff', '#2f86ff', '#0b2f7a'], // сапфир — шестиугольник
  ['#ecc6ff', '#a347ff', '#4a1080'], // аметист — треугольник
];

const $ = (id) => document.getElementById(id);
const rand = (n) => Math.floor(Math.random() * n);

/* ---------------------------------------------------------
 *  Easing
 * ------------------------------------------------------- */
const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
};

/* ---------------------------------------------------------
 *  Игровые часы и твины (учитывают паузу и скорость)
 * ------------------------------------------------------- */
let clock = 0;
let speed = 1;
let paused = false;
let tweens = [];

function tween(dur, fn, { delay = 0, easing = ease.linear } = {}) {
  return new Promise((resolve) => {
    fn(0, 0);
    tweens.push({ start: clock + delay, dur: Math.max(1, dur), fn, easing, resolve });
  });
}
const sleep = (ms) => tween(ms, () => {});

function updateTweens() {
  const done = [];
  tweens = tweens.filter((tw) => {
    if (clock < tw.start) return true;
    const t = Math.min(1, (clock - tw.start) / tw.dur);
    tw.fn(tw.easing(t), t);
    if (t >= 1) { done.push(tw.resolve); return false; }
    return true;
  });
  done.forEach((r) => r());
}

/* ---------------------------------------------------------
 *  Чистая логика поля (сетка типов, -1 = пусто)
 * ------------------------------------------------------- */
function findMatches(g) {
  const groups = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const t = g[r][c];
      let e = c + 1;
      if (t >= 0) while (e < COLS && g[r][e] === t) e++;
      if (t >= 0 && e - c >= 3) {
        const cells = [];
        for (let k = c; k < e; k++) cells.push([r, k]);
        groups.push({ cells, len: e - c, type: t });
      }
      c = e;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const t = g[r][c];
      let e = r + 1;
      if (t >= 0) while (e < ROWS && g[e][c] === t) e++;
      if (t >= 0 && e - r >= 3) {
        const cells = [];
        for (let k = r; k < e; k++) cells.push([k, c]);
        groups.push({ cells, len: e - r, type: t });
      }
      r = e;
    }
  }
  const set = new Set();
  groups.forEach((gr) => gr.cells.forEach(([r, c]) => set.add(r * COLS + c)));
  return { groups, set };
}

function scoreGroups(groups, combo) {
  let s = 0;
  for (const g of groups) s += g.len * 10 + (g.len === 4 ? 20 : g.len >= 5 ? 60 : 0);
  return s * combo;
}

function matchAt(g, r, c) {
  const t = g[r][c];
  if (t < 0) return false;
  let h = 1, v = 1;
  for (let k = c - 1; k >= 0 && g[r][k] === t; k--) h++;
  for (let k = c + 1; k < COLS && g[r][k] === t; k++) h++;
  for (let k = r - 1; k >= 0 && g[k][c] === t; k--) v++;
  for (let k = r + 1; k < ROWS && g[k][c] === t; k++) v++;
  return h >= 3 || v >= 3;
}

function applyMove(g, m) {
  const h = g.map((row) => row.slice());
  const tmp = h[m.r1][m.c1];
  h[m.r1][m.c1] = h[m.r2][m.c2];
  h[m.r2][m.c2] = tmp;
  return h;
}

function listMoves(g) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        if (g[r][c] < 0 || g[r2][c2] < 0 || g[r][c] === g[r2][c2]) continue;
        const m = { r1: r, c1: c, r2, c2 };
        const h = applyMove(g, m);
        if (matchAt(h, r, c) || matchAt(h, r2, c2)) moves.push(m);
      }
    }
  }
  return moves;
}

function collapse(h) {
  for (let c = 0; c < COLS; c++) {
    let w = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (h[r][c] >= 0) { h[w][c] = h[r][c]; w--; }
    }
    for (; w >= 0; w--) h[w][c] = -1;
  }
}

// Симуляция хода с каскадами (новые фишки неизвестны → -1)
function simulate(g, m) {
  const h = applyMove(g, m);
  let score = 0, combo = 0, cleared = 0;
  for (;;) {
    const { groups, set } = findMatches(h);
    if (!groups.length) break;
    combo++;
    score += scoreGroups(groups, combo);
    cleared += set.size;
    for (const i of set) h[(i / COLS) | 0][i % COLS] = -1;
    collapse(h);
  }
  return { score, combo, cleared, grid: h };
}

function bestImmediate(g) {
  let best = 0;
  for (const m of listMoves(g)) best = Math.max(best, simulate(g, m).score);
  return best;
}

function randomGrid() {
  for (;;) {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      g.push([]);
      for (let c = 0; c < COLS; c++) {
        let t;
        do t = rand(TYPES);
        while ((c >= 2 && g[r][c - 1] === t && g[r][c - 2] === t) ||
               (r >= 2 && g[r - 1][c] === t && g[r - 2][c] === t));
        g[r].push(t);
      }
    }
    if (listMoves(g).length >= 3) return g;
  }
}

/* ---------------------------------------------------------
 *  ИИ-игроки
 * ------------------------------------------------------- */
const AIS = [
  {
    name: 'Нова',
    avatar: '⚡',
    style: 'Жадный',
    color: '#ff5fa2',
    // Берёт ход с максимальной немедленной выгодой (с учётом каскадов)
    choose(g) {
      let best = null, bv = -Infinity;
      for (const m of listMoves(g)) {
        const s = simulate(g, m);
        const v = s.score + (s.combo > 1 ? 10 : 0) + Math.random() * 12;
        if (v > bv) { bv = v; best = { ...m, sim: s }; }
      }
      return best;
    },
  },
  {
    name: 'Орион',
    avatar: '🧠',
    style: 'Стратег',
    color: '#4fd1ff',
    // Смотрит на ход вперёд: своя выгода минус лучший ответ соперника
    choose(g) {
      let best = null, bv = -Infinity;
      for (const m of listMoves(g)) {
        const s = simulate(g, m);
        const opp = bestImmediate(s.grid);
        const low = (Math.max(m.r1, m.r2) / (ROWS - 1)) * 8; // ходы внизу чаще дают каскады
        const v = s.score - 0.65 * opp + low + Math.random() * 6;
        if (v > bv) { bv = v; best = { ...m, sim: s }; }
      }
      return best;
    },
  },
];

/* ---------------------------------------------------------
 *  Графика: канвас, спрайты камней
 * ------------------------------------------------------- */
const canvas = $('board');
const ctx = canvas.getContext('2d');
let size = 560, pad = 16, cell = 66, dpr = 1;
let sprites = [];

function shapePath(c, t, r) {
  c.beginPath();
  switch (t) {
    case 0: c.arc(0, 0, r * 0.95, 0, Math.PI * 2); break;
    case 1: {
      const s = r * 0.82, k = r * 0.3;
      c.moveTo(-s + k, -s);
      c.arcTo(s, -s, s, s, k); c.arcTo(s, s, -s, s, k);
      c.arcTo(-s, s, -s, -s, k); c.arcTo(-s, -s, s, -s, k);
      break;
    }
    case 2:
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.5 : r * 1.05;
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr + r * 0.05);
      }
      break;
    case 3:
      c.moveTo(0, -r * 1.05); c.lineTo(r * 0.82, 0); c.lineTo(0, r * 1.05); c.lineTo(-r * 0.82, 0);
      break;
    case 4:
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        c.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
      }
      break;
    case 5:
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        c.lineTo(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12 + r * 0.16);
      }
      break;
  }
  c.closePath();
}

function buildSprite(t) {
  const [light, main, dark] = GEM_COLORS[t];
  const sz = cell * 1.2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(sz * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  c.translate(sz / 2, sz / 2);
  c.lineJoin = 'round';
  const r = cell * 0.38;

  // тень
  c.save();
  c.translate(0, r * 0.14);
  shapePath(c, t, r);
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = r * 0.35;
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.fill();
  c.restore();

  // тело
  shapePath(c, t, r);
  const grd = c.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, 0, 0, r * 1.25);
  grd.addColorStop(0, light);
  grd.addColorStop(0.45, main);
  grd.addColorStop(1, dark);
  c.fillStyle = grd;
  c.fill();
  c.lineWidth = r * 0.08;
  c.strokeStyle = dark;
  c.stroke();

  // внутренняя грань
  c.save();
  shapePath(c, t, r * 0.6);
  const inner = c.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
  inner.addColorStop(0, 'rgba(255,255,255,0.35)');
  inner.addColorStop(1, 'rgba(255,255,255,0.02)');
  c.fillStyle = inner;
  c.fill();
  c.lineWidth = r * 0.04;
  c.strokeStyle = 'rgba(255,255,255,0.3)';
  c.stroke();
  c.restore();

  // блик
  c.save();
  shapePath(c, t, r);
  c.clip();
  c.beginPath();
  c.ellipse(-r * 0.2, -r * 0.6, r * 0.75, r * 0.36, -0.35, 0, Math.PI * 2);
  const gl = c.createLinearGradient(0, -r, 0, -r * 0.2);
  gl.addColorStop(0, 'rgba(255,255,255,0.7)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gl;
  c.fill();
  c.restore();

  c.beginPath();
  c.arc(-r * 0.36, -r * 0.4, r * 0.09, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.95)';
  c.fill();

  return { cv, sz };
}

function resize() {
  const wrap = $('boardWrap');
  size = Math.floor(Math.max(260, Math.min(wrap.clientWidth, window.innerHeight * 0.72, 600)));
  dpr = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = size + 'px';
  canvas.width = canvas.height = Math.round(size * dpr);
  pad = size * 0.03;
  cell = (size - pad * 2) / COLS;
  sprites = [];
  for (let t = 0; t < TYPES; t++) sprites.push(buildSprite(t));
}

const px = (x) => pad + (x + 0.5) * cell;

/* ---------------------------------------------------------
 *  Состояние игры
 * ------------------------------------------------------- */
let board = [];          // board[r][c] = gem | null
const gems = new Set();  // все отрисовываемые камни
let particles = [];
let floaters = [];
let hint = null;
let gemId = 0;

let gameId = 0;
let players = [];
let turn = 0;

function makeGem(t, r, c) {
  const g = { id: gemId++, t, x: c, y: r, s: 1, a: 1, rot: 0, flash: 0, sx: 1, sy: 1, z: 0 };
  gems.add(g);
  return g;
}

const typesGrid = () => board.map((row) => row.map((g) => (g ? g.t : -1)));

/* ---------------------------------------------------------
 *  Частицы и всплывающий текст
 * ------------------------------------------------------- */
function burst(g) {
  const cx = px(g.x), cy = px(g.y);
  const col = GEM_COLORS[g.t];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = cell * (2 + Math.random() * 4);
    particles.push({
      kind: 'spark', x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cell * 2,
      life: 0.6 + Math.random() * 0.5, max: 1.1,
      color: col[i % 2 ? 0 : 1], size: cell * (0.05 + Math.random() * 0.07),
    });
  }
  particles.push({ kind: 'ring', x: cx, y: cy, life: 0.45, max: 0.45, color: col[0], size: cell * 0.9 });
}

function trail(g) {
  const col = GEM_COLORS[g.t];
  particles.push({
    kind: 'spark', x: px(g.x) + (Math.random() - 0.5) * cell * 0.4, y: px(g.y) + (Math.random() - 0.5) * cell * 0.4,
    vx: 0, vy: -cell * 0.5, life: 0.35, max: 0.35, color: col[0], size: cell * 0.05,
  });
}

function floatText(x, y, text, color, big = false) {
  floaters.push({ x, y, text, color, life: 1.2, max: 1.2, size: cell * (big ? 0.6 : 0.45) });
}

function updateParticles(dt) {
  const G = cell * 14;
  particles = particles.filter((p) => {
    p.life -= dt;
    if (p.kind === 'spark') {
      p.vy += G * dt;
      p.vx *= 0.98;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    return p.life > 0;
  });
  floaters = floaters.filter((f) => {
    f.life -= dt;
    f.y -= cell * 0.9 * dt;
    return f.life > 0;
  });
}

/* ---------------------------------------------------------
 *  Отрисовка
 * ------------------------------------------------------- */
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawBoard() {
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#1d1850');
  bg.addColorStop(1, '#120f33');
  roundRect(ctx, 0, 0, size, size, 18);
  ctx.fillStyle = bg;
  ctx.fill();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      roundRect(ctx, pad + c * cell + 2, pad + r * cell + 2, cell - 4, cell - 4, cell * 0.16);
      ctx.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.085)';
      ctx.fill();
    }
  }
}

function drawHint() {
  if (!hint) return;
  const pulse = 0.5 + 0.5 * Math.sin(clock / 90);
  ctx.save();
  ctx.shadowColor = hint.color;
  ctx.shadowBlur = 12 + pulse * 18;
  ctx.strokeStyle = hint.color;
  ctx.lineWidth = 3 + pulse * 2;
  for (const [r, c] of [[hint.r1, hint.c1], [hint.r2, hint.c2]]) {
    roundRect(ctx, pad + c * cell + 3, pad + r * cell + 3, cell - 6, cell - 6, cell * 0.18);
    ctx.stroke();
    ctx.fillStyle = hint.color + '22';
    ctx.fill();
  }
  ctx.restore();
}

function drawGem(g) {
  const sp = sprites[g.t];
  const r = cell * 0.38;
  ctx.save();
  // сплющивание привязано к низу камня
  ctx.translate(px(g.x), px(g.y) + (1 - g.sy) * r * g.s);
  ctx.rotate(g.rot);
  ctx.scale(g.s * g.sx, g.s * g.sy);
  ctx.globalAlpha = Math.max(0, Math.min(1, g.a));
  ctx.drawImage(sp.cv, -sp.sz / 2, -sp.sz / 2, sp.sz, sp.sz);
  if (g.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, g.a * g.flash);
    ctx.drawImage(sp.cv, -sp.sz / 2, -sp.sz / 2, sp.sz, sp.sz);
  }
  // мерцающая искорка
  const ph = ((clock / 1000) * 0.7 + g.id * 0.37) % 5;
  if (ph < 0.6 && g.flash === 0) {
    const k = Math.sin((ph / 0.6) * Math.PI);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k * g.a;
    ctx.fillStyle = '#fff';
    const cx = r * 0.3, cy = -r * 0.35, s = r * 0.35 * k;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.quadraticCurveTo(cx, cy, cx + s, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + s); ctx.quadraticCurveTo(cx, cy, cx - s, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - s);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const k = p.life / p.max;
    if (p.kind === 'spark') {
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = k * 0.8;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = cell * 0.08 * k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - k) + cell * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of floaters) {
    const k = f.life / f.max;
    const pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.font = `900 ${f.size * pop}px "Segoe UI", system-ui, sans-serif`;
    ctx.lineWidth = f.size * 0.18;
    ctx.strokeStyle = 'rgba(10,6,30,0.85)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  drawBoard();
  drawHint();

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, size - pad * 2, size - pad * 2);
  ctx.clip();
  const list = [...gems].sort((a, b) => a.z - b.z);
  for (const g of list) drawGem(g);
  ctx.restore();

  drawParticles();
}

/* ---------------------------------------------------------
 *  Анимации
 * ------------------------------------------------------- */
function animateSwap(m) {
  const a = board[m.r1][m.c1], b = board[m.r2][m.c2];
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
  const dx = bx - ax, dy = by - ay;
  a.z = 2; b.z = 1;
  return tween(300, (e, t) => {
    const arc = Math.sin(Math.PI * t) * 0.25;
    a.x = ax + dx * e - dy * arc; a.y = ay + dy * e + dx * arc;
    b.x = bx - dx * e + dy * arc; b.y = by - dy * e - dx * arc;
    a.s = 1 + 0.2 * Math.sin(Math.PI * t);
    b.s = 1 - 0.15 * Math.sin(Math.PI * t);
    if (t > 0 && t < 1 && Math.random() < 0.6) { trail(a); trail(b); }
  }, { easing: ease.inOutCubic }).then(() => {
    board[m.r1][m.c1] = b; board[m.r2][m.c2] = a;
    a.x = bx; a.y = by; b.x = ax; b.y = ay;
    a.s = b.s = 1; a.z = b.z = 0;
  });
}

function animateClear(set) {
  const ps = [];
  for (const i of set) {
    const r = (i / COLS) | 0, c = i % COLS;
    const g = board[r][c];
    board[r][c] = null;
    g.z = 3;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random());
    let popped = false;
    ps.push(tween(440, (e, t) => {
      if (t < 0.28) {
        const k = t / 0.28;
        g.s = 1 + 0.3 * ease.outCubic(k);
        g.flash = k * 0.9;
      } else {
        if (!popped) { popped = true; burst(g); }
        const k = (t - 0.28) / 0.72;
        g.s = 1.3 * (1 - ease.inBack(k));
        g.a = 1 - k * k;
        g.rot = k * spin;
        g.flash = 0.9 * (1 - k);
      }
    }).then(() => gems.delete(g)));
  }
  return Promise.all(ps);
}

function fallGem(g, toY, delay, spawn) {
  const fromY = g.y;
  const dist = Math.max(0.2, toY - fromY);
  const dur = 120 + 120 * Math.sqrt(dist);
  if (spawn) { g.a = 0; g.s = 0.6; }
  return tween(dur, (e) => {
    g.y = fromY + (toY - fromY) * e;
    if (spawn) { g.a = Math.min(1, e * 2.2); g.s = 0.6 + 0.4 * Math.min(1, e * 1.6); }
    g.sx = 1 - 0.1 * e;
    g.sy = 1 + 0.12 * e;
  }, { delay, easing: ease.inQuad }).then(() => tween(300, (e, t) => {
    const w = Math.cos(t * Math.PI * 3) * (1 - t);
    g.y = toY - Math.max(0, Math.sin(t * Math.PI * 2)) * 0.08 * (1 - t);
    g.sx = 1 + 0.18 * w;
    g.sy = 1 - 0.18 * w;
    g.a = 1; g.s = 1;
  })).then(() => { g.y = toY; g.sx = g.sy = 1; });
}

function animateGravity() {
  const ps = [];
  for (let c = 0; c < COLS; c++) {
    let w = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const g = board[r][c];
      if (!g) continue;
      if (w !== r) {
        board[w][c] = g;
        board[r][c] = null;
        ps.push(fallGem(g, w, c * 18, false));
      }
      w--;
    }
    const n = w + 1;
    for (let r = w; r >= 0; r--) {
      const g = makeGem(rand(TYPES), r, c);
      g.y = r - n - 0.4;
      board[r][c] = g;
      ps.push(fallGem(g, r, c * 18 + 60, true));
    }
  }
  return Promise.all(ps);
}

function animateIntro() {
  const g = randomGrid();
  board = [];
  const ps = [];
  for (let r = 0; r < ROWS; r++) {
    board.push([]);
    for (let c = 0; c < COLS; c++) {
      const gem = makeGem(g[r][c], r, c);
      gem.y = r - ROWS - 0.5;
      board[r].push(gem);
      ps.push(fallGem(gem, r, c * 55 + (ROWS - 1 - r) * 35, true));
    }
  }
  return Promise.all(ps);
}

function animateOutro() {
  const ps = [];
  for (const g of gems) {
    const d = (g.x + g.y) * 25;
    const sx = g.s, sa = g.a;
    ps.push(tween(380, (e) => {
      g.s = sx * (1 - e);
      g.a = sa * (1 - e);
      g.rot = e * 3;
    }, { delay: d, easing: ease.inBack }).then(() => gems.delete(g)));
  }
  return Promise.all(ps);
}

function animateShuffle() {
  const list = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) list.push(board[r][c]);
  // ищем перестановку без готовых совпадений и с доступными ходами
  let arrangement = null;
  for (let tries = 0; tries < 200 && !arrangement; tries++) {
    const p = list.slice().sort(() => Math.random() - 0.5);
    const g = [];
    for (let r = 0; r < ROWS; r++) g.push(p.slice(r * COLS, r * COLS + COLS).map((x) => x.t));
    if (!findMatches(g).groups.length && listMoves(g).length) arrangement = p;
  }
  if (!arrangement) {
    // крайне редкий случай — перекрашиваем камни
    const g = randomGrid();
    arrangement = list;
    list.forEach((gem, i) => { gem.t = g[(i / COLS) | 0][i % COLS]; });
  }
  const ps = [];
  arrangement.forEach((gem, i) => {
    const r = (i / COLS) | 0, c = i % COLS;
    board[r][c] = gem;
    const fx = gem.x, fy = gem.y;
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    ps.push(tween(900, (e, t) => {
      // сначала стягиваемся к центру, затем разлетаемся по новым местам
      const pull = Math.sin(Math.PI * t) * 0.55;
      const bx = fx + (c - fx) * e, by = fy + (r - fy) * e;
      gem.x = bx + (cx - bx) * pull;
      gem.y = by + (cy - by) * pull;
      gem.rot = t * Math.PI * 2;
      gem.s = 1 - 0.45 * Math.sin(Math.PI * t);
    }, { delay: i * 6, easing: ease.inOutCubic }).then(() => { gem.x = c; gem.y = r; gem.rot = 0; gem.s = 1; }));
  });
  return Promise.all(ps);
}

/* ---------------------------------------------------------
 *  UI
 * ------------------------------------------------------- */
function banner(text, color = '#ffd21f') {
  const b = $('banner');
  b.textContent = text;
  b.style.setProperty('--bc', color);
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

function log(html, color) {
  const li = document.createElement('li');
  li.innerHTML = html;
  li.style.setProperty('--lc', color);
  const ul = $('log');
  ul.prepend(li);
  while (ul.children.length > 5) ul.lastChild.remove();
}

function setupPlayerCards() {
  players.forEach((p, i) => {
    const el = $('p' + i);
    el.querySelector('.avatar').textContent = p.ai.avatar;
    el.querySelector('.name').textContent = p.ai.name;
    el.querySelector('.style').textContent = p.ai.style;
    p.el = el;
  });
}

function updateUI() {
  players.forEach((p, i) => {
    const el = p.el;
    el.classList.toggle('active', i === turn);
    el.querySelector('.moves').textContent = p.movesLeft;
    el.querySelector('.combo').textContent = p.maxCombo;
  });
  const done = players.reduce((s, p) => s + (MOVES_PER_PLAYER - p.movesLeft), 0);
  $('round').textContent = `Ход ${Math.min(MOVES_PER_PLAYER, Math.floor(done / 2) + 1)} / ${MOVES_PER_PLAYER}`;
}

function setThinking(i, on) {
  players[i].el.querySelector('.thinking').classList.toggle('on', on);
}

function tickScores(dt) {
  for (const p of players) {
    if (p.shown === p.score) continue;
    const diff = p.score - p.shown;
    p.shown += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
    if ((diff > 0 && p.shown > p.score) || (diff < 0 && p.shown < p.score)) p.shown = p.score;
    p.el.querySelector('.score').textContent = p.shown;
  }
}

function bumpScore(p) {
  const s = p.el.querySelector('.score');
  s.classList.remove('bump');
  void s.offsetWidth;
  s.classList.add('bump');
}

/* ---------------------------------------------------------
 *  Игровой цикл
 * ------------------------------------------------------- */
async function resolveBoard(p) {
  let combo = 0, total = 0;
  for (;;) {
    const { groups, set } = findMatches(typesGrid());
    if (!groups.length) break;
    combo++;
    const pts = scoreGroups(groups, combo);
    total += pts;
    p.score += pts;
    bumpScore(p);

    let sx = 0, sy = 0;
    for (const i of set) { sx += px(i % COLS); sy += px((i / COLS) | 0); }
    floatText(sx / set.size, sy / set.size, '+' + pts, combo > 1 ? '#fff38a' : '#ffffff', combo > 1);
    if (combo >= 2) banner(`Комбо ×${combo}!`, p.ai.color);
    else if (groups.some((g) => g.len >= 5)) banner('Потрясающе!', p.ai.color);
    else if (groups.some((g) => g.len === 4)) banner('Отлично!', p.ai.color);

    await animateClear(set);
    await animateGravity();
  }
  p.maxCombo = Math.max(p.maxCombo, combo);
  return { combo, total };
}

async function runGame(id) {
  for (;;) {
    if (id !== gameId) return;
    if (players.every((p) => p.movesLeft === 0)) { await endGame(id); return; }

    const p = players[turn];
    updateUI();
    setThinking(turn, true);
    await sleep(550);
    if (id !== gameId) return;

    const move = p.ai.choose(typesGrid());
    setThinking(turn, false);
    if (!move) {
      banner('Нет ходов — перемешиваем!', '#a347ff');
      await animateShuffle();
      continue;
    }

    hint = { ...move, color: p.ai.color };
    await sleep(500);
    hint = null;

    await animateSwap(move);
    const res = await resolveBoard(p);
    if (res.combo === 0) await animateSwap(move); // на всякий случай — возврат

    p.movesLeft--;
    const coord = (r, c) => `${String.fromCharCode(65 + c)}${ROWS - r}`;
    log(`<b>${p.ai.name}</b>: ${coord(move.r1, move.c1)} ⇄ ${coord(move.r2, move.c2)} — +${res.total}` +
        (res.combo > 1 ? ` (комбо ×${res.combo})` : ''), p.ai.color);

    turn = 1 - turn;
    updateUI();

    if (!listMoves(typesGrid()).length) {
      banner('Нет ходов — перемешиваем!', '#a347ff');
      await animateShuffle();
    }
  }
}

async function endGame(id) {
  players.forEach((p) => p.el.classList.remove('active'));
  const [a, b] = players;
  const text = a.score === b.score ? 'Ничья!' : `Победил ${(a.score > b.score ? a : b).ai.name}!`;
  $('winnerText').textContent = text;
  $('finalScores').textContent = `${a.ai.name} ${a.score} : ${b.score} ${b.ai.name}`;
  $('overlay').classList.add('show');
  const w = a.score >= b.score ? a : b;
  for (let i = 0; i < 20; i++) {
    const gx = rand(COLS), gy = rand(ROWS);
    if (board[gy] && board[gy][gx]) burst(board[gy][gx]);
  }
  banner(text, w.ai.color);
  for (let s = 8; s > 0; s--) {
    $('countdown').textContent = `Новая партия через ${s}…`;
    await sleep(1000);
    if (id !== gameId) return;
  }
  newGame();
}

async function newGame() {
  const id = ++gameId;
  tweens = [];            // прерываем все текущие анимации предыдущей партии
  hint = null;
  $('overlay').classList.remove('show');

  players = AIS.map((ai) => ({ ai, score: 0, shown: 0, movesLeft: MOVES_PER_PLAYER, maxCombo: 0 }));
  setupPlayerCards();
  players.forEach((p) => (p.el.querySelector('.score').textContent = '0'));
  turn = rand(2);
  updateUI();
  $('log').innerHTML = '';

  if (gems.size) {
    for (const g of gems) { g.z = 0; g.flash = 0; g.sx = g.sy = 1; }
    await animateOutro();
    if (id !== gameId) return;
  }
  gems.clear();
  await animateIntro();
  if (id !== gameId) return;
  banner(`Начинает ${players[turn].ai.name}`, players[turn].ai.color);
  await sleep(900);
  runGame(id);
}

/* ---------------------------------------------------------
 *  Главный цикл кадров
 * ------------------------------------------------------- */
let last = performance.now();
function frame(ts) {
  const dt = Math.min(50, ts - last);
  last = ts;
  if (!paused) {
    const gdt = dt * speed;
    clock += gdt;
    updateTweens();
    updateParticles(gdt / 1000);
  }
  if (players.length) tickScores(dt / 1000);
  render();
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------
 *  Управление
 * ------------------------------------------------------- */
function togglePause() {
  paused = !paused;
  $('pauseBtn').textContent = paused ? '▶ Продолжить' : '⏸ Пауза';
  document.body.classList.toggle('paused', paused);
}

$('pauseBtn').addEventListener('click', togglePause);
$('restartBtn').addEventListener('click', () => { if (paused) togglePause(); newGame(); });
$('againBtn').addEventListener('click', () => newGame());
document.querySelectorAll('#speed button').forEach((btn) => {
  btn.addEventListener('click', () => {
    speed = parseFloat(btn.dataset.speed);
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('active', b === btn));
  });
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
});
window.addEventListener('resize', resize);

resize();
requestAnimationFrame(frame);
newGame();
