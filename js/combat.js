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
  const SOFA_BASE_DODGE = 0.1;
  const BLEED_BASE = 0.075;      // «Кровотечение»: базовый шанс, к нему + (красные − 10) × 5 %   // «Невозмутимость»: базовый шанс уворота
  // «Два ствола»: множитель комбо для второй шкалы не выше cap, урон ударов со второй шкалы × dmgFactor
  const TWO_BARRELS = { cap: 2, capUp: 2.5, dmgFactor: 0.5, dmgFactorUp: 0.75 };
  // «Таран»: на каком шаге каскада срабатывает и какая доля урона (обычная / усиленная)
  const RAM = { combo: 4, dmg: 0.5, dmgUp: 0.65 };
  // «Перекус»: шаг каскада, лечение (база + за каждый зелёный сверх 10; усиленное) и шанс крита за стак
  const SNACK = { combo: 3, base: { heal: 10, perGreen: 5 }, up: { heal: 14, perGreen: 7 }, crit: 0.05, critUp: 0.07, critMult: 1.75 };
  // «Наручники»: доля заряда соперника, которую срезает каждая атака Хэртли (+ за каждую звезду сверх 10)
  const HANDCUFFS = { base: { pct: 20, perStar: 4 }, up: { pct: 28, perStar: 5 } };

  const count = (g, t) => g.reduce((s, row) => s + row.reduce((k, x) => k + (x === t), 0), 0);
  // «количество камней цвета минус 10», не меньше нуля
  const over10 = (g, t) => Math.max(0, count(g, t) - 10);

  /* ---------- травмы и пассивки ---------- */
  const hasInj = (p, id) => p.injuries.includes(id) || p.newInjuries.includes(id);
  // пассивка работает, если это её герой и она не отключена «Переломом ребра»
  const hasPassive = (p, id) => p.id === id && !p.noPassive;
  // пассивка усилена особой карточкой уровня
  const upPassive = (p, id) => hasPassive(p, id) && p.empowered;

  // Пересчёт параметров, зависящих от травм: «Перелом ноги» (−50% ловкости → дороже атака),
  // «Перелом ребра» (−20% макс. здоровья, пассивка отключена)
  // p.stats — текущие характеристики (могут вырасти от «Ярости»); рост макс. здоровья добавляется и к текущему
  function refresh(p) {
    const s = p.stats;
    p.dmg = COMBAT.damage(s);
    p.cost = COMBAT.attackCost({ ...s, agi: hasInj(p, 'leg') ? s.agi / 2 : s.agi });
    const full = COMBAT.maxHp(s);
    const max = hasInj(p, 'rib') ? Math.round(full * 0.8) : full;
    if (p.maxHp === undefined) p.hp = max;
    else p.hp = max > p.maxHp ? p.hp + (max - p.maxHp) : Math.min(p.hp, max);
    p.maxHp = max;
    p.noPassive = hasInj(p, 'rib');
  }

  function fighter(hero) {
    const picks = hero.picks || [];
    const p = {
      hero,
      id: hero.id,
      stats: { ...hero.stats },
      empowered: picks.includes('empower'), // усиленная пассивка (особая карточка уровня)
      rageReady: picks.includes('rage'),    // перк «Ярость»
      raging: false,
      rageSrc: null,                        // откуда ярость: 'perk' (набрал очки) или 'momentum' («Кураж»)
      baseStats: { ...hero.stats },         // характеристики до ярости
      // редкие перки
      luck: picks.includes('luck'),
      bones: picks.includes('bones'),
      shield: picks.includes('shield'),
      vamp: picks.includes('vamp'),
      secondWind: picks.includes('wind'),
      windUsed: false,
      momentum: !!hero.momentum && picks.includes('momentum'), // начинает бой «на кураже»
      homeBonus: picks.includes('home'), // «Родные стены»
      fury: picks.includes('fury'),      // «Праведный гнев»
      charge: hero.id === 'goose' ? [0, 0] : [0], // «Два ствола» — вторая шкала
      bleed: false,   // на бойце висит кровотечение (от Резака)
      bleedPer: 4,    // урон кровотечения за каждый красный камень сверх 10
      aim: 0,         // стаки «Прицеливания» (Отмороз)
      snack: 0,       // стаки «Перекуса» (Шаурмен)
      injuries: (hero.injuries || []).map((i) => i.id), // травмы, с которыми вышел на бой
      newInjuries: [],                                  // травмы, полученные в этом бою
      injuriesDealt: 0, // сколько травм нанёс сопернику (бонус опыта)
      touched: false,   // получал или наносил урон в свой текущий ход
      score: 0,
      moves: 0,
      maxCombo: 0,
      // статистика боя (итоги тура)
      attacks: 0,   // сколько ударов нанёс (включая промахи и увороты соперника)
      dmgDealt: 0,  // суммарный урон ударами
      maxHit: 0,    // сильнейший удар
    };
    refresh(p);
    return p;
  }

  // Начало матча: «Выбитые зубы» с прошлых боёв — соперник стартует с половиной заряда на всех шкалах
  function matchStart(ps) {
    // «Кураж»: после сокрушительной победы бой начинается в ярости
    ps.forEach((p) => { if (p.momentum) startRage(p, 'momentum'); });
    // «Родные стены»: хозяин боя (первый в паре) начинает с +400 очками
    if (ps[0].homeBonus) { ps[0].score += PERKS.home.points; ps[0].homeStart = PERKS.home.points; }
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
    if (hasPassive(p, 'goose') && combo >= 2) {
      t.push({ bar: 1, pts: base * Math.min(m, upPassive(p, 'goose') ? TWO_BARRELS.capUp : TWO_BARRELS.cap) });
    }
    return t;
  }

  // Начало хода: сбрасываем «касание», тикает кровотечение, «Сотрясение» может пропустить ход
  function startTurn(p, g, rnd = Math.random) {
    p.touched = false;
    const r = { bleed: 0, ko: false, skip: false };
    if (p.bleed && p.hp > 0) {
      r.bleed = over10(g, GEM.red) * p.bleedPer;
      if (r.bleed > 0) { p.hp = Math.max(0, p.hp - r.bleed); p.touched = true; }
      if (p.hp <= 0 && tryRevive(p, rnd)) r.revived = true;
      r.ko = p.hp <= 0;
    }
    if (!r.ko && hasInj(p, 'concussion') && rnd() < Math.min(1, count(g, GEM.red) * 0.02)) r.skip = true;
    return r;
  }

  const duelOn = (players) => players.some((p) => hasPassive(p, 'dumpling'));
  // идёт ли у бойца «Дуэль на закате» (p.moves уже учитывает текущий ход)
  // сколько последних ходов идёт дуэль (усиленная — на 1 больше)
  const duelMoves = (players) => (players.some((p) => upPassive(p, 'dumpling')) ? DUEL_MOVES + 1 : DUEL_MOVES);
  const duelTurn = (players, p, moveCap) => duelOn(players) && p.moves > moveCap - duelMoves(players);

  // Удар att по def. kind: 'charge' — от шкалы, 'charge2' — от второй шкалы «Двух стволов»,
  // 'ram' — «Таран», 'duel' — «Дуэль на закате»
  function hit(att, def, g, kind = 'charge', rnd = Math.random) {
    // фактический урон: базовый × КУ (зависит от набранных в бою очков); доли ударов пассивок — от него
    // «Праведный гнев»: +30% урона, пока у соперника больше текущего здоровья
    const fury = furyActive(att, def);
    const eff = att.dmg * dmgMult(att) * (fury ? PERKS.fury.mult : 1);
    let base = Math.max(1, Math.round(eff));
    if (kind === 'duel' && att.id !== 'dumpling') base = Math.ceil(eff * DUEL_ENEMY_FACTOR);
    if (kind === 'charge2') base = Math.ceil(eff * (upPassive(att, 'goose') ? TWO_BARRELS.dmgFactorUp : TWO_BARRELS.dmgFactor));
    if (kind === 'ram') base = Math.round(eff * (upPassive(att, 'cat') ? RAM.dmgUp : RAM.dmg));
    const ev = { kind, base, dmg: 0, crit: false, missed: false, dodged: false, bleedApplied: false, drainPct: 0, aimLost: 0, fury };
    att.attacks++;

    // «Перелом руки»: (3 × красных камней)% шанс промахнуться — удар пропадает целиком
    if (hasInj(att, 'arm') && rnd() < Math.min(1, count(g, GEM.red) * 0.03)) {
      ev.missed = true;
      return ev;
    }

    // криты: «Хедшот» (×2), «Перекус» (×1,75) и перк «Удача» (×2). Шансы складываются, бросок один:
    // сначала проверяется шанс пассивки (со своим множителем), сверху — шанс «Удачи»
    let mult = 1;
    let pc = 0, pm = 1;
    if (hasPassive(att, 'granny') && att.aim > 0) { pc = att.aim * (upPassive(att, 'granny') ? 0.09 : 0.07); pm = 2; }
    else if (hasPassive(att, 'shawarma') && att.snack > 0) { pc = att.snack * (upPassive(att, 'shawarma') ? SNACK.critUp : SNACK.crit); pm = SNACK.critMult; }
    const lc = luckChance(att, def);
    if (pc + lc > 0) {
      const r = rnd();
      if (r < pc) { ev.crit = true; mult = pm; }
      else if (r < pc + lc) { ev.crit = true; mult = PERKS.luck.mult; ev.luck = true; }
    }

    // «Невозмутимость»: шанс полностью проигнорировать удар
    const dodgeBase = SOFA_BASE_DODGE + (upPassive(def, 'sofa') ? 0.05 : 0);
    if (hasPassive(def, 'sofa') && rnd() < Math.min(1, dodgeBase + over10(g, GEM.purple) * 0.05)) ev.dodged = true;

    if (!ev.dodged) {
      // Травма определяется до расчёта урона: шанс выше при крите, тип — из тех, которых ещё нет
      // «Ярость» даёт иммунитет к травмам, «Твёрдые кости» вдвое снижают шанс
      const injChance = (ev.crit ? INJURY_CRIT_CHANCE : INJURY_CHANCE) * (def.bones ? PERKS.bones.factor : 1);
      if (!def.raging && rnd() < injChance) {
        const has = new Set([...def.injuries, ...def.newInjuries]);
        const free = INJURIES.filter((i) => !has.has(i.id));
        if (free.length) ev.injury = free[Math.floor(rnd() * free.length)].id;
      }
      // «Выбитые зубы»: вызвавший их удар — критический ×2, а если и так был критом — ×3
      if (ev.injury === 'teeth') { mult = ev.crit ? 3 : 2; ev.crit = true; }

      ev.dmg = Math.round(base * mult);
      // «Круглый щит»: блокирует часть урона, пока защитник впереди по очкам
      const block = shieldBlock(def, att);
      if (block > 0) { ev.blocked = Math.min(block, ev.dmg); ev.dmg -= ev.blocked; }
      def.hp = Math.max(0, def.hp - ev.dmg);
      att.touched = def.touched = true;
      att.dmgDealt += ev.dmg;
      att.maxHit = Math.max(att.maxHit, ev.dmg);
      // «Вампиризм»: каждый попавший удар лечит на (фиолетовых − 7) × 3
      if (att.vamp && att.hp > 0) {
        ev.vamp = Math.max(0, Math.min(att.maxHp - att.hp, Math.max(0, count(g, GEM.purple) - PERKS.vamp.over) * PERKS.vamp.per));
        att.hp += ev.vamp;
      }
      // «Второе дыхание»: смертельный удар — шанс остаться с 1 здоровья (раз за бой)
      if (def.hp <= 0 && tryRevive(def, rnd)) ev.revived = true;

      if (ev.injury) {
        def.newInjuries.push(ev.injury);
        att.injuriesDealt++;
        if (ev.injury === 'teeth') def.charge = def.charge.map(() => 0); // обнуляет все шкалы заряда
        refresh(def); // эффекты травмы включаются сразу
      }

      // «Кровотечение»: шанс 7,5% + (красные − 10) × 5 % при попадании, до конца боя
      if (hasPassive(att, 'frog') && !def.bleed && def.hp > 0 && rnd() < Math.min(1, BLEED_BASE + over10(g, GEM.red) * 0.05)) {
        def.bleed = true;
        def.bleedPer = upPassive(att, 'frog') ? 5 : 4;
        ev.bleedApplied = true;
      }
    }

    // «Наручники»: каждая атака срезает процент накопленного заряда (со всех шкал)
    if (hasPassive(att, 'plumber')) {
      const cuffs = upPassive(att, 'plumber') ? HANDCUFFS.up : HANDCUFFS.base;
      ev.drainPct = Math.min(100, cuffs.pct + over10(g, GEM.yellow) * cuffs.perStar);
      if (ev.drainPct > 0) def.charge = def.charge.map((c) => Math.floor(c * (1 - ev.drainPct / 100)));
    }

    // «Хедшот»: любой удар с участием Отмороза сбрасывает «Прицеливание»
    for (const p of [att, def]) if (p.id === 'granny' && p.aim > 0) { ev.aimLost = p.aim; p.aim = 0; }

    ev.ko = def.hp <= 0;
    return ev;
  }

  // «Таран»: удар без траты заряда, когда каскад доходит до комбо ×RAM.combo (раз за ход)
  const ramOnCombo = (p, combo) => hasPassive(p, 'cat') && combo === RAM.combo;

  // «Перекус» Шаурмена: когда каскад доходит до комбо ×SNACK.combo (раз за ход) — лечение и стак крита
  const snackOnCombo = (p, combo) => hasPassive(p, 'shawarma') && combo === SNACK.combo;
  function snack(p, g) {
    const s = upPassive(p, 'shawarma') ? SNACK.up : SNACK.base;
    const heal = Math.max(0, Math.min(p.maxHp - p.hp, s.heal + over10(g, GEM.green) * s.perGreen));
    p.hp += heal;
    p.snack++;
    return { heal, snack: p.snack };
  }

  /* ---------- динамический урон ---------- */
  // КУ — коэффициент усиления урона: очки в бою / DYN_DMG.per, но не меньше DYN_DMG.min
  const dmgMult = (p) => Math.max(DYN_DMG.min, p.score / DYN_DMG.per);
  // фактический урон обычного удара
  const curDmg = (p) => Math.max(1, Math.round(p.dmg * dmgMult(p)));

  /* ---------- редкие перки ---------- */
  // «Удача»: +12% шанса крита ×2 за каждые 700 набранных в бою очков
  const luckChance = (p) => (p.luck ? Math.floor(p.score / PERKS.luck.step) * PERKS.luck.per : 0);
  // «Круглый щит»: за каждые 700 очков блокирует 10 урона, пока боец впереди по очкам, иначе 5
  const shieldBlock = (p, opp) => (p.shield
    ? Math.floor(p.score / PERKS.shield.step) * (p.score > opp.score ? PERKS.shield.per : PERKS.shield.perBehind) : 0);
  // «Праведный гнев»: действует, пока у соперника больше текущего здоровья
  const furyActive = (p, opp) => p.fury && opp.hp > p.hp;
  // «Второе дыхание»: раз за бой при смертельном уроне шанс 50% остаться с 1 здоровья
  function tryRevive(p, rnd = Math.random) {
    if (!p.secondWind || p.windUsed) return false;
    p.windUsed = true;
    if (rnd() >= PERKS.wind.chance) return false;
    p.hp = 1;
    return true;
  }

  // «Ярость»: +30% ко всем характеристикам (не выше 20) и иммунитет к травмам.
  // src: 'perk' — набрал RAGE_SCORE очков (до конца боя), 'momentum' — «Кураж» (пока соперник не наберёт 1000).
  function startRage(p, src) {
    p.raging = true;
    p.rageSrc = src;
    const before = { ...p.stats };
    for (const k of Object.keys(p.stats)) {
      const s = p.stats[k];
      p.stats[k] = Math.max(s, Math.min(RAGE_CAP, Math.round(s * (1 + RAGE_BOOST))));
    }
    refresh(p);
    return { before, after: { ...p.stats } };
  }

  // Вызывать после каждого начисления очков бойцу p (соперник opp):
  //   { rage } — p впал в ярость от перка; { converted } — ярость «Куража» теперь держится перком до конца боя;
  //   { rageEnd } — у opp закончилась ярость «Куража» (p набрал 1000 очков)
  function onScore(p, opp) {
    const out = {};
    if (p.rageReady && p.score >= RAGE_SCORE && p.hp > 0 && p.rageSrc !== 'perk') {
      if (p.raging) { p.rageSrc = 'perk'; out.converted = true; } // ярость не стакается
      else out.rage = startRage(p, 'perk');
    }
    if (opp && opp.raging && opp.rageSrc === 'momentum' && p.score >= PERKS.momentum.untilOpp) {
      opp.raging = false;
      opp.rageSrc = null;
      opp.stats = { ...opp.baseStats };
      refresh(opp);
      out.rageEnd = opp;
    }
    return out;
  }
  // совместимость: только ярость от перка
  const checkRage = (p) => onScore(p, null).rage || null;

  // Конец хода: «Прицеливание» за ход без урона
  function endTurn(p) {
    if (hasPassive(p, 'granny') && !p.touched && p.hp > 0) { p.aim++; return { aim: p.aim }; }
    return null;
  }

  return {
    GEM, DUEL_MOVES, TWO_BARRELS, fighter, matchStart, comboMult, chargeTargets, startTurn,
    duelOn, duelMoves, duelTurn, hit, dmgMult, curDmg, furyActive, ramOnCombo, snackOnCombo, snack, checkRage, onScore, luckChance, shieldBlock, SNACK, endTurn, count, over10, hasInj, hasPassive, upPassive,
  };
})();
