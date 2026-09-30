'use strict';

/* =========================================================
 *  Данные героев и моделей поведения ИИ
 *  sprite — картинка во весь рост на прозрачном фоне.
 *  face   — кадрирование аватарки: size (ширина картинки в % от кружка), x/y (background-position в %).
 * ========================================================= */

// Кадрирование лица для круглых аватарок (картинки 1:1)
const FACES = {
  frog: { x: 48.5, y: -3.6 }, granny: { x: 51.4, y: -2.4 }, sofa: { x: 47.3, y: -1.9 },
  goose: { x: 50.6, y: -3.9 }, plumber: { x: 51.6, y: -3.4 }, dumpling: { x: 50.6, y: -0.6 },
  cat: { x: 51.4, y: -1.6 }, shawarma: { x: 45, y: -0.4 },
};

const HEROES = [
  { id: 'frog', name: T('Резак', 'Razor'), title: T('Два ножа, ноль спокойствия', 'Two knives, zero chill'), color: '#5fd35f',
    stats: { str: 6, agi: 16, end: 10 } },
  { id: 'granny', name: T('Дед Отмороз', 'Santa Psycho'), title: T('Подарки с доставкой в голову', 'Gifts delivered straight to your head'), color: '#ff5f6d',
    stats: { str: 15, agi: 5, end: 8 } },
  { id: 'sofa', name: T('Чэд Чилингтон', 'Chad Chillington'), title: T('Абсолютный ноль эмоций', 'Absolute zero emotions'), color: '#ff9f43',
    stats: { str: 6, agi: 13, end: 6 } },
  { id: 'goose', name: T('Кинг-Банг', 'King Bang'), title: T('Банановые пистолеты заряжены, спелы и абсолютно незаконны', 'Banana pistols: loaded, ripe and totally illegal'), color: '#3fd9ff',
    stats: { str: 7, agi: 10, end: 10 } },
  { id: 'plumber', name: T('Офицер Хэртли', 'Officer Hartley'), title: T('Три в ряд — это уже группа лиц', 'Three in a row is already a gang'), color: '#5b7cff',
    stats: { str: 12, agi: 6, end: 16 } },
  { id: 'dumpling', name: T('Ковбой Пыль', 'Cowboy Dust'), title: T('Самый медленный ствол Дикого Запада', 'Slowest gun in the Wild West'), color: '#ff8fd8',
    stats: { str: 12, agi: 1, end: 12 } },
  { id: 'cat', name: T('Генерал Бычара', 'General Bullrush'), title: T('Прёт напролом', 'Charges straight through'), color: '#b06bff',
    stats: { str: 15, agi: 5, end: 16 } },
  { id: 'shawarma', name: T('Шаурмен', 'Shawarman'), title: T('Завёрнут и опасен', 'Wrapped and dangerous'), color: '#ffd93d',
    stats: { str: 11, agi: 12, end: 7 } },
].map((h) => ({ sprite: `assets/heroes/${h.id}.png`, face: { size: 500, ...FACES[h.id] }, ...h }));

/*
 * Боевые формулы (характеристика 1…20). У каждой отношение максимума к минимуму ровно ×3,
 * и каждая растёт одинаково в относительном выражении, поэтому очко любой характеристики
 * ценно примерно одинаково. Масштаб подобран симуляцией: ~30% матчей без нокаута (ничья).
 *   здоровье      = 85 + выносливость × 10          → 95…285
 *   урон за атаку = 17 + сила × 2                   → 19…57
 *   цена атаки    = 6100 / (8,5 + ловкость), округл. → 642…214 очков за камни на один удар
 */
const COMBAT = {
  maxHp: (s) => 85 + s.end * 10,
  damage: (s) => 17 + s.str * 2,
  attackCost: (s) => Math.round(6100 / (8.5 + s.agi)),
};

/*
 * Прокачка. За бой: сокрушительная победа (у победителя > 50% здоровья) +50, победа +30, ничья +10.
 * Для уровня 2 нужно 50 опыта, каждый следующий — на 10 больше; излишек переносится.
 */
