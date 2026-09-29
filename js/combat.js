'use strict';

/* =========================================================
 *  Боевые правила и пассивки героев (без DOM).
 *  Используются анимированным матчем, мгновенным досчётом и симуляцией баланса.
 *  Функции меняют состояние бойцов и возвращают описание события для визуала.
 * ========================================================= */

const Combat = (() => {
  // типы камней на поле
  const GEM = { red: 0, orange: 1, yellow: 2, green: 3, blue: 4, purple: 5 };
  const DUEL_MOVES = 3;          // «Дуэль на закате»: последние ходы каждого бойца
  const DUEL_ENEMY_FACTOR = 0.4; // доля урона соперника Пыли в дополнительных ударах

  const count = (g, t) => g.reduce((s, row) => s + row.reduce((k, x) => k + (x === t), 0), 0);
  // «количество камней цвета минус 10», не меньше нуля
  const over10 = (g, t) => Math.max(0, count(g, t) - 10);

  function fighter(hero) {
    const maxHp = COMBAT.maxHp(hero.stats);
    return {
      hero,
      id: hero.id,
      maxHp,
      hp: maxHp,
      dmg: COMBAT.damage(hero.stats),
      cost: COMBAT.attackCost(hero.stats),
      charge: hero.id === 'goose' ? [0, 0] : [0], // «Два ствола» — вторая шкала
      bleed: false,   // на бойце висит кровотечение (от Резака)
      aim: 0,         // стаки «Прицеливания» (Отмороз)
      snack: 0,       // стаки «Перекуса» (Шаурмен)
      touched: false, // получал или наносил урон в свой текущий ход
      score: 0,
      moves: 0,
      maxCombo: 0,
    };
  }

  // Куда идут очки шага каскада: [{ bar, pts }].
  // pts — обычные очки шага, ptsCap — очки того же шага с множителем комбо не выше ×2.
  function chargeTargets(p, combo, pts, ptsCap) {
    if (p.id === 'goose' && combo >= 2) return [{ bar: 1, pts: ptsCap }];
    return [{ bar: 0, pts }];
  }

  // Начало хода: сбрасываем «касание» и тикает кровотечение
  function startTurn(p, g) {
    p.touched = false;
    if (!p.bleed || p.hp <= 0) return null;
    const dmg = over10(g, GEM.red) * 4;
    if (dmg <= 0) return { bleed: 0 };
    p.hp = Math.max(0, p.hp - dmg);
    p.touched = true;
    return { bleed: dmg, ko: p.hp <= 0 };
  }

  const duelOn = (players) => players.some((p) => p.id === 'dumpling');
  // идёт ли у бойца «Дуэль на закате» (p.moves уже учитывает текущий ход)
  const duelTurn = (players, p, moveCap) => duelOn(players) && p.moves > moveCap - DUEL_MOVES;

  // Удар att по def. kind: 'charge' — от шкалы, 'ram' — «Таран», 'duel' — «Дуэль на закате»
  function hit(att, def, g, kind = 'charge', rnd = Math.random) {
    let dmg = att.dmg;
    if (kind === 'duel' && att.id !== 'dumpling') dmg = Math.ceil(att.dmg * DUEL_ENEMY_FACTOR);
    const ev = { kind, base: dmg, dmg: 0, crit: false, dodged: false, bleedApplied: false, drainPct: 0, aimLost: 0 };

    // криты: «Хедшот» (×2) и «Перекус» (×1,75)
    if (att.id === 'granny' && att.aim > 0 && rnd() < Math.min(1, att.aim * 0.07)) {
      ev.crit = true; dmg *= 2;
    } else if (att.id === 'shawarma' && att.snack > 0 && rnd() < Math.min(1, att.snack * 0.03)) {
      ev.crit = true; dmg = Math.round(dmg * 1.75);
    }

    // «Невозмутимость»: шанс полностью проигнорировать удар
    if (def.id === 'sofa' && rnd() < Math.min(1, over10(g, GEM.purple) * 0.05)) ev.dodged = true;

    if (!ev.dodged) {
      ev.dmg = dmg;
      def.hp = Math.max(0, def.hp - dmg);
      att.touched = def.touched = true;
      // «Кровотечение»: 25% при попадании, до конца боя
      if (att.id === 'frog' && !def.bleed && def.hp > 0 && rnd() < 0.25) { def.bleed = true; ev.bleedApplied = true; }
    }

    // «Наручники»: каждая атака срезает процент накопленного заряда (со всех шкал)
    if (att.id === 'plumber') {
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
    if (p.id === 'cat') return { ram: true };
    if (p.id === 'shawarma') {
      const heal = Math.min(p.maxHp - p.hp, over10(g, GEM.green) * 4);
      p.hp += heal;
      p.snack++;
      return { heal, snack: p.snack };
    }
    return null;
  }

  // Конец хода: «Прицеливание» за ход без урона
  function endTurn(p) {
    if (p.id === 'granny' && !p.touched && p.hp > 0) { p.aim++; return { aim: p.aim }; }
    return null;
  }

  return { GEM, DUEL_MOVES, fighter, chargeTargets, startTurn, duelOn, duelTurn, hit, lineOfFive, endTurn, count, over10 };
})();
