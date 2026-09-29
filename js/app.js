'use strict';

/* =========================================================
 *  Интерфейс: выбор героя, лига (таблица/расписание),
 *  страница героя, проведение тура, переходы между экранами
 * ========================================================= */

const App = (() => {
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MATCH_MOVES = 15;
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
    return { ...h, ...r, modelName: m.name, modelIcon: m.icon, modelDesc: m.desc, isPlayer: !!state && state.playerId === id };
  }

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
      return `<div class="stat">
        <span class="st-name">${s.icon} ${s.name}</span>
        <div class="bar"><i style="--v:${animate ? 0 : v / 20}" data-v="${v / 20}"></i></div>
        <b class="st-val" data-v="${v}">${animate ? 0 : v}</b><small>/20</small>
      </div>`;
    }).join('')}</div>`;
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
      ${statBars(h, true)}`;
    box.classList.remove('enter-l', 'enter-r', 'enter');
    void box.offsetWidth;
    box.classList.add(dir < 0 ? 'enter-l' : dir > 0 ? 'enter-r' : 'enter');
    animateBars(box);
  }

  function step(delta) {
    sel = (sel + delta + N) % N;
    layoutCarousel();
    renderInfo(delta);
  }

  function goTo(i) {
    let d = (((i - sel) % N) + N) % N;
    if (d > N / 2) d -= N;
    step(d);
  }

  function choose(e) {
    guarded(async () => {
      const h = HEROES[sel];
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
    const me = hero(state.playerId);
    const place = st.findIndex((r) => r.id === me.id) + 1;
    const total = state.schedule.length;
    const done = League.finished(state);
    const half = total / 2;

    if (done) {
      const champ = hero(st[0].id);
      $('tourInfo').innerHTML = `Сезон завершён · Чемпион: <b style="color:${champ.color}">👑 ${champ.name}</b>`;
    } else {
      $('tourInfo').textContent = `Тур ${state.round + 1} из ${total} · ${state.round < half ? 'первый' : 'второй'} круг`;
    }

    $('meChip').innerHTML = `${ava(me)}<div><small>Ваш герой</small>${link(me)}<span>${place}-е место</span></div>`;
    $('meChip').style.setProperty('--hc', me.color);

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

    const st = League.standings(state);
    const anyPlayed = st.some((r) => r.p > 0);
    pane.innerHTML = `
      <div class="table">
        <div class="t-row t-head">
          <span>#</span><span class="t-who">Герой</span>
          <span title="Игры">И</span><span title="Победы">В</span><span title="Ничьи">Н</span><span title="Поражения">П</span>
          <span class="c-gd" title="Очки в матчах: набрано и пропущено">Камни ±</span>
          <span title="Очки лиги">О</span><span class="c-form">Форма</span>
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
          </div>`;
        }).join('')}
      </div>
      <p class="legend">3 очка за победу, 1 — за ничью. При равенстве очков выше тот, у кого больше разница камней.</p>`;

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
          row.classList.add('gain');
          const tag = document.createElement('b');
          tag.className = 'gain-tag';
          tag.textContent = '+' + gained;
          row.querySelector('.pts').append(tag);
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
    const hw = res && res.home > res.away, aw = res && res.away > res.home;
    const draw = res && res.home === res.away;
    return `
      <div class="fixture ${res ? 'done' : ''} ${H.isPlayer || A.isPlayer ? 'mine' : ''}" style="--h1:${H.color};--h2:${A.color}">
        <div class="fx-side home ${hw ? 'win' : res ? 'lose' : ''}">
          ${ava(H)}<div class="fx-name">${link(H)}<small>дома${H.isPlayer ? ' · вы' : ''}</small></div>
        </div>
        <div class="fx-mid">
          ${res ? `<div class="fx-score"><b>${res.home}</b><i>:</i><b>${res.away}</b></div><small>${draw ? 'ничья' : 'завершён'}</small>`
                : '<div class="fx-vs">VS</div><small>предстоит</small>'}
        </div>
        <div class="fx-side away ${aw ? 'win' : res ? 'lose' : ''}">
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
          <h1 class="glitch" data-text="${h.name}">${h.name}${h.isPlayer ? ' <em class="you-tag">ВЫ</em>' : ''}</h1>
          ${statBars(h, true)}
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
            const k = my > their ? 'w' : my < their ? 'l' : 'd';
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
    await wait(1900 / Math.min(2, Engine.getSpeed()));
  }

  async function vsOut() {
    $('vs').className = 'vs show out';
    await wait(700);
    $('vs').className = 'vs';
  }

  function showResult(H, A, res, last) {
    return new Promise((resolve) => {
      const w = res.home === res.away ? null : res.home > res.away ? H : A;
      const card = $('resultCard');
      card.style.setProperty('--hc', w ? w.color : '#ffd21f');
      card.innerHTML = `
        <div class="res-sprites">${w ? `<img src="${w.sprite}" alt="" />` : `<img src="${H.sprite}" alt="" /><img src="${A.sprite}" alt="" />`}</div>
        <div class="kicker hc">${w ? 'Победа' : 'Ничья'}</div>
        <h2>${w ? w.name : 'Боевая ничья!'}</h2>
        <div class="res-score">
          <span style="color:${H.color}">${H.name}</span>
          <b>${res.home} : ${res.away}</b>
          <span style="color:${A.color}">${A.name}</span>
        </div>
        <p class="countdown" id="resCount"></p>
        <button class="cta" id="resNext"><span>${last ? 'К турнирной таблице' : 'Следующий матч'}</span></button>`;
      $('resultOverlay').classList.add('show');

      let left = 6;
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
      const playing = Engine.play({ home: H, away: A, moves: MATCH_MOVES, info });
      await vsOut();
      const res = await playing;
      m.result = { home: res.home, away: res.away };
      League.save(state);
      await showResult(H, A, res, round.every((x) => x.result));
    }

    state.round++;
    League.save(state);
    selRound = Math.min(state.round, state.schedule.length - 1);

    await guarded(() => blinds(() => {
      tab = 'table';
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
   *  Чемпион
   * ------------------------------------------------------- */
  function celebrate() {
    const st = League.standings(state);
    const champ = hero(st[0].id);
    const myPlace = st.findIndex((r) => r.id === state.playerId) + 1;
    const el = document.createElement('div');
    el.className = 'champ';
    el.style.setProperty('--hc', champ.color);
    const colors = HEROES.map((h) => h.color);
    el.innerHTML = `
      <div class="confetti">${Array.from({ length: 90 }, () =>
        `<i style="--x:${Math.random() * 100}vw;--d:${2.5 + Math.random() * 3}s;--dl:${-Math.random() * 5}s;--r:${Math.random() * 720}deg;background:${colors[Math.floor(Math.random() * colors.length)]}"></i>`).join('')}</div>
      <div class="champ-card">
        <div class="crown">👑</div>
        <img src="${champ.sprite}" alt="" />
        <div class="kicker hc">Чемпион Лиги Трёх Камней</div>
        <h2>${champ.name}</h2>
        <p>${st[0].pts} очков · ${st[0].w} побед · ${st[0].d} ничьих · ${st[0].l} поражений</p>
        <p class="my">${champ.isPlayer ? 'Это ваш герой! Поздравляем! 🎉' : `Ваш герой занял ${myPlace}-е место.`}</p>
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

    $('chooseBtn').addEventListener('click', choose);
    $('playBtn').addEventListener('click', playRound);
    $('newBtn').addEventListener('click', () => newTournament(false));
    $('heroBack').addEventListener('click', backToLeague);
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) switchTab(b.dataset.tab);
    });

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
    } else {
      show('select');
    }
  }

  init();
  return { state: () => state };
})();