const XP_REWARD = { crush: 50, win: 30, draw: 10, loss: 0 };
const xpToNext = (level) => 50 + (level - 1) * 10;
// Множитель награды за победу и ничью: ±10% за каждое место, на которое соперник выше/ниже в таблице
// (со 2-го тура), и ±10% за каждый уровень разницы. Не меньше 30% от базовой награды.
const XP_PLACE_BONUS = 0.1;
const XP_LEVEL_BONUS = 0.1;
const XP_MIN_MULT = 0.3;
const XP_INJURY_BONUS = 0.3; // +30% базовой награды за каждую травму, нанесённую сопернику

// Карточки улучшений при повышении уровня: из всего набора выпадают 3 разные случайные.
// stat — какую характеристику улучшает, amount — на сколько, apply — меняет прокачку героя. ИИ выбирает карточку случайно.
const UPGRADES = [
  { id: 'str', icon: '💪', name: T('Сила', 'Strength'), desc: T('+2 к силе', '+2 Strength'), stat: 'str', amount: 2, apply: (prog) => { prog.bonus.str += 2; } },
  { id: 'agi', icon: '🤸', name: T('Ловкость', 'Agility'), desc: T('+2 к ловкости', '+2 Agility'), stat: 'agi', amount: 2, apply: (prog) => { prog.bonus.agi += 2; } },
  { id: 'end', icon: '🛡️', name: T('Выносливость', 'Endurance'), desc: T('+2 к выносливости', '+2 Endurance'), stat: 'end', amount: 2, apply: (prog) => { prog.bonus.end += 2; } },
];
// Карточки 3-го уровня: вместо трёх случайных — строго эти три
const RAGE_SCORE = 1500;   // «Ярость»: сколько очков за бой нужно набрать
const RAGE_BOOST = 0.3;    // …и на сколько растут характеристики (не выше 20)
const RAGE_CAP = 20;
const SPECIAL_LEVEL = 3;
const SPECIAL_UPGRADES = [
  { id: 'empower', icon: '⚡', name: T('Усиление пассивки', 'Empowered passive'), desc: T('Своя пассивка становится сильнее', 'Your passive gets stronger'),
    apply: () => {} },
  { id: 'all', icon: '🌟', name: T('Всё и сразу', 'All-rounder'), desc: T('+2 к силе, ловкости и выносливости', '+2 Strength, Agility and Endurance'),
    apply: (prog) => { prog.bonus.str += 2; prog.bonus.agi += 2; prog.bonus.end += 2; } },
  { id: 'rage', icon: '🔥', name: T('Ярость', 'Rage'),
    desc: T(`Набрав за бой ${RAGE_SCORE} очков, впадает в ярость: все характеристики +30% (не выше 20) до конца боя`,
      `After scoring ${RAGE_SCORE} points in a bout, flies into a rage: all attributes +30% (max 20) until the end of the bout`),
    apply: () => {} },
];
// Межсезонье: характеристика выше pivot теряет breakLoss («перерыв»), ниже pivot — получает restGain («отдых»),
// плюс wear очков износа случайным характеристикам. Не ниже 1.
const OFFSEASON = { pivot: 10, breakLoss: 1, restGain: 1, wear: 2 };
const romanNum = (n) => [['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]]
  .reduce((acc, [r, v]) => { while (n >= v) { acc.s += r; n -= v; } return acc; }, { s: '' }).s;

const UPGRADE_BY_ID = Object.fromEntries([...UPGRADES, ...SPECIAL_UPGRADES].map((u) => [u.id, u]));

/*
 * Травмы. Шанс при пропущенном ударе: 3%, при критическом — 33%.
 * Травма действует сразу и ещё 1–3 следующих боя. Механика эффектов — в combat.js.
 */
const INJURY_CHANCE = 0.03;
const INJURY_CRIT_CHANCE = 0.33;
const INJURY_DURATION = [1, 3];
// «Закалка»: каждое из 2 очков, которые травма отнимает у характеристик, не теряется с шансом
// (уровень − 1) × perLevel, но не больше max. Чем опытнее боец, тем труднее его сломать.
const INJURY_GUARD = { perLevel: 0.12, max: 0.9 };
const injuryGuard = (level) => Math.min(INJURY_GUARD.max, Math.max(0, (level - 1) * INJURY_GUARD.perLevel));
const INJURIES = [
  { id: 'arm', icon: '🦾', name: T('Перелом руки', 'Broken Arm'), desc: T('(3 × красных камней) % шанс промахнуться ударом', '(3 × red gems) % chance to miss a strike') },
  { id: 'leg', icon: '🦵', name: T('Перелом ноги', 'Broken Leg'), desc: T('ловкость −50%', 'Agility −50%') },
  { id: 'concussion', icon: '💫', name: T('Сотрясение мозга', 'Concussion'), desc: T('(2 × красных камней) % шанс пропустить ход, опыт за бой не начисляется', '(2 × red gems) % chance to skip a turn, no XP for the bout') },
  { id: 'rib', icon: '🦴', name: T('Перелом ребра', 'Broken Rib'), desc: T('пассивка отключена, макс. здоровье −20%', 'passive disabled, max HP −20%') },
  { id: 'nose', icon: '👃', name: T('Сломан нос', 'Broken Nose'), desc: T('множитель комбо на 1 меньше (×2 → ×1, ×3 → ×2…)', 'combo multiplier 1 lower (×2 → ×1, ×3 → ×2…)') },
  { id: 'teeth', icon: '🦷', name: T('Выбитые зубы', 'Knocked-out Teeth'), desc: T('удар — крит, заряд обнулён; в следующих боях соперник начинает с половиной заряда', 'the strike is a crit, charge reset; in later bouts the opponent starts half-charged') },
];
const INJURY_BY_ID = Object.fromEntries(INJURIES.map((i) => [i.id, i]));
const boutsWord = (n) => (I18N.lang === 'en' ? (n === 1 ? 'bout' : 'bouts') : n % 10 === 1 && n % 100 !== 11 ? 'бой' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'боя' : 'боёв');
// Текст подсказки к медицинскому кресту. list: [{ id, left }], left = null — получена в этом бою
function injuryTip(list) {
  return list.map((i) => {
    const inj = INJURY_BY_ID[i.id];
    const dur = i.left == null ? tr('получена в этом бою', 'got in this bout') : tr(`ещё ${i.left} ${boutsWord(i.left)}`, `${i.left} more ${boutsWord(i.left)}`);
    return `${inj.icon} ${inj.name} — ${dur}\n    ${inj.desc}`;
  }).join('\n');
}

// Пассивные умения (механика — в combat.js)
const PASSIVES = {
  dumpling: {
    icon: '🌅', name: T('Дуэль на закате', 'Sunset Duel'),
    desc: T('В последние 3 хода матча после каждого хода и Пыль, и соперник наносят дополнительный удар, не тратя заряд. Удар соперника — 40% урона, у Пыли — полный.',
      'In the last 3 moves of the match, after every move both Dust and his opponent land an extra strike without spending charge. The opponent deals 40% damage, Dust deals full damage.'),

    up: T('Дуэль начинается с последних 4 ходов вместо 3.',
      'The duel starts in the last 4 moves instead of 3.'),
  },
  frog: {
    icon: '🩸', name: T('Кровотечение', 'Bloodletting'),
    desc: T('Каждый удар с шансом (красных камней на поле − 10) × 5 % вешает на врага кровотечение до конца боя. В начале каждого хода врага оно наносит (красных камней на поле − 10) × 4 урона.',
      'Every strike has a (red gems on the board − 10) × 5 % chance to make the enemy bleed until the end of the bout. At the start of each enemy turn it deals (red gems on the board − 10) × 4 damage.'),

    up: T('Кровотечение наносит +1 урона за каждый красный камень сверх 10: (красных − 10) × 5.',
      'Bleeding deals +1 damage per red gem above 10: (red − 10) × 5.'),
  },
  cat: {
    icon: '🐂', name: T('Таран', 'Battering Ram'),
    desc: T('Когда каскад доходит до комбо ×4, Бычара сразу наносит удар на 50% урона, не тратя заряд.',
      'When a cascade reaches combo ×4, Bullrush instantly strikes for 50% damage without spending charge.'),
    up: T('Таран наносит 65% урона.',
      'The ram deals 65% damage.'),
  },
  plumber: {
    icon: '🔗', name: T('Наручники', 'Handcuffs'),
    desc: T('Каждая его атака отнимает у соперника 20% накопленного заряда + 4% за каждую звезду на поле сверх 10 — «задерживает» его атаку.',
      'Each of his attacks drains 20% of the opponent’s charge + 4% per star on the board above 10, “detaining” their attack.'),
    up: T('Наручники срезают 28% заряда + 5% за каждую звезду сверх 10.',
      'Handcuffs drain 28% charge + 5% per star above 10.'),
  },
  goose: {
    icon: '🔫', name: T('Два ствола', 'Two Barrels'),
    desc: T('Две шкалы заряда. Первая заряжается как обычно. Вторая дополнительно заряжается от каскадов с комбо ×2 и выше (с множителем не выше ×2); удар с неё наносит 50% урона. Эффекты на заряд действуют на обе.',
      'Two charge bars. The first charges as usual. The second also charges from cascades with combo ×2 or higher (multiplier capped at ×2); its strike deals 50% damage. Charge effects apply to both.'),

    up: T('Предел множителя для второй шкалы — ×2,5 вместо ×2, удар с неё наносит 75% урона вместо 50%.',
      'The second bar’s multiplier cap is ×2.5 instead of ×2, and its strike deals 75% damage instead of 50%.'),
  },
  shawarma: {
    icon: '🌯', name: T('Перекус', 'Snack Time'),
    desc: T('Когда каскад доходит до комбо ×3, Шаурмен лечится на 10 + (зелёных камней − 10) × 5 и получает стак: +5% шанса крита ×1,75 за каждый стак.',
      'When a cascade reaches combo ×3, Shawarman heals 10 + (green gems − 10) × 5 and gains a stack: +5% chance of a ×1.75 crit per stack.'),
    up: T('Перекус лечит на 14 + (зелёных − 10) × 7, каждый стак даёт +7% шанса крита.',
      'Snack Time heals 14 + (green − 10) × 7, and each stack gives +7% crit chance.'),
  },
  sofa: {
    icon: '😐', name: T('Невозмутимость', 'Unbothered'),
    desc: T('С шансом 10% + (фиолетовых камней на поле − 10) × 5 % полностью игнорирует входящий удар — «даже не моргнул».',
      'With a 10% + (purple gems on the board − 10) × 5 % chance he fully ignores an incoming strike: “didn’t even blink”.'),

    up: T('+5% к шансу уворота: 15% + (фиолетовых − 10) × 5 %.',
      '+5% dodge chance: 15% + (purple − 10) × 5 %.'),
  },
  granny: {
    icon: '🎯', name: T('Хедшот', 'Headshot'),
    desc: T('Каждый его ход без полученного и нанесённого урона даёт стак «Прицеливания»: +7% шанса крита ×2. Любой удар с его участием сбрасывает все стаки.',
      'Every turn of his without taking or dealing damage gives an “Aiming” stack: +7% chance of a ×2 crit. Any strike involving him resets all stacks.'),

    up: T('+2% шанса крита за стак прицеливания: 9% за стак.',
      '+2% crit chance per Aiming stack: 9% per stack.'),
  },
};

const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));

