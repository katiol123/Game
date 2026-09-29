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
  { id: 'frog', name: 'Резак', title: 'Два ножа, ноль спокойствия', color: '#5fd35f' },
  { id: 'granny', name: 'Дед Отмороз', title: 'Подарки с доставкой в голову', color: '#ff5f6d' },
  { id: 'sofa', name: 'Чэд Чилингтон', title: 'Абсолютный ноль эмоций', color: '#ff9f43' },
  { id: 'goose', name: 'Кинг-Банг', title: 'Банановые пистолеты заряжены, спелы и абсолютно незаконны', color: '#3fd9ff' },
  { id: 'plumber', name: 'Офицер Хэртли', title: 'Три в ряд — это уже группа лиц', color: '#5b7cff' },
  { id: 'dumpling', name: 'Ковбой Пыль', title: 'Самый медленный ствол Дикого Запада', color: '#ff8fd8' },
  { id: 'cat', name: 'Генерал Бычара', title: 'Прёт напролом', color: '#b06bff' },
  { id: 'shawarma', name: 'Шаурмен', title: 'Завёрнут и опасен', color: '#ffd93d' },
].map((h) => ({ sprite: `assets/heroes/${h.id}.png`, face: { size: 500, ...FACES[h.id] }, ...h }));

const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));

const MODELS = {
  greedy: {
    name: 'Жадный', icon: '💰',
    desc: 'Хватает самые жирные очки прямо сейчас, а о будущем пусть думают другие.',
  },
  strategist: {
    name: 'Стратег', icon: '♟️',
    desc: 'Думает на ход вперёд и старается не оставлять сопернику подарков.',
  },
  mystic: {
    name: 'Мистик', icon: '🔮',
    desc: 'Гадает на будущее: прокручивает десятки случайных вариантов падения камней и верит в лучший.',
  },
};

const STATS = [
  { key: 'str', name: 'Сила', icon: '💪' },
  { key: 'agi', name: 'Ловкость', icon: '🤸' },
  { key: 'end', name: 'Выносливость', icon: '🛡️' },
];

// Аватарка-кружок (лицо из спрайта)
function avatarStyle(h) {
  return `background-image:url('${h.sprite}');background-size:${h.face.size}% auto;` +
         `background-position:${h.face.x}% ${h.face.y}%;--hc:${h.color}`;
}
