'use strict';

/* =========================================================
 *  Графики сезона: места в таблице, характеристики и их сумма
 *  Окно открывается из турнирной таблицы (Charts.open).
 *  Линии — цвета героев; совпадающие значения разведены небольшим сдвигом,
 *  у концов линий — аватарки (опознание не только по цвету), при наведении — подсказка.
 * ========================================================= */

const Charts = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const LANE = 3.5; // сдвиг между линиями (px), чтобы совпадающие значения не сливались

  const METRICS = () => [
    { id: 'place', icon: '🏆', name: tr('Места', 'Places') },
    { id: 'str', icon: '💪', name: tr('Сила', 'Strength') },
    { id: 'agi', icon: '🤸', name: tr('Ловкость', 'Agility') },
    { id: 'end', icon: '🛡️', name: tr('Выносливость', 'Endurance') },
    { id: 'sum', icon: '∑', name: tr('Сумма', 'Total') },
  ];

  let st = null;      // состояние лиги
  let el = null;      // окно
  let season = 0;     // номер сезона на экране
  let metric = 'place';
  let shown = null;   // Set выбранных героев
  let focus = null;   // герой под курсором в легенде

  /* ---------- данные ---------- */
  function seasonData(n) {
    const cur = st.season || 1;
    if (n === cur) return { places: League.placesTrack(st.schedule), stats: st.statTrack || [] };
    const h = (st.history || []).find((x) => x.season === n);
    return h ? { places: h.places || [], stats: h.stats || [] } : { places: [], stats: [] };
  }

  const xLabel = (x) => (x === 0 ? tr('Старт', 'Start') : x === 'off' ? tr('Межсезонье', 'Off-season') : String(x));
  const xShort = (x) => (x === 0 ? tr('Ст', 'St') : x === 'off' ? tr('Меж', 'Off') : String(x));

  // Ряды: [{ x, values: { id: число } }]
  function rows() {
    const d = seasonData(season);
    if (metric === 'place') return d.places.map((p, i) => ({ x: i + 1, values: p }));
    return d.stats.map((p) => ({
      x: p.x,
      values: Object.fromEntries(Object.entries(p.stats).map(([id, s]) =>
        [id, metric === 'sum' ? s.str + s.agi + s.end : s[metric]])),
    }));
  }

  // «Красивые» деления оси
  function niceTicks(min, max) {
    const span = Math.max(1, max - min);
    const step = [1, 2, 5, 10].find((s) => span / s <= 8) || 10;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const t = [];
    for (let v = lo; v <= hi; v += step) t.push(v);
    return t;
  }

  /* ---------- отрисовка ---------- */
  function svg(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.append(n);
    return n;
  }

  function draw() {
    const box = el.querySelector('.ch-plot');
    box.innerHTML = '';
    const data = rows();
    const ids = HEROES.map((h) => h.id).filter((id) => shown.has(id));
    const empty = (msg) => { box.innerHTML = `<div class="ch-empty">${msg}</div>`; };
    if (!data.length) return empty(metric === 'place' ? tr('Ещё не сыграно ни одного тура', 'No rounds played yet') : tr('Нет данных о характеристиках за этот сезон', 'No attribute data for this season'));
    if (!ids.length) return empty(tr('Выберите героев ниже', 'Pick heroes below'));

    const W = Math.max(320, box.clientWidth), H = Math.max(260, box.clientHeight);
    const m = { l: 40, r: 46, t: 16, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'ch-svg' }, box);

    // оси
    const isPlace = metric === 'place';
    let yMin, yMax, ticks;
    if (isPlace) { yMin = 1; yMax = HEROES.length; ticks = HEROES.map((_, i) => i + 1); }
    else {
      const vals = data.flatMap((r) => ids.map((id) => r.values[id]).filter((v) => v != null));
      ticks = niceTicks(Math.min(...vals), Math.max(...vals));
      yMin = ticks[0]; yMax = ticks[ticks.length - 1];
      if (yMin === yMax) { yMin -= 1; yMax += 1; ticks = [yMin, yMin + 1, yMax]; }
    }
    // места: 1-е наверху
    const y = (v) => m.t + (isPlace ? (v - yMin) / (yMax - yMin) : (yMax - v) / (yMax - yMin)) * ih;
    const n = data.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);

    const grid = svg('g', { class: 'ch-grid' }, s);
    ticks.forEach((t) => {
      svg('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, grid);
      const lab = svg('text', { x: m.l - 10, y: y(t) + 4, 'text-anchor': 'end', class: 'ch-tick' }, grid);
      lab.textContent = t;
    });
    const narrow = iw / Math.max(1, n - 1) < 34;
    data.forEach((r, i) => {
      const lab = svg('text', { x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'ch-tick' + (r.x === 'off' ? ' off' : '') }, grid);
      lab.textContent = narrow ? xShort(r.x) : xLabel(r.x);
    });
    if (data.some((r) => r.x === 'off')) {
      const i = data.findIndex((r) => r.x === 'off');
      svg('rect', { x: x(i - 1) + (x(i) - x(i - 1)) / 2, y: m.t, width: (x(i) - x(i - 1)) / 2 + 12, height: ih, class: 'ch-off' }, grid);
    }

    // линии: сдвиг по полосам — одинаковые значения идут рядом, а не сливаются
    const lane = (id) => (ids.indexOf(id) - (ids.length - 1) / 2) * LANE;
    const lines = svg('g', { class: 'ch-lines' }, s);
    const ends = [];
    ids.forEach((id) => {
      const h = HERO_BY_ID[id];
      const pts = data.map((r, i) => (r.values[id] == null ? null : [x(i), y(r.values[id]) + lane(id)])).filter(Boolean);
      if (!pts.length) return;
      const g = svg('g', { class: 'ch-series' + (focus && focus !== id ? ' dim' : '') + (focus === id ? ' hot' : ''), 'data-id': id, style: `--hc:${h.color}` }, lines);
      const path = svg('path', { d: 'M' + pts.map((p) => p.join(',')).join('L'), class: 'ch-line' }, g);
      const len = path.getTotalLength ? path.getTotalLength() : 1000;
      path.style.setProperty('--len', len);
      pts.forEach((p) => svg('circle', { cx: p[0], cy: p[1], r: 4, class: 'ch-dot' }, g));
      ends.push({ id, x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
    });

    // аватарки у концов линий, разведённые по вертикали
    ends.sort((a, b) => a.y - b.y);
    const GAP = 22;
    ends.forEach((e, i) => { e.ly = i ? Math.max(e.y, ends[i - 1].ly + GAP) : e.y; });
    const over = ends.length ? ends[ends.length - 1].ly - (m.t + ih) : 0;
    if (over > 0) ends.forEach((e) => { e.ly -= over; });
    const tags = svg('g', { class: 'ch-ends' }, s);
    ends.forEach((e) => {
      const h = HERO_BY_ID[e.id];
      svg('line', { x1: e.x, y1: e.y, x2: e.x + 14, y2: e.ly, class: 'ch-lead', style: `--hc:${h.color}` }, tags);
      const fo = svg('foreignObject', { x: e.x + 14, y: e.ly - 10, width: 20, height: 20 }, tags);
      fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="ava ch-ava" style="${avatarStyle(h)}"></div>`;
    });

    // наведение: перекрестье и подсказка со значениями всех выбранных героев
    const cross = svg('line', { y1: m.t, y2: m.t + ih, class: 'ch-cross' }, s);
    const tip = document.createElement('div');
    tip.className = 'ch-tip';
    box.append(tip);
    const hit = svg('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, class: 'ch-hit' }, s);
    const move = (ev) => {
      const r = box.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      const row = data[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.classList.add('on');
      const list = ids.filter((id) => row.values[id] != null)
        .sort((a, b) => (isPlace ? row.values[a] - row.values[b] : row.values[b] - row.values[a]));
      tip.innerHTML = `<b>${row.x === 0 || row.x === 'off' ? xLabel(row.x) : `${tr('После тура', 'After round')} ${row.x}`}</b>` +
        list.map((id) => {
          const h = HERO_BY_ID[id];
          return `<span><i style="--hc:${h.color}"></i>${h.name}<em>${row.values[id]}${isPlace ? tr('-е', '') : ''}</em></span>`;
        }).join('');
      tip.classList.add('on');
      const tx = (x(i) / W) * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 6, Math.max(6, tx + 14 > r.width - tip.offsetWidth ? tx - tip.offsetWidth - 14 : tx + 14)) + 'px';
      tip.style.top = Math.max(6, ((ev.clientY - r.top) - tip.offsetHeight / 2)) + 'px';
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { tip.classList.remove('on'); cross.classList.remove('on'); });
  }

  /* ---------- окно ---------- */
  function render() {
    const cur = st.season || 1;
    const seasons = [...(st.history || []).map((h) => h.season), cur];
    el.innerHTML = `
      <div class="ch-box">
        <button class="ghost ch-close" aria-label="${tr('Закрыть', 'Close')}">✕</button>
        <div class="kicker">${tr('Графики', 'Charts')}</div>
        <h2>${tr('Сезон', 'Season')} ${romanNum(season)}${season === cur ? ` <small>${tr('текущий', 'current')}</small>` : ''}</h2>
        ${seasons.length > 1 ? `<div class="ch-seasons">${seasons.map((n) =>
          `<button class="ch-chip ${n === season ? 'active' : ''}" data-season="${n}">${tr('Сезон', 'Season')} ${romanNum(n)}</button>`).join('')}</div>` : ''}
        <div class="ch-metrics">${METRICS().map((mt) =>
          `<button class="ch-tab ${mt.id === metric ? 'active' : ''}" data-metric="${mt.id}"><span>${mt.icon}</span>${mt.name}</button>`).join('')}</div>
        <div class="ch-plot"></div>
        <div class="ch-heroes">
          ${HEROES.map((h) => `<button class="ch-hero ${shown.has(h.id) ? 'on' : ''}" data-ch="${h.id}" style="--hc:${h.color}">
            <span class="ava" style="${avatarStyle(h)}"></span>${h.name}</button>`).join('')}
          <span class="ch-all">
            <button class="ghost" data-all="1">${tr('Все', 'All')}</button>
            <button class="ghost" data-all="0">${tr('Никого', 'None')}</button>
          </span>
        </div>
        <p class="ch-note">${metric === 'place'
          ? tr('Место после каждого тура. Линии с одинаковым значением разведены на пару пикселей.', 'Place after each round. Lines with equal values are offset by a few pixels.')
          : tr('Значения на старте сезона, после каждого тура и — для прошлых сезонов — после межсезонья.', 'Values at the season start, after each round and, for past seasons, after the off-season.')}</p>
      </div>`;
    requestAnimationFrame(draw);
  }

  function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('ch-close')) { close(); return; }
    if (b.dataset.season) season = +b.dataset.season;
    else if (b.dataset.metric) metric = b.dataset.metric;
    else if (b.dataset.ch) { const id = b.dataset.ch; if (shown.has(id)) shown.delete(id); else shown.add(id); }
    else if (b.dataset.all) shown = new Set(b.dataset.all === '1' ? HEROES.map((h) => h.id) : []);
    else return;
    Sound.play('tick');
    render();
  }

  // подсветка линии героя при наведении на его кнопку
  function onOver(e) {
    const b = e.target.closest('.ch-hero');
    const id = b && shown.has(b.dataset.ch) ? b.dataset.ch : null;
    if (id === focus) return;
    focus = id;
    el.querySelectorAll('.ch-series').forEach((g) => {
      g.classList.toggle('dim', !!focus && g.dataset.id !== focus);
      g.classList.toggle('hot', g.dataset.id === focus);
    });
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  function onResize() { if (el) draw(); }

  function close() {
    if (!el) return;
    const node = el;
    el = null;
    node.classList.add('out');
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    setTimeout(() => node.remove(), 400);
  }

  function open(state) {
    if (el) return;
    st = state;
    season = st.season || 1;
    metric = 'place';
    focus = null;
    shown = new Set(HEROES.map((h) => h.id));
    el = document.createElement('div');
    el.className = 'charts';
    el.addEventListener('click', onClick);
    el.addEventListener('pointerover', onOver);
    document.getElementById('fx').append(el);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    Sound.play('whoosh');
    render();
  }

  return { open, close };
})();