const MODELS = {
  greedy: {
    name: T('Жадный', 'Greedy'), icon: '💰',
    desc: T('Хватает самые жирные очки прямо сейчас, а о будущем пусть думают другие.',
      'Grabs the fattest points right now and lets others worry about the future.'),
  },
  strategist: {
    name: T('Стратег', 'Strategist'), icon: '♟️',
    desc: T('Думает на ход вперёд и старается не оставлять сопернику подарков.',
      'Thinks one move ahead and tries not to leave gifts for the opponent.'),
  },
  mystic: {
    name: T('Мистик', 'Mystic'), icon: '🔮',
    desc: T('Гадает на будущее: прокручивает десятки случайных вариантов падения камней и верит в лучший.',
      'Reads the future: plays out dozens of random gem drops and trusts the best one.'),
  },
};

const STATS = [
  { key: 'str', name: T('Сила', 'Strength'), icon: '💪' },
  { key: 'agi', name: T('Ловкость', 'Agility'), icon: '🤸' },
  { key: 'end', name: T('Выносливость', 'Endurance'), icon: '🛡️' },
];

// все тексты данных — на текущем языке
I18N.track(...HEROES, ...UPGRADES, ...SPECIAL_UPGRADES, ...INJURIES, ...Object.values(PASSIVES), ...Object.values(MODELS), ...STATS);
I18N.applyData();

// Аватарка-кружок (лицо из спрайта)
function avatarStyle(h) {
  return `background-image:url('${h.sprite}');background-size:${h.face.size}% auto;` +
         `background-position:${h.face.x}% ${h.face.y}%;--hc:${h.color}`;
}
