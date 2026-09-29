'use strict';

/* =========================================================
 *  Движок матча «три в ряд» (ИИ против ИИ)
 *  Engine.play({ home, away, moves, info }) → Promise<{ home, away, combo }>
 * ========================================================= */

const Engine = (() => {
  const ROWS = 8;
  const COLS = 8;
  const TYPES = 6;
  // Ходов у каждого бойца за матч. Нет нокаута к концу — ничья.
  const MOVE_CAP = 15;

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

  function fillRandom(h) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (h[r][c] < 0) h[r][c] = rand(TYPES);
  }

  // Симуляция хода с каскадами. random=false: новые фишки неизвестны (-1),
  // random=true: сверху падают случайные камни (как в настоящей игре).
  // record=true: сохраняет шаги каскада (для боевых правил при мгновенном досчёте)
  function simulate(g, m, random = false, record = false) {
    const h = applyMove(g, m);
    let score = 0, combo = 0, cleared = 0;
    const steps = [];
    for (;;) {
      const { groups, set } = findMatches(h);
      if (!groups.length) break;
      combo++;
      const pts = scoreGroups(groups, combo);
      score += pts;
      if (record) {
        steps.push({ combo, pts, base: scoreGroups(groups, 1) });
      }
      cleared += set.size;
      for (const i of set) h[(i / COLS) | 0][i % COLS] = -1;
      collapse(h);
      if (random) fillRandom(h);
    }
    return { score, combo, cleared, grid: h, steps };
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
   *  Модели поведения ИИ
   * ------------------------------------------------------- */
  const BRAINS = {
    // Максимум очков прямо сейчас (с учётом каскадов)
    greedy(g) {
      let best = null, bv = -Infinity;
      for (const m of listMoves(g)) {
        const s = simulate(g, m);
        const v = s.score + (s.combo > 1 ? 10 : 0) + Math.random() * 12;
        if (v > bv) { bv = v; best = m; }
      }
      return best;
    },
    // На ход вперёд: своя выгода минус лучший ответ соперника
    strategist(g) {
      let best = null, bv = -Infinity;
      for (const m of listMoves(g)) {
        const s = simulate(g, m);
        const opp = bestImmediate(s.grid);
        const low = (Math.max(m.r1, m.r2) / (ROWS - 1)) * 8; // ходы внизу чаще дают каскады
        const v = s.score - 0.65 * opp + low + Math.random() * 6;
        if (v > bv) { bv = v; best = m; }
      }
      return best;
    },
    // Монте-Карло: несколько случайных «будущих» для каждого хода, берём лучшее среднее
    mystic(g) {
      const moves = listMoves(g);
      const K = moves.length > 20 ? 5 : 8;
      let best = null, bv = -Infinity;
      for (const m of moves) {
        let sum = 0;
        for (let k = 0; k < K; k++) sum += simulate(g, m, true).score;
        const v = sum / K + Math.random() * 4;
        if (v > bv) { bv = v; best = m; }
      }
      return best;
    },
  };

  /* ---------------------------------------------------------
   *  Графика: канвас, спрайты камней
   * ------------------------------------------------------- */
  let canvas, ctx;
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

    c.save();
    c.translate(0, r * 0.14);
    shapePath(c, t, r);
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = r * 0.35;
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fill();
    c.restore();

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
    if (!canvas) return;
    const wrap = $('boardWrap');
    if (!wrap.clientWidth) return;
    size = Math.floor(Math.max(260, Math.min(wrap.clientWidth, window.innerHeight * 0.7, 600)));
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
   *  Состояние матча
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
  let current = null;      // { resolve, done }
  let active = false;

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

  function drawSelected() {
    if (!selected || !human) return;
    const pulse = 0.5 + 0.5 * Math.sin(clock / 120);
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10 + pulse * 14;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 + pulse * 1.5;
    roundRect(ctx, pad + selected.c * cell + 3, pad + selected.r * cell + 3, cell - 6, cell - 6, cell * 0.18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.restore();
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
      ctx.font = `900 ${f.size * pop}px Rubik, "Segoe UI", system-ui, sans-serif`;
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
    drawSelected();

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
    Sound.play('swap');
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
    }, { delay, easing: ease.inQuad }).then(() => { Sound.play('land'); return tween(300, (e, t) => {
      const w = Math.cos(t * Math.PI * 3) * (1 - t);
      g.y = toY - Math.max(0, Math.sin(t * Math.PI * 2)) * 0.08 * (1 - t);
      g.sx = 1 + 0.18 * w;
      g.sy = 1 - 0.18 * w;
      g.a = 1; g.s = 1;
    }); }).then(() => { g.y = toY; g.sx = g.sy = 1; });
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

  function animateShuffle() {
    Sound.play('shuffle');
    const list = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) list.push(board[r][c]);
    let arrangement = null;
    for (let tries = 0; tries < 200 && !arrangement; tries++) {
      const p = list.slice().sort(() => Math.random() - 0.5);
      const g = [];
      for (let r = 0; r < ROWS; r++) g.push(p.slice(r * COLS, r * COLS + COLS).map((x) => x.t));
      if (!findMatches(g).groups.length && listMoves(g).length) arrangement = p;
    }
    if (!arrangement) {
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
   *  UI матча
   * ------------------------------------------------------- */
  function banner(text, color = '#ffd21f', cls = '') {
    const b = $('banner');
    b.textContent = text;
    b.style.setProperty('--bc', color);
    b.className = 'banner' + (cls ? ' ' + cls : '');
    void b.offsetWidth;
    b.classList.add('show');
  }

  function log(html, color) {
    const li = document.createElement('li');
    li.innerHTML = html;
    li.style.setProperty('--lc', color);
    const ul = $('log');
    ul.prepend(li);
    while (ul.children.length > 4) ul.lastChild.remove();
  }

  function setupCards(info) {
    players.forEach((p, i) => {
      const h = p.hero;
      const el = $('mp' + i);
      el.style.setProperty('--pc', h.color);
      el.querySelector('.m-sprite').src = h.sprite;
      el.querySelector('.name').textContent = h.name;
      // уровень и текущее место в таблице (place передаёт лига; в отдельной игре его может не быть)
      el.querySelector('.rank').innerHTML = [
        h.level ? `<span class="rk-lvl">${tr('Ур.', 'Lv.')} <b>${h.level}</b></span>` : '',
        h.place ? `<span class="rk-place">${I18N.place(h.place)}</span>` : '',
      ].filter(Boolean).join('<i>·</i>');
      el.querySelector('.side').textContent = i === 0 ? tr('Дома', 'Home') : tr('В гостях', 'Away');
      el.querySelector('.you').hidden = !h.isPlayer;
      el.querySelector('.score').textContent = '0';
      el.querySelector('.dmg').textContent = p.dmg;
      el.querySelector('.hp-max').textContent = p.maxHp;
      el.querySelector('.charge.c2').hidden = p.charge.length < 2;
      el.classList.remove('ko', 'hit', 'lunge', 'injured', 'raging');
      el.querySelectorAll('.inj-stamp').forEach((x) => x.remove());
      el.querySelectorAll('.card-pop').forEach((x) => x.remove());
      p.el = el;
      renderHp(p, true);
      renderCharge(p, 0, true);
      if (p.charge.length > 1) renderCharge(p, 1, true);
      renderStatus(p);
      renderInjuries(p);
    });
    $('matchInfo').textContent = info || '';
    $('log').innerHTML = '';
  }

  function updateUI() {
    players.forEach((p, i) => {
      p.el.classList.toggle('active', i === turn && !(current && current.done));
      p.el.querySelector('.moves').textContent = MOVE_CAP - p.moves;
      p.el.querySelector('.combo').textContent = p.maxCombo;
    });
  }

  // Шкала здоровья: основная полоса + «след» урона, который догоняет с задержкой
  function renderHp(p, instant = false) {
    const box = p.el.querySelector('.hp');
    const pct = Math.max(0, p.hp) / p.maxHp;
    const fill = box.querySelector('.hp-fill'), ghost = box.querySelector('.hp-ghost');
    if (instant) { fill.style.transition = ghost.style.transition = 'none'; }
    fill.style.width = pct * 100 + '%';
    ghost.style.width = pct * 100 + '%';
    box.style.setProperty('--hpc', `hsl(${Math.round(120 * pct)}, 85%, 52%)`);
    box.classList.toggle('low', pct > 0 && pct <= 0.25);
    box.querySelector('.hp-val').textContent = Math.max(0, p.hp);
    if (instant) { void box.offsetWidth; fill.style.transition = ghost.style.transition = ''; }
  }

  const chargeEl = (p, bar) => p.el.querySelector(bar ? '.charge.c2' : '.charge.c1');

  // Шкала заряда атаки (bar 0 — основная, 1 — вторая у «Двух стволов»).
  // instant — без плавного перехода (мгновенный сброс на остаток после удара)
  function renderCharge(p, bar = 0, instant = false) {
    const el = chargeEl(p, bar);
    const fill = el.querySelector('.charge-fill');
    fill.style.transitionDuration = (0.25 / speed) + 's'; // анимация шкалы идёт с той же скоростью, что и игра
    if (instant) fill.style.transition = 'none';
    fill.style.width = Math.min(1, p.charge[bar] / p.cost) * 100 + '%';
    el.querySelector('.charge-txt').textContent = `${Math.min(p.charge[bar], p.cost)} / ${p.cost}`;
    if (instant) { void fill.offsetWidth; fill.style.transition = ''; }
  }

  // Пассивка и текущие эффекты под именем бойца
  function renderStatus(p) {
    const ps = PASSIVES[p.id];
    const chips = [p.noPassive
      ? `<span class="st-chip passive off" title="${tr('Отключена переломом ребра', 'Disabled by a broken rib')}">${ps.icon} <s>${ps.name}</s></span>`
      : p.empowered
        ? `<span class="st-chip passive up" title="${ps.desc}\n⚡ ${ps.up}">${ps.icon} ${ps.name} ⚡</span>`
        : `<span class="st-chip passive" title="${ps.desc}">${ps.icon} ${ps.name}</span>`];
    if (p.raging) chips.push(`<span class="st-chip rage" title="${UPGRADE_BY_ID.rage.desc}">🔥 ${tr('Ярость', 'Rage')}</span>`);
    else if (p.rageReady) chips.push(`<span class="st-chip" title="${UPGRADE_BY_ID.rage.desc}">🔥 ${Math.min(p.score, RAGE_SCORE)} / ${RAGE_SCORE}</span>`);
    if (p.bleed) chips.push(`<span class="st-chip bad" title="${tr('Кровотечение: в начале каждого хода (красных камней − 10) × 4 урона', 'Bleeding: (red gems − 10) × 4 damage at the start of each turn')}">🩸 ${tr('Истекает кровью', 'Bleeding')}</span>`);
    if (p.aim) chips.push(`<span class="st-chip good" title="${tr(`Прицеливание: ${p.aim * 7}% шанс крита ×2`, `Aiming: ${p.aim * 7}% chance of a ×2 crit`)}">🎯 ×${p.aim}</span>`);
    if (p.snack) chips.push(`<span class="st-chip good" title="${tr(`Перекус: ${Math.round(p.snack * Combat.SNACK.crit * 100)}% шанс крита ×1,75`, `Snack Time: ${Math.round(p.snack * Combat.SNACK.crit * 100)}% chance of a ×1.75 crit`)}">🌯 ×${p.snack}</span>`);
    p.el.querySelector('.status').innerHTML = chips.join('');
  }

  // Медицинский крест на карточке бойца: травмы, с которыми он вышел, и полученные в этом бою
  function renderInjuries(p) {
    const el = p.el.querySelector('.inj-cross');
    const list = [...(p.hero.injuries || []), ...p.newInjuries.map((id) => ({ id, left: null }))];
    el.hidden = !list.length;
    el.dataset.tip = injuryTip(list);
  }

  // Всплывающая подпись над шкалой заряда: сколько очков перешло на следующий удар
  function carryTag(p, bar, amount) {
    const tag = document.createElement('b');
    tag.className = 'carry-tag';
    tag.textContent = tr(`+${amount} в запасе`, `+${amount} carried over`);
    tag.addEventListener('animationend', () => tag.remove(), { once: true });
    const line = chargeEl(p, bar).querySelector('small');
    line.querySelectorAll('.carry-tag').forEach((t) => t.remove());
    line.append(tag);
  }

  // Всплывающая надпись на карточке бойца: урон, лечение, эффекты
  function cardPop(p, text, cls = 'dmg', delay = 0) {
    const pop = document.createElement('b');
    pop.className = 'card-pop ' + cls;
    pop.textContent = text;
    pop.style.animationDelay = delay / speed + 'ms';
    pop.addEventListener('animationend', () => pop.remove(), { once: true });
    p.el.append(pop);
  }

  // Перезапускает CSS-анимацию через класс и снимает класс после неё: иначе класс остаётся навсегда
  // и перебивает другие анимации карточки (из-за этого пропадала тряска при ударе)
  function restartClass(el, cls, ms = 1400) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    const key = '_cls_' + cls;
    clearTimeout(el[key]);
    el[key] = setTimeout(() => el.classList.remove(cls), ms);
  }
  const other = (p) => players[1 - players.indexOf(p)];

  // «Ярость»: бойцу +30% ко всем характеристикам до конца боя
  function showRage(p, r) {
    p.el.classList.add('raging');
    restartClass(p.el, 'rage-burst', 1200);
    banner(tr('ЯРОСТЬ!', 'RAGE!'), '#ff5a1f');
    Sound.play('crit');
    cardPop(p, '🔥 +30%', 'crit');
    p.el.querySelector('.dmg').textContent = p.dmg;
    p.el.querySelector('.hp-max').textContent = p.maxHp;
    renderHp(p);
    p.charge.forEach((_, b) => renderCharge(p, b, true));
    renderStatus(p);
    const diff = STATS.map((s) => `${s.icon} ${r.before[s.key]}→${r.after[s.key]}`).join(' ');
    log(tr(`🔥 <b>${p.hero.name}</b> впадает в ярость: ${diff}`, `🔥 <b>${p.hero.name}</b> flies into a rage: ${diff}`), '#ff5a1f');
  }

  function showKO(def, att) {
    def.el.classList.add('ko');
    Sound.play('ko');
    banner(tr('НОКАУТ!', 'KNOCKOUT!'), att ? att.hero.color : '#ff3b4e');
  }

  // Удар att по def: сначала считается исход (правила в combat.js), потом летит снаряд и показывается результат.
  // kind: 'charge' — от шкалы, 'ram' — «Таран», 'duel' — «Дуэль на закате»
  async function strike(att, def, kind = 'charge') {
    const id = gameId;
    const ev = Combat.hit(att, def, typesGrid(), kind);
    const from = att.el.querySelector('.m-sprite-wrap').getBoundingClientRect();
    const to = def.el.querySelector('.m-sprite-wrap').getBoundingClientRect();
    const x1 = from.left + from.width / 2, y1 = from.top + from.height / 2;
    const x2 = to.left + to.width / 2, y2 = to.top + to.height / 2;
    const orb = document.createElement('div');
    orb.className = 'strike-orb' + (kind === 'ram' ? ' ram' : kind === 'duel' ? ' duel' : '');
    orb.style.setProperty('--pc', att.hero.color);
    document.body.append(orb);
    restartClass(att.el, 'lunge');
    Sound.play('strike');
    await orb.animate([
      { transform: `translate(${x1}px, ${y1}px) scale(0.3)`, opacity: 0 },
      { transform: `translate(${(x1 + x2) / 2}px, ${Math.min(y1, y2) - 60}px) scale(1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x2}px, ${y2}px) scale(1.4)`, opacity: 1 },
    ], { duration: 420 / speed, easing: 'cubic-bezier(.4,0,.9,.5)' }).finished;
    orb.remove();
    if (id !== gameId) return false;

    const tag = kind === 'ram' ? tr(' (таран)', ' (ram)') : kind === 'duel' ? tr(' (дуэль)', ' (duel)') : kind === 'charge2' ? tr(' (2-й ствол)', ' (2nd barrel)') : '';
    if (ev.missed) {
      cardPop(def, tr('🦾 Промах!', '🦾 Miss!'), 'info');
      Sound.play('dodge');
      log(tr(`🦾 <b>${att.hero.name}</b> промахивается${tag} — перелом руки`, `🦾 <b>${att.hero.name}</b> misses${tag}: broken arm`), att.hero.color);
    } else if (ev.dodged) {
      cardPop(def, tr('Даже не моргнул!', 'Didn’t even blink!'), 'info');
      Sound.play('dodge');
      log(tr(`😐 <b>${def.hero.name}</b> даже не моргнул — удар${tag} ${att.hero.name} проигнорирован`, `😐 <b>${def.hero.name}</b> didn’t even blink: ${att.hero.name}’s strike${tag} ignored`), def.hero.color);
    } else {
      restartClass(def.el, 'hit');
      cardPop(def, (ev.crit ? tr('КРИТ! ', 'CRIT! ') : '') + '−' + ev.dmg, ev.crit ? 'dmg crit' : 'dmg');
      renderHp(def);
      if (ev.ko) showKO(def, att); else Sound.play(ev.crit ? 'crit' : 'hit');
      log(tr(`⚔ <b>${att.hero.name}</b> бьёт${tag} на ${ev.dmg}${ev.crit ? ' — КРИТ!' : ''} — у соперника ❤ ${def.hp}`,
        `⚔ <b>${att.hero.name}</b> hits${tag} for ${ev.dmg}${ev.crit ? ' (CRIT!)' : ''}; opponent ❤ ${def.hp}`), att.hero.color);
    }
    if (ev.bleedApplied) {
      cardPop(def, tr('🩸 Кровотечение!', '🩸 Bleeding!'), 'bad', 250);
      log(tr(`🩸 <b>${def.hero.name}</b> истекает кровью до конца боя`, `🩸 <b>${def.hero.name}</b> is bleeding until the end of the bout`), att.hero.color);
    }
    if (ev.injury) {
      const inj = INJURY_BY_ID[ev.injury];
      restartClass(def.el, 'hit');
      const stamp = document.createElement('b');
      stamp.className = 'inj-stamp';
      stamp.textContent = '✚';
      stamp.addEventListener('animationend', () => stamp.remove(), { once: true });
      def.el.append(stamp);
      cardPop(def, `✚ ${inj.name}!`, 'injury', 350);
      Sound.play('injury');
      renderInjuries(def);
      // эффекты травмы: макс. здоровье, цена атаки, обнулённый заряд, отключённая пассивка
      def.el.querySelector('.hp-max').textContent = def.maxHp;
      renderHp(def);
      def.charge.forEach((_, b) => renderCharge(def, b, true));
      log(tr(`✚ <b>${def.hero.name}</b> получает травму: ${inj.icon} ${inj.name}`, `✚ <b>${def.hero.name}</b> is injured: ${inj.icon} ${inj.name}`), '#ff4b5c');
    }
    if (ev.drainPct > 0) {
      cardPop(def, tr(`🔗 −${ev.drainPct}% заряда`, `🔗 −${ev.drainPct}% charge`), 'info', 250);
      def.charge.forEach((_, b) => renderCharge(def, b, true));
    }
    renderStatus(att);
    renderStatus(def);
    await sleep(380);
    return id === gameId;
  }

  // Проводит все атаки, накопленные на шкале bar.
  // Порядок: шкала дозаполняется до 100% и вспыхивает → пауза → вылетает удар,
  // и в этот же момент шкала сбрасывается на остаток (излишек переходит на следующий удар).
  async function strikeWhileFull(p, bar) {
    const id = gameId;
    const def = other(p);
    const el = chargeEl(p, bar);
    while (p.charge[bar] >= p.cost && def.hp > 0) {
      await sleep(320); // шкала доезжает до 100%
      if (id !== gameId) return false;
      restartClass(el, 'full');
      Sound.play('charged');
      await sleep(260); // вспышка, короткая пауза
      if (id !== gameId) return false;
      p.charge[bar] -= p.cost;
      renderCharge(p, bar, true);
      if (p.charge[bar] > 0) carryTag(p, bar, p.charge[bar]);
      if (!(await strike(p, def, bar ? 'charge2' : 'charge'))) return false;
    }
    return true;
  }

  const someoneKO = () => players.some((p) => p.hp <= 0);

  function setThinking(i, on) {
    players[i].el.querySelector('.thinking').classList.toggle('on', on);
  }

  function tickScores(dt) {
    for (const p of players) {
      if (!p.el || p.shown === p.score) continue;
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
   *  Игровой цикл матча
   * ------------------------------------------------------- */
  // «Перекус» Шаурмена: лечение и стак крита
  function showSnack(p) {
    const r = Combat.snack(p, typesGrid());
    banner(tr('Перекус!', 'Snack Time!'), p.hero.color);
    Sound.play('heal');
    cardPop(p, r.heal > 0 ? `+${r.heal} ❤` : tr('🌯 +1 стак', '🌯 +1 stack'), 'heal');
    log(tr(`🌯 <b>${p.hero.name}</b> перекусил: +${r.heal} ❤, стаков ${r.snack}`, `🌯 <b>${p.hero.name}</b> had a snack: +${r.heal} ❤, stacks ${r.snack}`), p.hero.color);
    renderHp(p);
    renderStatus(p);
  }

  async function resolveBoard(p) {
    const id = gameId;
    let combo = 0, total = 0;
    for (;;) {
      const { groups, set } = findMatches(typesGrid());
      if (!groups.length) break;
      combo++;
      const base = scoreGroups(groups, 1);
      const mult = Combat.comboMult(p, combo); // «Сломанный нос» урезает множитель комбо
      const pts = base * mult;
      const five = groups.filter((gr) => gr.len >= 5).length;
      total += pts;
      p.score += pts;
      p.maxCombo = Math.max(p.maxCombo, combo);
      bumpScore(p);
      const rage = Combat.checkRage(p);
      if (rage) showRage(p, rage);
      else if (p.rageReady && !p.raging) renderStatus(p); // прогресс до «Ярости»

      let sx = 0, sy = 0;
      for (const i of set) { sx += px(i % COLS); sy += px((i / COLS) | 0); }
      floatText(sx / set.size, sy / set.size, '+' + pts, combo > 1 ? '#fff38a' : '#ffffff', combo > 1);
      Sound.play('clear', { combo, size: Math.max(...groups.map((g) => g.len)) });
      if (combo >= 2) { banner(mult < combo ? `${tr('Комбо', 'Combo')} ×${mult} 👃` : `${tr('Комбо', 'Combo')} ×${combo}!`, p.hero.color); Sound.play('combo', { combo }); }
      else if (five) banner(tr('Потрясающе!', 'Amazing!'), p.hero.color);
      else if (groups.some((g) => g.len === 4)) banner(tr('Отлично!', 'Great!'), p.hero.color);

      // заряд начисляется в момент сжигания, параллельно с исчезновением и падением камней
      const targets = Combat.chargeTargets(p, combo, base);
      // обе шкалы («Два ствола») заполняются сразу, удары идут по очереди
      targets.forEach((t) => { p.charge[t.bar] += t.pts; renderCharge(p, t.bar); });
      const charging = (async () => {
        for (const t of targets) if (!(await strikeWhileFull(p, t.bar))) return false;
        return true;
      })();
      await animateClear(set);
      await animateGravity();
      if (!(await charging) || id !== gameId) return null;
      if (someoneKO()) break;
      // «Таран» Бычары: каскад дошёл до комбо ×4
      if (Combat.ramOnCombo(p, combo)) {
        banner(tr('Таран!', 'Ram!'), p.hero.color);
        if (!(await strike(p, other(p), 'ram'))) return null;
        if (someoneKO()) break;
      }
      // «Перекус» Шаурмена: каскад дошёл до комбо ×4
      if (Combat.snackOnCombo(p, combo)) showSnack(p);
    }
    return { combo, total };
  }

  async function runMatch(id) {
    let duelAnnounced = false;
    for (;;) {
      if (id !== gameId) return;
      if (someoneKO() || players.every((p) => p.moves >= MOVE_CAP)) { await finish(id); return; }

      const p = players[turn];
      const def = other(p);
      updateUI();

      // начало хода: кровотечение (один раз за ход — после перемешивания поля ход не начинается заново)
      const st = p.startedAt === p.moves ? null : Combat.startTurn(p, typesGrid());
      p.startedAt = p.moves;
      if (st && st.bleed > 0) {
        restartClass(p.el, 'hit');
        cardPop(p, `🩸 −${st.bleed}`, 'bad');
        renderHp(p);
        Sound.play('hit');
        log(tr(`🩸 <b>${p.hero.name}</b> теряет ${st.bleed} от кровотечения — ❤ ${p.hp}`, `🩸 <b>${p.hero.name}</b> loses ${st.bleed} to bleeding; ❤ ${p.hp}`), def.hero.color);
        if (st.ko) { showKO(p, def); continue; }
        await sleep(450);
        if (id !== gameId) return;
      }
      // «Сотрясение мозга»: ход пропущен, но засчитан
      if (st && st.skip) {
        restartClass(p.el, 'dazed', 1200);
        cardPop(p, tr('💫 Пропускает ход', '💫 Skips a turn'), 'bad');
        banner(tr(`${p.hero.name} в нокдауне`, `${p.hero.name} is dazed`), '#9aa0c8');
        Sound.play('dodge');
        log(tr(`💫 <b>${p.hero.name}</b> приходит в себя после сотрясения и пропускает ход`, `💫 <b>${p.hero.name}</b> is recovering from a concussion and skips a turn`), '#9aa0c8');
        p.moves++;
        turn = 1 - turn;
        updateUI();
        await sleep(1100);
        if (id !== gameId) return;
        continue;
      }

      const isHuman = !!p.hero.isPlayer;
      let move;
      if (isHuman) {
        if (!listMoves(typesGrid()).length) {
          banner(tr('Нет ходов — перемешиваем!', 'No moves: shuffling!'), '#a347ff');
          await animateShuffle();
          continue;
        }
        banner(tr('Ваш ход!', 'Your move!'), p.hero.color);
        move = await waitHumanMove();
        if (id !== gameId) return;
      } else {
        setThinking(turn, true);
        await sleep(500);
        if (id !== gameId) return;

        move = BRAINS[p.hero.model](typesGrid());
        setThinking(turn, false);
        if (!move) {
          banner(tr('Нет ходов — перемешиваем!', 'No moves: shuffling!'), '#a347ff');
          await animateShuffle();
          continue;
        }
      }

      // ход засчитывается сразу — важно для мгновенного досчёта
      p.moves++;
      turn = 1 - turn;

      if (!isHuman) {
        hint = { ...move, color: p.hero.color };
        await sleep(450);
        hint = null;
      }

      await animateSwap(move);
      const res = await resolveBoard(p);
      if (!res || id !== gameId) return;
      if (res.combo === 0) await animateSwap(move);

      const coord = (r, c) => `${String.fromCharCode(65 + c)}${ROWS - r}`;
      log(`<b>${p.hero.name}</b>: ${coord(move.r1, move.c1)} ⇄ ${coord(move.r2, move.c2)} — +${res.total}` +
          (res.combo > 1 ? ` (${tr('комбо', 'combo')} ×${res.combo})` : ''), p.hero.color);
      if (someoneKO()) continue;

      // «Дуэль на закате»: дополнительный удар в последние ходы
      if (Combat.duelTurn(players, p, MOVE_CAP)) {
        if (!duelAnnounced) { duelAnnounced = true; banner(tr('Дуэль на закате!', 'Sunset Duel!'), HERO_BY_ID.dumpling.color); Sound.play('duel'); await sleep(700); }
        if (!(await strike(p, def, 'duel'))) return;
        if (someoneKO()) continue;
      }

      // конец хода: «Прицеливание»
      const en = Combat.endTurn(p);
      if (en) { cardPop(p, `🎯 ${tr('Прицеливание', 'Aiming')} ×${en.aim}`, 'good'); renderStatus(p); }

      if (!listMoves(typesGrid()).length) {
        banner(tr('Нет ходов — перемешиваем!', 'No moves: shuffling!'), '#a347ff');
        await animateShuffle();
      }
    }
  }

  async function finish(id) {
    current.done = true;
    updateUI();
    const [a, b] = players;
    // победа только нокаутом; ходы кончились без нокаута — ничья
    const ko = a.hp <= 0 || b.hp <= 0;
    const w = ko ? (a.hp > 0 ? a : b) : null;
    // сокрушительная победа: у победителя осталось больше половины здоровья
    const crush = !!w && w.hp > w.maxHp * 0.5;
    for (let i = 0; i < 24; i++) {
      const gx = rand(COLS), gy = rand(ROWS);
      if (board[gy] && board[gy][gx]) burst(board[gy][gx]);
    }
    await sleep(ko ? 700 : 0);
    if (id !== gameId) return;
    if (crush) {
      banner(tr('СОКРУШИТЕЛЬНАЯ ПОБЕДА!', 'CRUSHING VICTORY!'), w.hero.color, 'crush');
      Sound.play('crush');
    } else {
      banner(w ? tr(`Победа: ${w.hero.name}!`, `${w.hero.name} wins!`) : tr('Ничья!', 'Draw!'), w ? w.hero.color : '#ffd21f');
      Sound.play('matchEnd');
    }
    await sleep(crush ? 2000 : 1400);
    if (id !== gameId) return;
    const cur = current;
    current = null;
    cur.resolve({
      home: a.score, away: b.score,
      winner: w === a ? 'home' : w === b ? 'away' : null,
      ko,
      crush,
      hp: [Math.max(0, a.hp), Math.max(0, b.hp)],
      maxHp: [a.maxHp, b.maxHp],
      moves: [a.moves, b.moves],
      combo: [a.maxCombo, b.maxCombo],
      injuries: [a.newInjuries.slice(), b.newInjuries.slice()],
      dealt: [a.injuriesDealt, b.injuriesDealt],
    });
  }

  // Доигрывает матч без анимаций по тем же правилам (ИИ, бой, пассивки).
  // Работает только с состоянием бойцов и сеткой — используется «Досчитать матч» и симуляцией баланса.
  function fastForward(ps, g, turnIdx) {
    let t = turnIdx;
    const duel = (p) => Combat.duelTurn(ps, p, MOVE_CAP);
    const ko = () => ps.some((p) => p.hp <= 0);
    let guard = 0;
    while (!ko() && ps.some((p) => p.moves < MOVE_CAP) && guard++ < 1000) {
      const p = ps[t], def = ps[1 - t];
      if (p.startedAt !== p.moves) {
        p.startedAt = p.moves;
        const st = Combat.startTurn(p, g);
        if (st.skip) { p.moves++; t = 1 - t; continue; }
      }
      if (ko()) break;
      const move = BRAINS[p.hero.model](g);
      if (!move) { g = randomGrid(); continue; }
      const s = simulate(g, move, true, true);
      p.moves++;
      p.maxCombo = Math.max(p.maxCombo, s.combo);
      g = s.grid;
      for (const step of s.steps) {
        p.score += step.base * Combat.comboMult(p, step.combo);
        Combat.checkRage(p);
        for (const tg of Combat.chargeTargets(p, step.combo, step.base)) {
          p.charge[tg.bar] += tg.pts;
          while (p.charge[tg.bar] >= p.cost && def.hp > 0) { p.charge[tg.bar] -= p.cost; Combat.hit(p, def, g, tg.bar ? 'charge2' : 'charge'); }
        }
        if (Combat.ramOnCombo(p, step.combo) && def.hp > 0) Combat.hit(p, def, g, 'ram');
        if (Combat.snackOnCombo(p, step.combo) && def.hp > 0) Combat.snack(p, g);
        if (ko()) break;
      }
      if (!ko() && duel(p)) Combat.hit(p, def, g, 'duel');
      Combat.endTurn(p);
      if (!listMoves(g).length) g = randomGrid();
      t = 1 - t;
    }
    return { grid: g, turn: t };
  }

  // Мгновенно доигрывает матч без анимаций
  function skip() {
    if (!current || current.done) return;
    if (players.some((p) => p.hero.isPlayer)) return; // свой матч игрок доигрывает сам
    const id = ++gameId;
    tweens = [];
    hint = null;
    players.forEach((_, i) => setThinking(i, false));
    document.querySelectorAll('.strike-orb').forEach((o) => o.remove());

    let g = typesGrid();
    fillRandom(g);
    for (;;) { // доводим поле до стабильного состояния
      const { set } = findMatches(g);
      if (!set.size) break;
      for (const i of set) g[(i / COLS) | 0][i % COLS] = -1;
      collapse(g);
      fillRandom(g);
    }
    const r = fastForward(players, g, turn);
    g = r.grid;
    turn = r.turn;
    players.forEach((p) => {
      renderInjuries(p);
      p.el.classList.toggle('raging', p.raging);
      p.el.querySelector('.dmg').textContent = p.dmg;
      p.el.querySelector('.hp-max').textContent = p.maxHp;
      renderHp(p);
      p.charge.forEach((_, b) => renderCharge(p, b));
      renderStatus(p);
      if (p.hp <= 0) p.el.classList.add('ko');
    });

    // перерисовываем поле итоговым состоянием с короткой вспышкой
    gems.clear();
    board = g.map((row, r) => row.map((t, c) => {
      const gem = makeGem(t, r, c);
      gem.flash = 1;
      tween(500, (e) => { gem.flash = 1 - e; }, { delay: (r + c) * 15 });
      return gem;
    }));
    log(tr('⏭ Матч досчитан мгновенно', '⏭ Match finished instantly'), '#9aa0c8');
    finish(id);
  }

  function play({ home, away, info = '' }) {
    return new Promise((resolve) => {
      const id = ++gameId;
      tweens = [];
      particles = [];
      floaters = [];
      hint = null;
      gems.clear();
      board = [];
      human = null;
      selected = null;
      dragFrom = null;
      busySwap = false;
      players = [home, away].map((hero) => Object.assign(Combat.fighter(hero), { shown: 0 }));
      Combat.matchStart(players); // «Выбитые зубы» с прошлых боёв — соперник стартует с половиной заряда
      turn = 0; // хозяева ходят первыми
      current = { resolve, done: false };
      resize();
      setupCards(info);
      updateUI();
      animateIntro().then(() => {
        if (id !== gameId) return;
        banner(tr(`Первым ходит ${home.name}`, `${home.name} moves first`), home.color);
        Sound.play('whistle');
        return sleep(900);
      }).then(() => {
        if (id === gameId) runMatch(id);
      });
    });
  }

  /* ---------------------------------------------------------
   *  Ход игрока: клик по двум соседним камням или перетаскивание
   * ------------------------------------------------------- */
  const HINT_DELAY = 8000;  // через сколько (игровых мс) подсветить возможный ход
  let human = null;         // { resolve, since } — ждём ход игрока
  let selected = null;      // { r, c } — выбранный камень
  let dragFrom = null;      // { r, c, x, y } — начало перетаскивания
  let busySwap = false;     // идёт анимация неудачного обмена

  function waitHumanMove() {
    return new Promise((resolve) => {
      human = { resolve, since: clock };
      selected = null;
      canvas.classList.add('your-turn');
    });
  }

  function cellAt(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size - pad;
    const y = ((e.clientY - rect.top) / rect.height) * size - pad;
    const c = Math.floor(x / cell), r = Math.floor(y / cell);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r, c, x: e.clientX, y: e.clientY };
  }

  const canAct = () => human && !paused && !busySwap;

  function tryHumanSwap(a, b) {
    if (!canAct()) return;
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return;
    if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return;
    const m = { r1: a.r, c1: a.c, r2: b.r, c2: b.c };
    selected = null;
    hint = null;
    const h = applyMove(typesGrid(), m);
    if (matchAt(h, m.r1, m.c1) || matchAt(h, m.r2, m.c2)) {
      const w = human;
      human = null;
      canvas.classList.remove('your-turn');
      w.resolve(m);
      return;
    }
    // обмен без совпадения: камни меняются и возвращаются, ход не тратится
    busySwap = true;
    const id = gameId;
    animateSwap(m)
      .then(() => { Sound.play('swapBack'); return animateSwap(m); })
      .then(() => { if (id === gameId) { busySwap = false; if (human) human.since = clock; } });
  }

  function onPointerDown(e) {
    if (!canAct()) return;
    const p = cellAt(e);
    if (!p) return;
    e.preventDefault();
    if (selected && Math.abs(selected.r - p.r) + Math.abs(selected.c - p.c) === 1) {
      tryHumanSwap(selected, p);
      dragFrom = null;
      return;
    }
    selected = selected && selected.r === p.r && selected.c === p.c ? null : { r: p.r, c: p.c };
    dragFrom = p;
    Sound.play('tick');
  }

  function onPointerMove(e) {
    if (!dragFrom || !canAct()) return;
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - dragFrom.x, dy = e.clientY - dragFrom.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < (rect.width / COLS) * 0.35) return;
    const from = dragFrom;
    dragFrom = null;
    const to = Math.abs(dx) > Math.abs(dy)
      ? { r: from.r, c: from.c + Math.sign(dx) }
      : { r: from.r + Math.sign(dy), c: from.c };
    tryHumanSwap(from, to);
  }

  /* ---------------------------------------------------------
   *  Кадры
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
      if (human && !hint && !busySwap && clock - human.since > HINT_DELAY) {
        const ms = listMoves(typesGrid());
        if (ms.length) hint = { ...ms[rand(ms.length)], color: '#ffffff' };
      }
    }
    if (active) {
      tickScores(dt / 1000);
      render();
    }
    requestAnimationFrame(frame);
  }

  function init() {
    canvas = $('board');
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', () => { dragFrom = null; });
    window.addEventListener('pointercancel', () => { dragFrom = null; });
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }

  return {
    // для симуляции баланса (node): внутренние функции без DOM
    _sim: { fastForward, randomGrid, MOVE_CAP },
    init,
    play,
    skip,
    resize,
    setActive(v) { active = v; if (v) resize(); },
    setSpeed(v) { speed = v; },
    getSpeed: () => speed,
    setPaused(v) { paused = v; },
    isPaused: () => paused,
    isPlaying: () => !!current,
    // для автотестов: текущее поле и ждём ли хода игрока
    debug: () => ({
      grid: typesGrid(), waitingHuman: !!human, moves: listMoves(typesGrid()), size, pad, cell,
      players: players.map((p) => ({ hp: p.hp, maxHp: p.maxHp, charge: p.charge, cost: p.cost, dmg: p.dmg, moves: p.moves, bleed: p.bleed, aim: p.aim, snack: p.snack })),
    }),
  };
})();
