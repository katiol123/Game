'use strict';

/* =========================================================
 *  Звук: фоновая музыка (две зацикленные композиции) и синтезированные эффекты
 *  Sound.play('имя', параметры) · Sound.setTrack('menu' | 'match')
 *  Sound.toggleMusic() · Sound.toggleSfx()
 * ========================================================= */

const Sound = (() => {
  const KEY = 'match3-audio';
  let prefs = { music: true, sfx: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY)) }; } catch (e) { /* ignore */ }
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

  const MUSIC_VOL = 0.35;
  const FADE_MS = 900;
  // menu — между турами, match — во время тура
  const tracks = {};
  for (const [name, src] of [['menu', 'assets/audio/menu.mp3'], ['match', 'assets/audio/match.mp3']]) {
    const a = new Audio(src);
    a.loop = true;
    a.preload = 'auto';
    a.volume = MUSIC_VOL;
    tracks[name] = a;
  }
  let current = 'menu';
  const music = () => tracks[current];

  // Плавное изменение громкости; новая фейд-операция отменяет предыдущую на том же треке
  const fades = new Map();
  function fade(a, to, ms, done) {
    cancelAnimationFrame(fades.get(a));
    const from = a.volume;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) fades.set(a, requestAnimationFrame(step));
      else { fades.delete(a); if (done) done(); }
    };
    fades.set(a, requestAnimationFrame(step));
  }

  function startCurrent(fadeIn) {
    const a = music();
    if (fadeIn) a.volume = 0;
    const p = a.play();
    if (fadeIn) fade(a, MUSIC_VOL, FADE_MS);
    return p;
  }

  function setTrack(name) {
    if (!tracks[name] || name === current) return;
    const prev = music();
    current = name;
    if (!prefs.music || !unlocked) { prev.pause(); return; }
    fade(prev, 0, FADE_MS, () => prev.pause());
    startCurrent(true).catch(() => {});
  }

  let ctx = null;
  let master = null;
  let unlocked = false;
  const lastPlayed = {};

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }

  // Браузеры разрешают звук только после действия пользователя
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
    if (prefs.music) startCurrent(true).catch(() => { unlocked = false; });
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, unlock, { capture: true, passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) music().pause();
    else if (prefs.music && unlocked) music().play().catch(() => {});
  });

  /* ---------- синтез ---------- */
  function tone(freq, dur, { type = 'sine', vol = 0.3, delay = 0, slide = null, attack = 0.005, release = null } = {}) {
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (release || dur));
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + (release || dur) + 0.05);
  }

  let noiseBuf = null;
  function noise(dur, { vol = 0.25, delay = 0, from = 800, to = 800, q = 1, type = 'bandpass', attack = 0.01 } = {}) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  }

  const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Гц

  /* ---------- библиотека эффектов ---------- */
  const SFX = {
    // --- интерфейс ---
    click: () => tone(720, 0.06, { type: 'triangle', vol: 0.18, slide: 900 }),
    whoosh: () => noise(0.28, { vol: 0.22, from: 400, to: 2600, q: 0.8 }),
    select() {
      [72, 76, 79, 84].forEach((n, i) => tone(note(n), 0.3, { type: 'triangle', vol: 0.22, delay: i * 0.07 }));
      tone(note(96), 0.5, { type: 'sine', vol: 0.08, delay: 0.28 });
    },
    portal() {
      noise(0.9, { vol: 0.25, from: 200, to: 5000, q: 1.5 });
      tone(160, 0.9, { type: 'sawtooth', vol: 0.06, slide: 1400, attack: 0.3 });
      tone(320, 0.9, { type: 'sine', vol: 0.12, slide: 2200, attack: 0.3 });
    },
    blinds() {
      noise(0.35, { vol: 0.2, from: 3000, to: 300, q: 0.7 });
      noise(0.35, { vol: 0.16, from: 300, to: 3000, q: 0.7, delay: 0.55 });
    },
    tab() {
      tone(520, 0.08, { type: 'triangle', vol: 0.16 });
      tone(780, 0.1, { type: 'triangle', vol: 0.16, delay: 0.06 });
      noise(0.3, { vol: 0.08, from: 900, to: 2500, delay: 0.02 });
    },
    tick: () => tone(1100, 0.04, { type: 'sine', vol: 0.14 }),
    vs() {
      noise(0.25, { vol: 0.25, from: 600, to: 2400, q: 0.6 });
      tone(140, 0.7, { type: 'sine', vol: 0.5, slide: 38, delay: 0.45 });
      noise(0.5, { vol: 0.35, from: 2500, to: 200, type: 'lowpass', delay: 0.45 });
      tone(220, 0.5, { type: 'square', vol: 0.08, delay: 0.45 });
      tone(330, 0.5, { type: 'square', vol: 0.06, delay: 0.45 });
    },
    whistle() {
      tone(note(84), 0.12, { type: 'sine', vol: 0.18 });
      tone(note(88), 0.25, { type: 'sine', vol: 0.18, delay: 0.12 });
    },
    win() {
      [67, 72, 76, 79].forEach((n, i) => tone(note(n), 0.22, { type: 'square', vol: 0.09, delay: i * 0.12 }));
      [72, 76, 79, 84].forEach((n) => tone(note(n), 0.8, { type: 'triangle', vol: 0.14, delay: 0.5 }));
    },
    draw() {
      tone(note(67), 0.3, { type: 'triangle', vol: 0.2 });
      tone(note(67), 0.5, { type: 'triangle', vol: 0.2, delay: 0.3 });
    },
    gain: () => tone(note(88), 0.35, { type: 'sine', vol: 0.12 }),
    champion() {
      const seq = [60, 64, 67, 72, 67, 72, 76, 79, 84];
      seq.forEach((n, i) => tone(note(n), 0.25, { type: 'square', vol: 0.08, delay: i * 0.11 }));
      [72, 76, 79, 84, 88].forEach((n) => tone(note(n), 1.6, { type: 'triangle', vol: 0.12, delay: 1.0 }));
      noise(1.6, { vol: 0.12, from: 8000, to: 3000, type: 'highpass', delay: 1.0 });
    },

    // --- матч «три в ряд» ---
    swap() {
      noise(0.16, { vol: 0.14, from: 800, to: 3200, q: 1.2 });
      tone(420, 0.14, { type: 'sine', vol: 0.12, slide: 640 });
    },
    swapBack: () => tone(640, 0.14, { type: 'sine', vol: 0.12, slide: 380 }),
    clear({ combo = 1, size = 3 } = {}) {
      const base = 64 + Math.min(combo - 1, 6) * 2;
      tone(note(base), 0.22, { type: 'triangle', vol: 0.2 });
      tone(note(base + 7), 0.26, { type: 'sine', vol: 0.14, delay: 0.04 });
      tone(note(base + 12), 0.3, { type: 'sine', vol: 0.08, delay: 0.08 });
      noise(0.08, { vol: 0.12, from: 4000, to: 1500 });
      if (size >= 4) [0, 4, 7, 12, 16].forEach((d, i) => tone(note(base + 12 + d), 0.18, { type: 'sine', vol: 0.07, delay: 0.1 + i * 0.045 }));
    },
    combo({ combo = 2 } = {}) {
      for (let i = 0; i < Math.min(combo + 1, 6); i++) tone(note(72 + i * 3), 0.16, { type: 'square', vol: 0.06, delay: i * 0.05 });
    },
    land: () => tone(210, 0.07, { type: 'sine', vol: 0.12, slide: 120 }),
    shuffle() {
      for (let i = 0; i < 8; i++) tone(note(60 + ((i * 5) % 12) + 12), 0.1, { type: 'triangle', vol: 0.08, delay: i * 0.08 });
      noise(0.9, { vol: 0.12, from: 300, to: 3000, q: 2 });
    },
    matchEnd() {
      tone(note(79), 0.2, { type: 'square', vol: 0.08 });
      tone(note(84), 0.5, { type: 'square', vol: 0.08, delay: 0.15 });
    },
  };

  // Минимальный интервал между повторами одного звука (мс)
  const THROTTLE = { land: 70, clear: 60, swap: 60, click: 40, tick: 40, whoosh: 80, gain: 120 };

  function play(name, opts) {
    if (!prefs.sfx || !SFX[name]) return;
    const c = ensureCtx();
    if (!c || c.state !== 'running') return;
    const now = performance.now();
    if (now - (lastPlayed[name] || 0) < (THROTTLE[name] || 0)) return;
    lastPlayed[name] = now;
    try { SFX[name](opts); } catch (e) { /* ignore */ }
  }

  function toggleMusic() {
    prefs.music = !prefs.music;
    savePrefs();
    if (prefs.music) { unlocked = true; ensureCtx(); startCurrent(true).catch(() => {}); }
    else Object.values(tracks).forEach((a) => a.pause());
    return prefs.music;
  }

  function toggleSfx() {
    prefs.sfx = !prefs.sfx;
    savePrefs();
    return prefs.sfx;
  }

  return {
    play,
    setTrack,
    toggleMusic,
    toggleSfx,
    musicOn: () => prefs.music,
    sfxOn: () => prefs.sfx,
    track: () => current,
    musicPlaying: () => !music().paused,
    musicLoop: () => music().loop,
  };
})();
