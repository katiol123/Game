'use strict';

/* =========================================================
 *  Боевые правила, пассивки и травмы героев (без DOM).
 *  Используются анимированным матчем, мгновенным досчётом и симуляцией баланса.
 *  Функции меняют состояние бойцов и возвращают описание события для визуала.
 * ========================================================= */

const Combat = (() => {
  // типы камней на поле
  const GEM = { red: 0, orange: 1, yellow: 2, green: 3, blue: 4, purple: 5 };
  const DUEL_MOVES = 3;          // «Дуэль на закате»: последние ходы каждого бойца
  const DUEL_ENEMY_FACTOR = 0.4; // доля урона соперника Пыли в дополнительных ударах
  const SOFA_BASE_DODGE = 0.1;   // «Невозмутимость»: базовый шанс уворота
  // «Два ствола»: множитель комбо для второй шкалы не выше cap, урон ударов со второй шкалы × dmgFactor
  const TWO_BARRELS = { cap: 2, dmgFactor: 0.5 };

  const count = (g, t) => g.reduce((s, row) => s + row.reduce((k, x) => k + (x === t), 0), 0);
  // «количество камней цвета минус 10», не меньше нуля
  const over10 = (g, t) => Math.max(0, count(g, t) - 10);

  /* ---------- травмы и пассивки ---------- */
  const hasInj = (p, id) => p.injuries.includes(id) || p.newInjuries.includes(id);
  // пассивка работает, если это её герой и она не отключена «Переломом ребра»
  const hasPassive = (p, id) => p.id === id && !p.noPassive;

  // Пересчёт параметров, зависящих от травм: «Перелом ноги» (−50% ловкости → дороже атака),
  // «Перелом ребра» (−20% макс. здоровья, пассивка отключена)
  function refresh(p) {
    const s = p.hero.stats;
    p.cost = COMBAT.attackCost({ ...s, agi: hasInj(p, 'leg') ? s.agi / 2 : s.agi });
    const full = COMBAT.maxHp(s);
    const max = hasInj(p, 'rib') ? Math.round(full * 0.8) : full;
    p.hp = p.maxHp === undefined ? max : Math.min(p.hp, max);
    p.maxHp = max;
    p.noPassive = hasInj(p, 'rib');
  }

  function fighter(hero) {
    const p = {
      hero,
      id: hero.id,
      dmg: COMBAT.damage(hero.stats),
      charge: hero.id === 'goose' ? [0, 0] : [0], // «Два ствола» — вторая шкала
      bleed: false,   // на бойце висит кровотечение (от Резака)
      aim: 0,         // стаки «Прицеливания» (Отмороз)
      snack: 0,       // стаки «Перекуса» (Шаурмен)
      injuries: (hero.injuries || []).map((i) => i.id), // травмы, с которыми вышел на бой
      newInjuries: [],                                  // травмы, полученные в этом бою
      injuriesDealt: 0, // сколько травм нанёс сопернику (бонус опыта)
      touched: false,   // получал или наносил урон в свой текущий ход
      score: 0,
      moves: 0,
      maxCombo: 0,
    };
    refresh(p);
    return p;
  }

  // Начало матча: «Выбитые зубы» с прошлых боёв — соперник стартует с половиной заряда на всех шкалах
  function matchStart(ps) {
    ps.forEach((p, i) => {
      if (!p.injuries.includes('teeth')) return;
      const opp = ps[1 - i];
      opp.charge = opp.charge.map(() => Math.floor(opp.cost / 2));
    });
  }

  // Множитель комбо с учётом «Сломанного носа»: ×2 → ×1, ×3 → ×2… (первый взрыв — ×1)
  const comboMult = (p, combo) => (hasInj(p, 'nose') && combo > 1 ? combo - 1 : combo);

  // Куда идут очки шага каскада: [{ bar, pts }]. base — очки шага без множителя комбо.
  // «Два ствола»: первая шкала заряжается как у всех, вторая — дополнительно от шагов с комбо ×2+.
  function chargeTargets(p, combo, base) {
    const m = comboMult(p, combo);
    const t = [{ bar: 0, pts: base * m }];
    if (hasPassive(p, 'goose') && combo >= 2) t.push({ bar: 1, pts: base * Math.min(m, TWO_BARRELS.cap) });
    return t;
  }

  // Начало хода: сбрасываем «касание», тикает кровотечение, «Сотрясение» может пропустить ход
  function startTurn(p, g, rnd = Math.random) {
    p.touched = false;
    const r = { bleed: 0, ko: false, skip: false };
    if (p.bleed && p.hp > 0) {
      r.bleed = over10(g, GEM.red) * 4;
      if (r.bleed > 0) { p.hp = Math.max(0, p.hp - r.bleed); p.touched = true; }
      r.ko = p.hp <= 0;
    }
    if (!r.ko && hasInj(p, 'concussion') && rnd() < Math.min(1, count(g, GEM.red) * 0.02)) r.skip = true;
    return r;
  }

  const duelOn = (players) => players.some((p) => hasPassive(p, 'dumpling'));
  // идёт ли у бойца «Дуэль на закате» (p.moves уже учитывает текущий ход)
  const duelTurn = (players, p, moveCap) => duelOn(players) && p.moves > moveCap - DUEL_MOVES;

  // Удар att по def. kind: 'charge' — от шкалы, 'charge2' — от второй шкалы «Двух стволов»,
  // 'ram' — «Таран», 'duel' — «Дуэль на закате»
  function hit(att, def, g, kind = 'charge', rnd = Math.random) {
    let base = att.dmg;
    if (kind === 'duel' && att.id !== 'dumpling') base = Math.ceil(att.dmg * DUEL_ENEMY_FACTOR);
    if (kind === 'charge2') base = Math.ceil(att.dmg * TWO_BARRELS.dmgFactor);
    const ev = { kind, base, dmg: 0, crit: false, missed: false, dodged: false, bleedApplied: false, drainPct: 0, aimLost: 0 };

    // «Перелом руки»: (3 × красных камней)% шанс промахнуться — удар пропадает целиком
    if (hasInj(att, 'arm') && rnd() < Math.min(1, count(g, GEM.red) * 0.03)) {
      ev.missed = true;
      return ev;
    }

    // криты: «Хедшот» (×2) и «Перекус» (×1,75)
    let mult = 1;
    if (hasPassive(att, 'granny') && att.aim > 0 && rnd() < Math.min(1, att.aim * 0.07)) { ev.crit = true; mult = 2; }
    else if (hasPassive(att, 'shawarma') && att.snack > 0 && rnd() < Math.min(1, att.snack * 0.03)) { ev.crit = true; mult = 1.75; }

    // «Невозмутимость»: шанс полностью проигнорировать удар
    if (hasPassive(def, 'sofa') && rnd() < Math.min(1, SOFA_BASE_DODGE + over10(g, GEM.purple) * 0.05)) ev.dodged = true;

    if (!ev.dodged) {
      // Травма определяется до расчёта урона: шанс выше при крите, тип — из тех, которых ещё нет
      if (rnd() < (ev.crit ? INJURY_CRIT_CHANCE : INJURY_CHANCE)) {
        const has = new Set([...def.injuries, ...def.newInjuries]);
        const free = INJURIES.filter((i) => !has.has(i.id));
        if (free.length) ev.injury = free[Math.floor(rnd() * free.length)].id;
      }
      // «Выбитые зубы»: вызвавший их удар — критический ×2, а если и так был критом — ×3
      if (ev.injury === 'teeth') { mult = ev.crit ? 3 : 2; ev.crit = true; }

      ev.dmg = Math.round(base * mult);
      def.hp = Math.max(0, def.hp - ev.dmg);
      att.touched = def.touched = true;

      if (ev.injury) {
        def.newInjuries.push(ev.injury);
        att.injuriesDealt++;
        if (ev.injury === 'teeth') def.charge = def.charge.map(() => 0); // обнуляет все шкалы заряда
        refresh(def); // эффекты травмы включаются сразу
      }

      // «Кровотечение»: шанс (красные − 10) × 5 % при попадании, до конца боя
      if (hasPassive(att, 'frog') && !def.bleed && def.hp > 0 && rnd() < Math.min(1, over10(g, GEM.red) * 0.05)) { def.bleed = true; ev.bleedApplied = true; }
    }

    // «Наручники»: каждая атака срезает процент накопленного заряда (со всех шкал)
    if (hasPassive(att, 'plumber')) {
      ev.drainPct = Math.min(100, over10(g, GEM.yellow) * 6);
      if (ev.drainPct > 0) def.charge = def.charge.map((c) => Math.floor(c * (1 - ev.drainPct / 100)));
    }

    // «Хедшот»: любой удар с участием Отмороза сбрасывает «Прицеливание»
    for (const p of [att, def]) if (p.id === 'granny' && p.aim > 0) { ev.aimLost = p.aim; p.aim = 0; }

    ev.ko = def.hp <= 0;
    return ev;
  }

  // Эффекты линии из 5+ камней: 'ram' — удар «Тараном», { heal } — «Перекус»
  function lineOfFive(p, g) {
    if (hasPassive(p, 'cat')) return { ram: true };
    if (hasPassive(p, 'shawarma')) {
      const heal = Math.max(0, Math.min(p.maxHp - p.hp, over10(g, GEM.green) * 4));
      p.hp += heal;
      p.snack++;
      return { heal, snack: p.snack };
    }
    return null;
  }

  // Конец хода: «Прицеливание» за ход без урона
  function endTurn(p) {
    if (hasPassive(p, 'granny') && !p.touched && p.hp > 0) { p.aim++; return { aim: p.aim }; }
    return null;
  }

  return {
    GEM, DUEL_MOVES, TWO_BARRELS, fighter, matchStart, comboMult, chargeTargets, startTurn,
    duelOn, duelTurn, hit, lineOfFive, endTurn, count, over10, hasInj, hasPassive,
  };
})();
