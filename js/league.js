'use strict';

/* =========================================================
 *  Лига: состав, календарь (метод Бергера), таблица, сохранение
 * ========================================================= */

const League = (() => {
  const KEY = 'match3-league-v1';
  const rnd = (n) => Math.floor(Math.random() * n);

  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }

  // Характеристики героев фиксированы (data.js); модели ИИ раздаются случайно, но сбалансированно
  function createRoster() {
    const models = shuffle(['greedy', 'greedy', 'greedy', 'strategist', 'strategist', 'strategist', 'mystic', 'mystic']);
    const roster = {};
    HEROES.forEach((h, i) => {
      roster[h.id] = { model: models[i % models.length] };
      normalizeProgress(roster[h.id]);
    });
    return roster;
  }

  /* ---------- прокачка ---------- */
  // xp — опыт на текущем уровне, pending — сколько улучшений ещё не выбрано, picks — история выборов
  function normalizeProgress(e) {
    if (typeof e.xp !== 'number') e.xp = 0;
    if (typeof e.level !== 'number') e.level = 1;
    if (!e.bonus) e.bonus = { str: 0, agi: 0, end: 0 };
    if (!Array.isArray(e.picks)) e.picks = [];
    if (typeof e.pending !== 'number') e.pending = 0;
    if (!Array.isArray(e.injuries)) e.injuries = [];
    return e;
  }

  /* ---------- травмы ---------- */
  // После боя: старые травмы сокращаются на бой (на нуле проходят), новые добавляются на 2–4 боя.
  // e.injuries: [{ id, left }] — left: сколько ещё боёв травма будет действовать
  function updateInjuries(e, newIds) {
    e.injuries = e.injuries.map((i) => ({ ...i, left: i.left - 1 })).filter((i) => i.left > 0);
    const [lo, hi] = INJURY_DURATION;
    for (const id of newIds) {
      if (e.injuries.some((i) => i.id === id)) continue;
      e.injuries.push({ id, left: lo + rnd(hi - lo + 1) });
    }
    return e.injuries;
  }

  // Множитель опыта: разница с соперником и травмы.
  // placeDiff — на сколько мест соперник выше (отрицательное — ниже), levelDiff — на сколько уровней выше,
  // dealt — сколько травм нанесено сопернику (+30% за каждую), concussed — «Сотрясение мозга»: опыта нет.
  function xpMultiplier(placeDiff, levelDiff, dealt = 0, concussed = false) {
    const place = placeDiff * XP_PLACE_BONUS;
    const level = levelDiff * XP_LEVEL_BONUS;
    const injury = dealt * XP_INJURY_BONUS;
    const raw = 1 + place + level + injury;
    const floored = raw < XP_MIN_MULT;
    const mult = concussed ? 0 : Math.max(XP_MIN_MULT, raw);
    return { mult, place, level, injury, dealt, floored, concussed };
  }

  // Сколько опыта получает сторона ('home' | 'away') за матч; mult — множитель за соперника
  function xpGain(res, side, mult = 1) {
    const o = outcome(res);
    let base;
    if (o === 'draw') base = XP_REWARD.draw;
    else if (o !== side) base = XP_REWARD.loss;
    else base = res.crush ? XP_REWARD.crush : XP_REWARD.win;
    return Math.round(base * mult);
  }

  // Начисляет опыт, повышает уровни (излишек переносится), копит невыбранные улучшения
  function addXp(e, amount) {
    const before = { xp: e.xp, level: e.level };
    e.xp += amount;
    let ups = 0;
    while (e.xp >= xpToNext(e.level)) { e.xp -= xpToNext(e.level); e.level++; ups++; }
    e.pending += ups;
    return { amount, before, after: { xp: e.xp, level: e.level }, ups };
  }

  // 3 разные случайные карточки из всего набора улучшений
  function rollUpgrades(n = 3) {
    return shuffle(UPGRADES).slice(0, Math.min(n, UPGRADES.length));
  }

  // Какой уровень герой сейчас «выбирает» (улучшения выбираются по порядку уровней)
  const pickLevel = (e) => e.level - e.pending + 1;

  // Карточки для очередного выбора: на 4-м уровне — строго усиление своей пассивки, +2 ко всему и «Ярость»,
  // на остальных — 3 случайные
  function cardsFor(e, id) {
    if (pickLevel(e) !== SPECIAL_LEVEL) return rollUpgrades(3);
    const ps = PASSIVES[id];
    return SPECIAL_UPGRADES.map((c) => (c.id === 'empower'
      ? { ...c, icon: ps.icon, name: `⚡ ${ps.name}`, desc: ps.up }
      : c));
  }

  // Травма ослабляет: за каждую полученную в бою травму −2 очка случайных характеристик
  // (оба в одну или по одному в разные), но характеристика не опускается ниже 1.
  // Возвращает { str: n, agi: n, end: n } — насколько уменьшилась каждая.
  const INJURY_STAT_LOSS = 2;
  function injuryPenalty(e, id, injuries) {
    const base = HERO_BY_ID[id].stats;
    const lost = { str: 0, agi: 0, end: 0 };
    for (let k = 0; k < injuries * INJURY_STAT_LOSS; k++) {
      const can = Object.keys(lost).filter((s) => base[s] + e.bonus[s] > 1);
      if (!can.length) break;
      const s = can[rnd(can.length)];
      e.bonus[s]--;
      lost[s]++;
    }
    return lost;
  }

  function applyUpgrade(e, up) {
    up.apply(e);
    e.picks.push(up.id);
    e.pending = Math.max(0, e.pending - 1);
  }

  // Исход матча: 'home' | 'away' | 'draw'. Старые сохранения без winner — по очкам.
  function outcome(res) {
    if (res.winner) return res.winner;
    if (res.winner === null) return 'draw';
    return res.home > res.away ? 'home' : res.home < res.away ? 'away' : 'draw';
  }

  /*
   * Круговая система, метод «многоугольника» (таблицы Бергера).
   * n участников (n чётно), R = n − 1 туров в круге.
   * Участник n−1 стоит в центре, остальные — по кругу.
   * Тур r (r = 0 … R−1):
   *   • центр играет с участником r;
   *   • пары i = 1 … n/2−1:  A = (r + i) mod R,  B = (r − i) mod R.
   * Хозяин поля чередуется по чётности r (для центра) и i (для остальных пар),
   * поэтому в круге у каждого 3–4 домашних матча.
   * Второй круг — зеркальный: те же пары в том же порядке, хозяева и гости меняются местами.
   */
  function bergerSchedule(ids) {
    const n = ids.length;
    const R = n - 1;
    const first = [];
    for (let r = 0; r < R; r++) {
      const round = [];
      round.push(r % 2 === 0 ? [ids[r], ids[n - 1]] : [ids[n - 1], ids[r]]);
      for (let i = 1; i < n / 2; i++) {
        const a = ids[(r + i) % R];
        const b = ids[(r - i + R) % R];
        round.push(i % 2 === 1 ? [b, a] : [a, b]);
      }
      first.push(round);
    }
    const second = first.map((round) => round.map(([h, a]) => [a, h]));
    return [...first, ...second].map((round) =>
      shuffle(round).map(([home, away]) => ({ home, away, result: null })));
  }

  function create(playerId, roster) {
    return {
      version: 1,
      playerId,
      roster,
      schedule: bergerSchedule(shuffle(HEROES.map((h) => h.id))),
      round: 0,
    };
  }

  function standings(state) {
    const rows = {};
    for (const h of HEROES) {
      rows[h.id] = { id: h.id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
    }
    for (const round of state.schedule) {
      for (const m of round) {
        if (!m.result) continue;
        const H = rows[m.home], A = rows[m.away];
        const hs = m.result.home, as = m.result.away;
        H.p++; A.p++;
        H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
        const o = outcome(m.result);
        if (o === 'home') { H.w++; A.l++; H.pts += 3; H.form.push('w'); A.form.push('l'); }
        else if (o === 'away') { A.w++; H.l++; A.pts += 3; A.form.push('w'); H.form.push('l'); }
        else { H.d++; A.d++; H.pts++; A.pts++; H.form.push('d'); A.form.push('d'); }
      }
    }
    return Object.values(rows).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || b.w - a.w ||
      HERO_BY_ID[a.id].name.localeCompare(HERO_BY_ID[b.id].name));
  }

  function heroMatches(state, id) {
    const list = [];
    state.schedule.forEach((round, r) => round.forEach((m) => {
      if (m.home === id || m.away === id) list.push({ round: r, match: m, home: m.home === id });
    }));
    return list;
  }

  const finished = (state) => state.round >= state.schedule.length;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.version === 1 && s.schedule && s.roster && HEROES.every((h) => s.roster[h.id])) {
        Object.values(s.roster).forEach(normalizeProgress); // старые сохранения — без прокачки
        return s;
      }
    } catch (e) { /* нет доступа к хранилищу */ }
    return null;
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { createRoster, updateInjuries, outcome, xpMultiplier, xpGain, addXp, rollUpgrades, cardsFor, pickLevel, injuryPenalty, applyUpgrade, bergerSchedule, create, standings, heroMatches, finished, load, save, clear };
})();
