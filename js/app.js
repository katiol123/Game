'use strict';

/* =========================================================
 *  Интерфейс: выбор героя, лига (таблица/расписание),
 *  страница героя, проведение тура, переходы между экранами
 * ========================================================= */

const App = (() => {
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const N = HEROES.length;

  let state = League.load();
  let roster = state ? state.roster : League.createRoster();
  let screen = null;
  let tab = 'table';
  let sel = 0;
  let selRound = 0;
  let busy = false;
  let transitioning = false;

  // Герой со всеми данными текущего турнира
  function hero(id) {
    const h = HERO_BY_ID[id];
    const r = roster[id];
    const m = MODELS[r.model];
    // базовые характеристики — из data.js (в старых сохранениях были случайные), плюс прокачка
    const b = r.bonus || { str: 0, agi: 0, end: 0 };
    const stats = { str: h.stats.str + b.str, agi: h.stats.agi + b.agi, end: h.stats.end + b.end };
    return { ...h, ...r, baseStats: h.stats, bonus: b, stats, modelName: m.name, modelIcon: m.icon, modelDesc: m.desc,
      isPlayer: !!state && state.playerId === id };
  }

  // Медицинский крест с подсказкой о травмах (пусто, если травм нет)
  const injCross = (h, cls = '') => (h.injuries && h.injuries.length
    ? `<i class="inj ${cls}" data-tip="${injuryTip(h.injuries)}">✚</i>` : '');
  const ava = (h, cls = '') => `<div class="ava ${cls}" style="${avatarStyle(h)}"></div>`;
  const link = (h) => `<a href="#" class="hero-link" data-hero="${h.id}">${h.name}</a>`;

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + id));
    const el = $('scr-' + id);
    if (el) el.scrollTop = 0;
    screen = id;
    Engine.setActive(id === 'match');
    document.body.dataset.screen = id;
  }

  /* ---------------------------------------------------------
   *  Переходы
   * ------------------------------------------------------- */
  // «Портал»: круг цвета героя раскрывается из точки клика
  async function portal(x, y, color, swap) {
    const el = document.createElement('div');
    el.className = 'fx-portal';
    Sound.play('portal');
    el.style.setProperty('--pc', color);
    el.style.setProperty('--px', x + 'px');
    el.style.setProperty('--py', y + 'px');
    el.innerHTML = '<i></i><i></i><i></i>';
    $('fx').append(el);
    const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    await el.animate(
      [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${R}px at ${x}px ${y}px)` }],
      { duration: 850, easing: 'cubic-bezier(.75,0,.25,1)', fill: 'forwards' }).finished;
    swap();
    await wait(120);
    await el.animate(
      [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(1.35)', filter: 'blur(12px)' }],
      { duration: 650, easing: 'ease-out', fill: 'forwards' }).finished;
    el.remove();
  }

  // «Жалюзи»: полосы цветов всех героев накрывают экран волной и уходят
  async function blinds(swap, reverse = false) {
    const el = document.createElement('div');
    el.className = 'fx-blinds';
    Sound.play('blinds');
    const order = reverse ? HEROES.slice().reverse() : HEROES;
    el.innerHTML = order.map((h) => `<i style="--hc:${h.color}"></i>`).join('') +
      '<div class="fx-logo">◆ ◆ ◆</div>';
    $('fx').append(el);
    const strips = [...el.querySelectorAll('i')];
    const logo = el.querySelector('.fx-logo');
    await Promise.all(strips.map((s, i) => s.animate(
      [{ transform: 'scaleY(0)', transformOrigin: '50% 0%' }, { transform: 'scaleY(1)', transformOrigin: '50% 0%' }],
      { duration: 380, delay: i * 45, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' }).finished));
    logo.animate([{ opacity: 0, transform: 'scale(.5) rotate(-20deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }],
      { duration: 250, fill: 'forwards' });
    swap();
    await wait(260);
    logo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
    await Promise.all(strips.map((s, i) => s.animate(
      [{ transform: 'scaleY(1)', transformOrigin: '50% 100%' }, { transform: 'scaleY(0)', transformOrigin: '50% 100%' }],
      { duration: 420, delay: i * 45, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' }).finished));
    el.remove();
  }

  async function guarded(fn) {
    if (transitioning) return;
    transitioning = true;
    try { await fn(); } finally { transitioning = false; }
  }

  function stagger(container) {
    container.classList.remove('stagger');
    void container.offsetWidth;
    container.classList.add('stagger');
  }

  /* ---------------------------------------------------------
   *  Экран выбора: карусель
   * ------------------------------------------------------- */
  function statBars(h, animate) {
    return `<div class="stats">${STATS.map((s) => {
      const v = h.stats[s.key];
      const plus = h.bonus ? h.bonus[s.key] : 0;
      const k = Math.min(1, v / 20);
      return `<div class="stat">
        <span class="st-name">${s.icon} ${s.name}</span>
        <div class="bar"><i style="--v:${animate ? 0 : k}" data-v="${k}"></i></div>
        <b class="st-val" data-v="${v}">${animate ? 0 : v}</b><small>/20${plus ? ` <em class="st-bonus" title="Прокачка">+${plus}</em>` : ''}</small>
      </div>`;
    }).join('')}</div>
    <div class="combat">
      <span title="85 + выносливость × 10">❤ <b>${COMBAT.maxHp(h.stats)}</b> здоровья</span>
      <span title="17 + сила × 2">⚔ <b>${COMBAT.damage(h.stats)}</b> урона</span>
      <span title="6100 / (8,5 + ловкость)">⚡ атака за <b>${COMBAT.attackCost(h.stats)}</b> очков</span>
    </div>`;
  }

  function animateBars(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('.bar i').forEach((i) => i.style.setProperty('--v', i.dataset.v));
      root.querySelectorAll('.st-val').forEach((b) => {
        const target = +b.dataset.v;
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / 700);
          b.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }));
  }

  function passiveBadge(h) {
    const ps = PASSIVES[h.id];
    return `<div class="passive-badge"><span class="pb-icon">${ps.icon}</span>
      <div><small>Пассивное умение</small><b>${ps.name}</b><p>${ps.desc}</p></div></div>`;
  }

  function modelBadge(h) {
    return `<div class="model-badge"><span class="mb-icon">${h.modelIcon}</span>
      <div><small>Модель поведения</small><b>${h.modelName}</b><p>${h.modelDesc}</p></div></div>`;
  }

  function buildCarousel() {
    $('track').innerHTML = HEROES.map((h, i) => `
      <div class="c-card" data-i="${i}" style="--hc:${h.color}">
        <div class="c-halo"></div>
        <div class="c-pedestal"></div>
        <img class="c-sprite" src="${h.sprite}" alt="${h.name}" draggable="false" />
        <div class="c-plate">${h.name}</div>
      </div>`).join('');
    $('dots').innerHTML = HEROES.map((h, i) => `<button data-i="${i}" style="--hc:${h.color}" aria-label="${h.name}"></button>`).join('');

    $('track').addEventListener('click', (e) => {
      const card = e.target.closest('.c-card');
      if (!card) return;
      const i = +card.dataset.i;
      if (i !== sel) goTo(i);
    });
    $('dots').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) goTo(+b.dataset.i);
    });
    $('prevBtn').addEventListener('click', () => step(-1));
    $('nextBtn').addEventListener('click', () => step(1));

    let sx = null;
    $('carousel').addEventListener('pointerdown', (e) => { sx = e.clientX; });
    window.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    });

    layoutCarousel();
    renderInfo(0);
  }

  function layoutCarousel() {
    const w = $('carousel').clientWidth || innerWidth;
    const gap = Math.min(250, w * 0.27);
    document.querySelectorAll('.c-card').forEach((el) => {
      const i = +el.dataset.i;
      let d = (((i - sel) % N) + N) % N;
      if (d > N / 2) d -= N;
      const ad = Math.abs(d);
      el.style.transform =
        `translateX(-50%) translateX(${d * gap}px) translateZ(${-ad * 180}px) rotateY(${-d * 34}deg) scale(${d === 0 ? 1 : 0.84})`;
      el.style.opacity = ad >= 3 ? 0 : ad === 0 ? 1 : ad === 1 ? 0.8 : 0.4;
      el.style.zIndex = 10 - ad;
      el.style.filter = ad ? `brightness(${0.7 - ad * 0.12}) saturate(.55) blur(${ad * 1.2}px)` : 'none';
      el.style.pointerEvents = ad >= 3 ? 'none' : 'auto';
      el.classList.toggle('center', d === 0);
    });
    document.querySelectorAll('#dots button').forEach((b) => b.classList.toggle('active', +b.dataset.i === sel));
    const h = HEROES[sel];
    $('selGlow').style.backgroundColor = h.color;
    $('chooseBtn').style.setProperty('--hc', h.color);
  }

  function renderInfo(dir) {
    const h = hero(HEROES[sel].id);
    const box = $('hiInner');
    box.style.setProperty('--hc', h.color);
    box.innerHTML = `
      <div class="kicker hc">${h.title}</div>
      <h2 class="glitch" data-text="${h.name}">${h.name}</h2>
      ${statBars(h, true)}
      ${passiveBadge(h)}`;
    box.classList.remove('enter-l', 'enter-r', 'enter');
    void box.offsetWidth;
    box.classList.add(dir < 0 ? 'enter-l' : dir > 0 ? 'enter-r' : 'enter');
    animateBars(box);
  }

  function step(delta) {
    Sound.play('whoosh');
    sel = (sel + delta + N) % N;
    layoutCarousel();
    renderInfo(delta);
  }

  function goTo(i) {
    let d = (((i - sel) % N) + N) % N;
    if (d > N / 2) d -= N;
    step(d);
  }

  // spectator = true — турнир без своего героя, все матчи ИИ против ИИ
  function choose(e, spectator = false) {
    guarded(async () => {
      const h = spectator ? { id: null, color: '#8b3dff' } : HEROES[sel];
      Sound.play('select');
      state = League.create(h.id, roster);
      League.save(state);
      selRound = 0;
      const r = e.currentTarget.getBoundingClientRect();
      await portal(r.left + r.width / 2, r.top + r.height / 2, h.color, () => {
        tab = 'table';
        renderLeague();
        syncTabs(true);
        show('league');
        stagger($('pane-table'));
      });
    });
  }

  /* ---------------------------------------------------------
   *  Лига: шапка, вкладки
   * ------------------------------------------------------- */
  function renderLeague() {
    renderHeader();
    renderTable();
    renderSchedule();
  }

  function renderHeader() {
    const st = League.standings(state);
    const total = state.schedule.length;
    const done = League.finished(state);
    const half = total / 2;

    if (done) {
      const champ = hero(st[0].id);
      $('tourInfo').innerHTML = `Сезон завершён · Чемпион: <b style="color:${champ.color}">👑 ${champ.name}</b>`;
    } else {
      $('tourInfo').textContent = `Тур ${state.round + 1} из ${total} · ${state.round < half ? 'первый' : 'второй'} круг`;
    }

    if (state.playerId) {
      const me = hero(state.playerId);
      const place = st.findIndex((r) => r.id === me.id) + 1;
      $('meChip').innerHTML = `${ava(me)}<div><small>Ваш герой</small>${link(me)}<span>${place}-е место</span></div>`;
      $('meChip').style.setProperty('--hc', me.color);
    } else {
      $('meChip').innerHTML = '<div class="ava spect">👁</div><div><small>Режим</small><b>Зритель</b><span>ИИ против ИИ</span></div>';
      $('meChip').style.setProperty('--hc', '#8b3dff');
    }

    const btn = $('playBtn');
    btn.disabled = done;
    const started = !done && state.schedule[state.round].some((m) => m.result);
    btn.querySelector('span').textContent = done ? 'Сезон завершён'
      : started ? `▶ Продолжить тур ${state.round + 1}` : `▶ Играть тур ${state.round + 1}`;
  }

  function syncTabs(instant) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + tab));
    requestAnimationFrame(() => {
      const b = document.querySelector(`#tabs button[data-tab="${tab}"]`);
      const ink = $('tabInk');
      if (instant) ink.style.transition = 'none';
      ink.style.width = b.offsetWidth + 'px';
      ink.style.transform = `translateX(${b.offsetLeft}px)`;
      if (instant) requestAnimationFrame(() => (ink.style.transition = ''));
    });
  }

  // 3D-поворот панелей, как у кубика
  async function switchTab(t) {
    if (t === tab || transitioning) return;
    transitioning = true;
    Sound.play('tab');
    const from = $('pane-' + tab), to = $('pane-' + t);
    const dir = t === 'schedule' ? 1 : -1;
    tab = t;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const b = document.querySelector(`#tabs button[data-tab="${tab}"]`);
    $('tabInk').style.width = b.offsetWidth + 'px';
    $('tabInk').style.transform = `translateX(${b.offsetLeft}px)`;

    await from.animate([
      { transform: 'perspective(1600px) rotateY(0deg) translateZ(0)', opacity: 1 },
      { transform: `perspective(1600px) rotateY(${-75 * dir}deg) translateZ(-260px)`, opacity: 0 },
    ], { duration: 360, easing: 'cubic-bezier(.6,0,.9,.4)' }).finished;
    from.classList.remove('active');
    to.classList.add('active');
    stagger(to);
    await to.animate([
      { transform: `perspective(1600px) rotateY(${75 * dir}deg) translateZ(-260px)`, opacity: 0 },
      { transform: 'perspective(1600px) rotateY(0deg) translateZ(0)', opacity: 1 },
    ], { duration: 560, easing: 'cubic-bezier(.2,.9,.25,1.12)' }).finished;
    transitioning = false;
  }

  /* ---------------------------------------------------------
   *  Турнирная таблица
   * ------------------------------------------------------- */
  const FORM = { w: 'В', d: 'Н', l: 'П' };

  function renderTable({ flip = false } = {}) {
    const pane = $('pane-table');
    const oldRects = {};
    const oldPts = {};
    if (flip) {
      pane.querySelectorAll('.t-row[data-id]').forEach((r) => {
        oldRects[r.dataset.id] = r.getBoundingClientRect().top;
        oldPts[r.dataset.id] = +r.dataset.pts;
      });
    }

    if (flip) pane.classList.remove('stagger');
    const st = League.standings(state);
    const anyPlayed = st.some((r) => r.p > 0);
    pane.innerHTML = `
      <div class="table">
        <div class="t-row t-head">
          <span>#</span><span class="t-who">Герой</span>
          <span title="Игры">И</span><span title="Победы">В</span><span title="Ничьи">Н</span><span title="Поражения">П</span>
          <span class="c-gd" title="Очки в матчах: набрано и пропущено">Камни ±</span>
          <span title="Очки лиги">О</span><span class="c-form">Форма</span><span class="c-inj"></span>
        </div>
        ${st.map((r, i) => {
          const h = hero(r.id);
          const zone = i === 0 ? 'gold' : i < 3 ? 'podium' : i >= N - 1 ? 'last' : '';
          return `
          <div class="t-row ${h.isPlayer ? 'me' : ''} ${zone}" data-id="${r.id}" data-pts="${r.pts}" style="--hc:${h.color};--i:${i}">
            <span class="pos">${i === 0 && anyPlayed ? '👑' : i + 1}</span>
            <span class="t-who">${ava(h)}<span class="t-name">${link(h)}</span>${h.isPlayer ? '<em class="you-tag">ВЫ</em>' : ''}</span>
            <span>${r.p}</span><span>${r.w}</span><span>${r.d}</span><span>${r.l}</span>
            <span class="c-gd">${r.gf}<i>:</i>${r.ga}</span>
            <span class="pts">${r.pts}</span>
            <span class="c-form">${r.form.slice(-5).map((f) => `<i class="f-${f}">${FORM[f]}</i>`).join('') || '<i class="f-none">—</i>'}</span>
            <span class="c-inj">${injCross(h)}</span>
          </div>`;
        }).join('')}
      </div>
      <p class="legend">3 очка за победу нокаутом, по 1 — за ничью (нокаута не было за 15 ходов). При равенстве очков выше тот, у кого больше разница камней.</p>`;

    if (flip) {
      pane.querySelectorAll('.t-row[data-id]').forEach((row, i) => {
        const id = row.dataset.id;
        if (oldRects[id] === undefined) return;
        const dy = oldRects[id] - row.getBoundingClientRect().top;
        const gained = +row.dataset.pts - oldPts[id];
        row.animate([
          { transform: `translateY(${dy}px)`, zIndex: 5 },
          { transform: 'translateY(0)', zIndex: 5 },
        ], { duration: 1100, delay: 250 + i * 40, easing: 'cubic-bezier(.5,-0.3,.3,1.3)', fill: 'backwards' });
        if (gained > 0) {
          setTimeout(() => Sound.play('gain'), 1000 + i * 120);
          row.classList.add('gain');
          const tag = document.createElement('b');
          tag.className = 'gain-tag';
          tag.textContent = '+' + gained;
          row.querySelector('.pts').append(tag);
          // одноразовая анимация: убираем после проигрыша, иначе она повторится
          // при каждом возврате на вкладку (display:none → block перезапускает CSS-анимации)
          tag.addEventListener('animationend', () => tag.remove(), { once: true });
          setTimeout(() => row.classList.remove('gain'), 4200);
        }
      });
    }
  }

  /* ---------------------------------------------------------
   *  Расписание
   * ------------------------------------------------------- */
  function roundStatus(r) {
    const round = state.schedule[r];
    if (round.every((m) => m.result)) return 'played';
    if (r === state.round) return 'current';
    return 'future';
  }

  function renderSchedule() {
    const total = state.schedule.length;
    const half = total / 2;
    $('pane-schedule').innerHTML = `
      <div class="rounds-strip" id="roundsStrip">
        <span class="rs-label">Круг I</span>
        ${state.schedule.map((_, r) => `${r === half ? '<span class="rs-label">Круг II</span>' : ''}
          <button class="rs-chip ${roundStatus(r)} ${r === selRound ? 'sel' : ''}" data-r="${r}">${r + 1}</button>`).join('')}
      </div>
      <div class="round-view" id="roundView">${roundView(selRound)}</div>`;
    $('roundsStrip').addEventListener('click', (e) => {
      const b = e.target.closest('.rs-chip');
      if (b) pickRound(+b.dataset.r);
    });
  }

  function fixture(m) {
    const H = hero(m.home), A = hero(m.away);
    const res = m.result;
    const o = res ? League.outcome(res) : null;
    const hw = o === 'home', aw = o === 'away', draw = o === 'draw';
    const sideCls = (win) => (win ? 'win' : res && !draw ? 'lose' : '');
    return `
      <div class="fixture ${res ? 'done' : ''} ${H.isPlayer || A.isPlayer ? 'mine' : ''}" style="--h1:${H.color};--h2:${A.color}">
        <div class="fx-side home ${sideCls(hw)}">
          ${ava(H)}<div class="fx-name">${link(H)}<small>дома${H.isPlayer ? ' · вы' : ''}</small></div>
        </div>
        <div class="fx-mid">
          ${res ? `<div class="fx-score"><b>${res.home}</b><i>:</i><b>${res.away}</b></div><small>${draw ? 'ничья' : res.crush ? 'сокрушительная' : res.ko ? 'нокаут' : 'завершён'}</small>`
                : '<div class="fx-vs">VS</div><small>предстоит</small>'}
        </div>
        <div class="fx-side away ${sideCls(aw)}">
          <div class="fx-name">${link(A)}<small>в гостях${A.isPlayer ? ' · вы' : ''}</small></div>${ava(A)}
        </div>
      </div>`;
  }

  function roundView(r) {
    const half = state.schedule.length / 2;
    const status = roundStatus(r);
    const label = { played: 'сыгран', current: 'текущий тур', future: 'предстоит' }[status];
    return `
      <div class="rv-head">
        <h3>Тур ${r + 1}</h3>
        <span class="rv-circle">${r < half ? 'Первый круг' : 'Второй круг'}</span>
        <span class="rv-status ${status}">${label}</span>
      </div>
      <div class="fixtures stagger">${state.schedule[r].map((m, i) => fixture(m).replace('class="fixture', `style="--i:${i}" class="fixture`)).join('')}</div>`;
  }

  async function pickRound(r) {
    if (r === selRound) return;
    Sound.play('tick');
    const dir = r > selRound ? 1 : -1;
    selRound = r;
    document.querySelectorAll('.rs-chip').forEach((b) => b.classList.toggle('sel', +b.dataset.r === r));
    const view = $('roundView');
    await view.animate([
      { transform: 'translateX(0) skewX(0)', opacity: 1, filter: 'blur(0)' },
      { transform: `translateX(${-60 * dir}px) skewX(${8 * dir}deg)`, opacity: 0, filter: 'blur(6px)' },
    ], { duration: 220, easing: 'ease-in' }).finished;
    view.innerHTML = roundView(r);
    view.animate([
      { transform: `translateX(${60 * dir}px) skewX(${-8 * dir}deg)`, opacity: 0, filter: 'blur(6px)' },
      { transform: 'translateX(0) skewX(0)', opacity: 1, filter: 'blur(0)' },
    ], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
  }

  /* ---------------------------------------------------------
   *  Страница героя
   * ------------------------------------------------------- */
  function renderHero(id) {
    const h = hero(id);
    const st = League.standings(state);
    const place = st.findIndex((r) => r.id === id) + 1;
    const row = st[place - 1];
    const list = League.heroMatches(state, id);
    let best = 0;
    list.forEach(({ match, home }) => {
      if (match.result) best = Math.max(best, home ? match.result.home : match.result.away);
    });
    const pct = (v) => (row.p ? Math.round((v / row.p) * 100) : 0);

    $('heroPage').style.setProperty('--hc', h.color);
    $('heroPage').innerHTML = `
      <div class="hp-grid">
        <div class="hp-visual">
          <div class="hp-halo"></div>
          <div class="hp-rays"></div>
          <img class="hp-sprite" src="${h.sprite}" alt="${h.name}" />
          <div class="hp-rank"><small>место</small>${place}</div>
        </div>
        <div class="hp-info">
          <div class="kicker hc">${h.title}</div>
          <h1 class="glitch" data-text="${h.name}">${h.name}${h.isPlayer ? ' <em class="you-tag">ВЫ</em>' : ''}${injCross(h, 'big')}</h1>
          ${xpBlock(h)}
          ${statBars(h, true)}
          ${passiveBadge(h)}
          ${modelBadge(h)}
        </div>
      </div>

      <div class="record">
        <div class="rec"><b>${row.p}</b><small>Матчей</small></div>
        <div class="rec w"><b>${row.w}</b><small>Побед</small></div>
        <div class="rec d"><b>${row.d}</b><small>Ничьих</small></div>
        <div class="rec l"><b>${row.l}</b><small>Поражений</small></div>
        <div class="rec pts"><b>${row.pts}</b><small>Очков лиги</small></div>
      </div>
      <div class="wdl">
        <i class="w" style="flex:${row.w || 0.0001}">${row.w ? pct(row.w) + '%' : ''}</i>
        <i class="d" style="flex:${row.d || 0.0001}">${row.d ? pct(row.d) + '%' : ''}</i>
        <i class="l" style="flex:${row.l || 0.0001}">${row.l ? pct(row.l) + '%' : ''}</i>
        ${row.p ? '' : '<span>Ещё не сыграно ни одного матча</span>'}
      </div>
      <div class="hp-extra">
        <span>Набрано камней: <b>${row.gf}</b></span>
        <span>Пропущено: <b>${row.ga}</b></span>
        <span>Лучший матч: <b>${best}</b></span>
      </div>

      <h3 class="hp-sub">Матчи сезона</h3>
      <div class="hp-matches stagger">
        ${list.map(({ round, match, home }, i) => {
          const opp = hero(home ? match.away : match.home);
          const res = match.result;
          let badge = '<span class="res-badge f-none">—</span>', score = '<span class="soon">предстоит</span>';
          if (res) {
            const my = home ? res.home : res.away, their = home ? res.away : res.home;
            const o = League.outcome(res);
            const k = o === 'draw' ? 'd' : (o === 'home') === home ? 'w' : 'l';
            badge = `<span class="res-badge f-${k}">${FORM[k]}</span>`;
            score = `<b>${my} : ${their}</b>`;
          }
          return `<div class="hm-row ${res ? '' : 'future'}" style="--i:${i};--oc:${opp.color}">
            <span class="hm-round">Тур ${round + 1}</span>
            <span class="hm-where">${home ? '🏠 дома' : '✈️ в гостях'}</span>
            <span class="hm-opp">${ava(opp)}${link(opp)}</span>
            <span class="hm-score">${score}</span>${badge}
          </div>`;
        }).join('')}
      </div>`;
    animateBars($('heroPage'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const x = $('heroPage').querySelector('.xp-bar i');
      if (x) x.style.setProperty('--x', x.dataset.x);
    }));
  }

  // Уровень и шкала опыта (только в карточке героя)
  function xpBlock(h) {
    const need = xpToNext(h.level);
    const picks = {};
    h.picks.forEach((id) => { picks[id] = (picks[id] || 0) + 1; });
    const pickList = Object.entries(picks).map(([id, n]) => {
      const u = UPGRADE_BY_ID[id];
      return u ? `<span title="${u.name}: ${u.desc}">${u.icon} ×${n}</span>` : '';
    }).join('');
    return `<div class="xp">
      <div class="xp-top">
        <span class="xp-lvl">Уровень <b>${h.level}</b></span>
        <span class="xp-num"><b>${h.xp}</b> / ${need} опыта</span>
      </div>
      <div class="xp-bar"><i style="--x:0" data-x="${h.xp / need}"></i></div>
      ${pickList ? `<div class="xp-picks"><small>Улучшения:</small>${pickList}</div>` : ''}
    </div>`;
  }

  function openHero(id) {
    guarded(() => blinds(() => {
      renderHero(id);
      show('hero');
    }));
  }

  function backToLeague() {
    guarded(() => blinds(() => {
      renderLeague();
      syncTabs(true);
      show('league');
      stagger($('pane-' + tab));
    }, true));
  }

  /* ---------------------------------------------------------
   *  Матчи тура
   * ------------------------------------------------------- */
  function fillVsSide(el, h, where) {
    el.style.setProperty('--hc', h.color);
    el.innerHTML = `<img src="${h.sprite}" alt="" />
      <div class="vs-name"><small>${where}${h.isPlayer ? ' · ваш герой' : ''}</small><b>${h.name}</b></div>`;
  }

  async function vsIn(H, A, info) {
    fillVsSide($('vsLeft'), H, 'Дома');
    fillVsSide($('vsRight'), A, 'В гостях');
    $('vsInfo').textContent = info;
    const vs = $('vs');
    vs.className = 'vs';
    void vs.offsetWidth;
    vs.className = 'vs show';
    Sound.play('vs');
    await wait(1900 / Math.min(2, Engine.getSpeed()));
  }

  async function vsOut() {
    $('vs').className = 'vs show out';
    await wait(700);
    $('vs').className = 'vs';
  }

  // Строки начисления опыта в окне результата
  function xpRows(xp) {
    const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    const pct = (v) => (v > 0 ? '+' : '−') + Math.abs(Math.round(v * 100)) + '%';
    const mulTag = (mul) => {
      if (!mul || Math.abs(mul.mult - 1) < 1e-9) return '';
      const parts = [];
      if (mul.place) parts.push(`место ${pct(mul.place)}`);
      if (mul.level) parts.push(`уровень ${pct(mul.level)}`);
      if (mul.mult <= XP_MIN_MULT && 1 + mul.place + mul.level < XP_MIN_MULT) parts.push('минимум ×0,3');
      return ` <small class="xg-mul ${mul.mult < 1 ? 'down' : ''}" title="Разница с соперником: ${parts.join(', ')}">×${fmt(mul.mult)}</small>`;
    };
    return `<div class="xp-gain">${xp.map(({ h, g, mul }) => `
      <div class="xg-row ${g.amount ? '' : 'zero'}" style="--hc:${h.color}">
        ${ava(h)}
        <div class="xg-main">
          <div class="xg-top"><b>${h.name}</b><span class="xg-lvl">Ур. <em>${g.before.level}</em></span>
            <span class="xg-amt">+${g.amount} опыта${g.amount ? mulTag(mul) : ''}</span></div>
          <div class="xg-bar"><i style="width:${(g.before.xp / xpToNext(g.before.level)) * 100}%"></i></div>
          <div class="xg-num">${g.before.xp} / ${xpToNext(g.before.level)}</div>
        </div>
        <div class="xg-up">НОВЫЙ УРОВЕНЬ!</div>
      </div>`).join('')}</div>`;
  }

  // Анимация шкал опыта: дозаполнение, при повышении уровня — вспышка и перенос остатка
  function animateXp(xp) {
    const k = 1 / Math.min(2, Engine.getSpeed());
    document.querySelectorAll('#resultCard .xg-row').forEach((row, i) => {
      const { g } = xp[i];
      const bar = row.querySelector('.xg-bar i');
      const num = row.querySelector('.xg-num');
      const setNum = (x, lvl) => { num.textContent = `${x} / ${xpToNext(lvl)}`; };
      setTimeout(() => {
        if (!g.ups) {
          bar.style.width = (g.after.xp / xpToNext(g.after.level)) * 100 + '%';
          setNum(g.after.xp, g.after.level);
          return;
        }
        bar.style.width = '100%';
        setNum(xpToNext(g.before.level), g.before.level);
        setTimeout(() => {
          row.classList.add('leveled');
          row.querySelector('.xg-lvl em').textContent = g.after.level;
          Sound.play('levelup');
          bar.style.transition = 'none';
          bar.style.width = '0%';
          void bar.offsetWidth;
          bar.style.transition = '';
          bar.style.width = (g.after.xp / xpToNext(g.after.level)) * 100 + '%';
          setNum(g.after.xp, g.after.level);
        }, 750 * k);
      }, (600 + i * 250) * k);
    });
  }

  // Травмы, полученные в матче
  function injuryLine(H, A, res) {
    const items = [];
    [H, A].forEach((h, i) => (res.injuries[i] || []).forEach((id) => {
      const inj = INJURY_BY_ID[id];
      const e = roster[h.id].injuries.find((x) => x.id === id);
      items.push(`<span style="--hc:${h.color}"><b>${h.name}</b>: ${inj.icon} ${inj.name}${e ? ` — ${e.left} ${boutsWord(e.left)}` : ''}</span>`);
    }));
    return items.length ? `<div class="res-inj"><i>✚</i> Травмы: ${items.join('')}</div>` : '';
  }

  function showResult(H, A, res, last, xp = []) {
    return new Promise((resolve) => {
      const o = League.outcome(res);
      const w = o === 'home' ? H : o === 'away' ? A : null;
      const card = $('resultCard');
      card.style.setProperty('--hc', w ? w.color : '#ffd21f');
      card.innerHTML = `
        ${res.crush ? '<div class="crush-stamp">Сокрушительная победа</div>' : ''}
        <div class="res-sprites">${w ? `<img src="${w.sprite}" alt="" />` : `<img src="${H.sprite}" alt="" /><img src="${A.sprite}" alt="" />`}</div>
        <div class="kicker hc">${w ? (res.crush ? 'Сокрушительная победа нокаутом' : 'Победа нокаутом') : 'Ничья — нокаута не было'}</div>
        <h2>${w ? w.name : 'Оба устояли!'}</h2>
        <div class="res-score">
          <span style="color:${H.color}">${H.name}</span>
          <b>❤ ${res.hp[0]} : ${res.hp[1]} ❤</b>
          <span style="color:${A.color}">${A.name}</span>
        </div>
        <p class="res-sub">Очки за камни: ${res.home} : ${res.away}</p>
        ${injuryLine(H, A, res)}
        ${xp.length ? xpRows(xp) : ''}
        <p class="countdown" id="resCount"></p>
        <button class="cta" id="resNext"><span>${last ? 'К турнирной таблице' : 'Следующий матч'}</span></button>`;
      $('resultOverlay').classList.add('show');
      Sound.play(w ? 'win' : 'draw');
      if (xp.length) animateXp(xp);

      let left = xp.some((x) => x.g.ups) ? 8 : 6;
      let timer = null;
      const done = () => {
        clearInterval(timer);
        $('resultOverlay').classList.remove('show');
        resolve();
      };
      const tick = () => {
        if (Engine.isPaused()) return;
        if (left <= 0) { done(); return; }
        $('resCount').textContent = `${last ? 'Возврат к таблице' : 'Следующий матч'} через ${left}…`;
        left--;
      };
      tick();
      timer = setInterval(tick, 1000 / Math.min(2, Engine.getSpeed()));
      $('resNext').addEventListener('click', done, { once: true });
    });
  }

  async function playRound() {
    if (busy || transitioning || !state || League.finished(state)) return;
    busy = true;
    const r = state.round;
    const round = state.schedule[r];
    Sound.setTrack('match');

    await guarded(() => blinds(() => {
      $('resultOverlay').classList.remove('show');
      show('match');
    }));

    for (let k = 0; k < round.length; k++) {
      const m = round[k];
      if (m.result) continue;
      const H = hero(m.home), A = hero(m.away);
      const info = `Тур ${r + 1} · Матч ${k + 1} из ${round.length}`;
      await vsIn(H, A, info);
      $('skipBtn').hidden = H.isPlayer || A.isPlayer; // свой матч игрок играет сам
      const playing = Engine.play({ home: H, away: A, info });
      await vsOut();
      const res = await playing;
      // множитель опыта считается по таблице и уровням перед записью результата
      const st = League.standings(state);
      const place = (id) => st.findIndex((row) => row.id === id) + 1;
      const multFor = (me, opp) => League.xpMultiplier(
        state.round > 0 ? place(me.id) - place(opp.id) : 0, // в первом туре места ещё условные
        roster[opp.id].level - roster[me.id].level);
      m.result = { home: res.home, away: res.away, winner: res.winner, ko: res.ko, crush: res.crush, hp: res.hp };
      // опыт за бой обоим бойцам
      const xp = [[H, A, 'home'], [A, H, 'away']].map(([h, opp, side]) => {
        const mul = multFor(h, opp);
        return { h, mul, g: League.addXp(roster[h.id], League.xpGain(m.result, side, mul.mult)) };
      });
      // травмы: старые сокращаются на бой, полученные в этом бою добавляются на 2–4 боя
      League.updateInjuries(roster[H.id], res.injuries[0]);
      League.updateInjuries(roster[A.id], res.injuries[1]);
      League.save(state);
      await showResult(H, A, res, round.every((x) => x.result), xp);
      await resolveLevelUps([H.id, A.id]);
    }

    state.round++;
    League.save(state);
    selRound = Math.min(state.round, state.schedule.length - 1);

    Sound.setTrack('menu');
    await guarded(() => blinds(() => {
      tab = 'table';
      // без stagger-анимации появления строк: иначе при показе экрана и при перестройке
      // таблицы строки исчезают и появляются заново, прежде чем начнётся перестановка
      $('pane-table').classList.remove('stagger');
      syncTabs(true);
      renderHeader();
      show('league');
    }, true));
    renderTable({ flip: true });
    renderSchedule();
    busy = false;
    if (League.finished(state)) setTimeout(celebrate, 1500);
  }

  /* ---------------------------------------------------------
   *  Новый уровень: выбор одной из трёх карточек улучшений
   * ------------------------------------------------------- */
  // ИИ выбирает карточку случайно
  const aiPick = (cards) => cards[Math.floor(Math.random() * cards.length)];

  function levelUpScreen(id) {
    return new Promise((resolve) => {
      const h = hero(id);
      const cards = League.rollUpgrades(3);
      const human = h.isPlayer;
      const el = document.createElement('div');
      el.className = 'lvlup';
      el.style.setProperty('--hc', h.color);
      el.innerHTML = `
        <div class="lu-rays"></div>
        <div class="lu-box">
          <div class="lu-head">
            <img src="${h.sprite}" alt="" />
            <div>
              <div class="kicker hc">Новый уровень!</div>
              <h2>${h.name}</h2>
              <div class="lu-level">Уровень <b>${h.level - h.pending + 1}</b></div>
            </div>
          </div>
          <p class="lu-hint">${human ? 'Выберите улучшение' : 'ИИ выбирает улучшение…'}</p>
          <div class="lu-cards">${cards.map((c, i) => {
            const cur = c.stat ? h.stats[c.stat] : null;
            return `<button class="up-card" data-i="${i}" style="--i:${i}" ${human ? '' : 'disabled'}>
              <span class="uc-icon">${c.icon}</span><b>${c.name}</b><small>${c.desc}</small>
              ${cur !== null ? `<em>${cur} → ${cur + (c.amount || 1)}</em>` : ''}
            </button>`;
          }).join('')}</div>
        </div>`;
      $('fx').append(el);
      Sound.play('levelup');
      const k = 1 / Math.min(2, Engine.getSpeed());

      const choose = (i) => {
        if (el.dataset.done) return;
        el.dataset.done = '1';
        const up = cards[i];
        League.applyUpgrade(roster[id], up);
        League.save(state);
        Sound.play('select');
        el.querySelectorAll('.up-card').forEach((b, j) => b.classList.add(j === i ? 'chosen' : 'faded'));
        el.querySelector('.lu-hint').textContent = `${human ? 'Выбрано' : 'ИИ выбрал'}: ${up.icon} ${up.name} — ${up.desc}`;
        setTimeout(() => {
          el.classList.add('out');
          setTimeout(() => { el.remove(); resolve(); }, 450);
        }, 1300 * k);
      };
      if (human) {
        el.querySelector('.lu-cards').addEventListener('click', (e) => {
          const b = e.target.closest('.up-card');
          if (b) choose(+b.dataset.i);
        });
      } else {
        const pick = aiPick(cards);
        setTimeout(() => choose(cards.indexOf(pick)), 1500 * k);
      }
    });
  }

  // Проводит все невыбранные улучшения указанных героев (по одному экрану на уровень)
  async function resolveLevelUps(ids) {
    for (const id of ids) {
      while (roster[id].pending > 0) await levelUpScreen(id);
    }
  }

  /* ---------------------------------------------------------
   *  Чемпион
   * ------------------------------------------------------- */
  function celebrate() {
    const st = League.standings(state);
    const champ = hero(st[0].id);
    const myPlace = st.findIndex((r) => r.id === state.playerId) + 1;
    const el = document.createElement('div');
    el.className = 'champ';
    Sound.play('champion');
    el.style.setProperty('--hc', champ.color);
    const colors = HEROES.map((h) => h.color);
    el.innerHTML = `
      <div class="confetti">${Array.from({ length: 90 }, () =>
        `<i style="--x:${Math.random() * 100}vw;--d:${2.5 + Math.random() * 3}s;--dl:${-Math.random() * 5}s;--r:${Math.random() * 720}deg;background:${colors[Math.floor(Math.random() * colors.length)]}"></i>`).join('')}</div>
      <div class="champ-card">
        <div class="crown">👑</div>
        <img src="${champ.sprite}" alt="" />
        <div class="kicker hc">Чемпион Лиги Шести Камней</div>
        <h2>${champ.name}</h2>
        <p>${st[0].pts} очков · ${st[0].w} побед · ${st[0].d} ничьих · ${st[0].l} поражений</p>
        <p class="my">${!state.playerId ? 'Вы наблюдали за турниром как зритель.'
          : champ.isPlayer ? 'Это ваш герой! Поздравляем! 🎉' : `Ваш герой занял ${myPlace}-е место.`}</p>
        <div class="champ-actions">
          <button class="ghost" data-act="close">К таблице</button>
          <button class="cta" data-act="new"><span>Новый турнир</span></button>
        </div>
      </div>`;
    $('fx').append(el);
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
      if (act.dataset.act === 'new') newTournament(true);
    });
  }

  function newTournament(skipConfirm) {
    if (busy) return;
    if (!skipConfirm && !confirm('Начать новый турнир? Текущие результаты будут потеряны.')) return;
    League.clear();
    state = null;
    roster = League.createRoster();
    sel = 0;
    guarded(() => blinds(() => {
      show('select');
      layoutCarousel();
      renderInfo(0);
    }, true));
  }

  /* ---------------------------------------------------------
   *  Управление матчем
   * ------------------------------------------------------- */
  function setPaused(v) {
    Engine.setPaused(v);
    $('pauseBtn').textContent = v ? '▶ Продолжить' : '⏸ Пауза';
  }

  function setSpeed(v) {
    Engine.setSpeed(v);
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('active', +b.dataset.speed === v));
    try { localStorage.setItem('match3-speed', v); } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------
   *  Инициализация
   * ------------------------------------------------------- */
  function init() {
    Engine.init();
    buildCarousel();

    $('chooseBtn').addEventListener('click', (e) => choose(e));
    $('spectateBtn').addEventListener('click', (e) => choose(e, true));
    $('playBtn').addEventListener('click', playRound);
    $('newBtn').addEventListener('click', () => newTournament(false));
    $('heroBack').addEventListener('click', backToLeague);
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) switchTab(b.dataset.tab);
    });

    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.matches('#chooseBtn, #spectateBtn, #tabs button, .rs-chip, .nav, #dots button, #playBtn, .audio-ctl button')) Sound.play('click');
    });
    const syncAudioBtns = () => {
      $('musicBtn').classList.toggle('off', !Sound.musicOn());
      $('sfxBtn').classList.toggle('off', !Sound.sfxOn());
    };
    $('musicBtn').addEventListener('click', () => { Sound.toggleMusic(); syncAudioBtns(); });
    $('sfxBtn').addEventListener('click', () => { if (Sound.toggleSfx()) Sound.play('click'); syncAudioBtns(); });
    syncAudioBtns();

    $('pauseBtn').addEventListener('click', () => setPaused(!Engine.isPaused()));
    $('skipBtn').addEventListener('click', () => { setPaused(false); Engine.skip(); });
    document.querySelectorAll('#speed button').forEach((b) =>
      b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    try {
      const sp = parseFloat(localStorage.getItem('match3-speed'));
      if ([0.5, 1, 2, 4].includes(sp)) setSpeed(sp);
    } catch (e) { /* ignore */ }

    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-hero]');
      if (!a) return;
      e.preventDefault();
      if (screen === 'league' || screen === 'hero') openHero(a.dataset.hero);
    });

    document.addEventListener('keydown', (e) => {
      if (screen === 'select') {
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
        if (e.key === 'Enter') $('chooseBtn').click();
      } else if (screen === 'match' && e.code === 'Space') {
        e.preventDefault();
        setPaused(!Engine.isPaused());
      } else if (screen === 'hero' && e.key === 'Escape') {
        backToLeague();
      }
    });

    window.addEventListener('resize', () => {
      layoutCarousel();
      if (screen === 'league') syncTabs(true);
    });

    if (state) {
      selRound = Math.min(state.round, state.schedule.length - 1);
      renderLeague();
      syncTabs(true);
      show('league');
      stagger($('pane-table'));
      // страницу закрыли во время выбора улучшения — предлагаем выбрать снова
      if (HEROES.some((h) => roster[h.id].pending > 0)) {
        setTimeout(() => { busy = true; resolveLevelUps(HEROES.map((h) => h.id)).then(() => { busy = false; }); }, 900);
      }
    } else {
      show('select');
    }
  }

  init();
  return { state: () => state };
})();
