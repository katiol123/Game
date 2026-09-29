'use strict';

/* =========================================================
 *  Язык интерфейса: английский (по умолчанию) или русский.
 *  tr('текст', 'text') — строка на текущем языке (вызывается при отрисовке).
 *  T('текст', 'text')  — пара для данных (data.js): I18N.apply() подставляет нужный язык в поля объектов.
 *  Статичный текст в index.html: русский — в самой разметке, английский — в атрибутах
 *  data-en (innerHTML), data-en-title, data-en-label.
 * ========================================================= */

const I18N = (() => {
  const KEY = 'match3-lang';
  let lang = 'en';
  try { if (localStorage.getItem(KEY) === 'ru') lang = 'ru'; } catch (e) { /* нет доступа к хранилищу */ }

  const PAIR = Symbol('i18n');
  const pair = (ru, en) => ({ [PAIR]: true, ru, en });
  const tr = (ru, en) => (lang === 'ru' ? ru : en);

  // объекты данных с полями-парами; исходные пары хранятся отдельно, чтобы язык можно было сменить ещё раз
  const registry = [];
  const sources = new WeakMap();
  function track(...objs) {
    for (const o of objs) {
      const src = {};
      for (const k of Object.keys(o)) if (o[k] && o[k][PAIR]) src[k] = o[k];
      sources.set(o, src);
      registry.push(o);
    }
  }

  function applyData() {
    for (const o of registry) {
      const src = sources.get(o);
      for (const k in src) o[k] = src[k][lang];
    }
  }

  function applyDom() {
    document.documentElement.lang = lang;
    document.title = tr('Лига Шести Камней', 'Six Stones League');
    for (const [attr, prop] of [['en', 'innerHTML'], ['enTitle', 'title'], ['enLabel', 'ariaLabel']]) {
      const sel = '[data-' + attr.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + ']';
      document.querySelectorAll(sel).forEach((el) => {
        const ruKey = 'ru' + attr.slice(2);
        if (!(ruKey in el.dataset)) el.dataset[ruKey] = prop === 'ariaLabel' ? el.getAttribute('aria-label') || '' : el[prop];
        const v = lang === 'ru' ? el.dataset[ruKey] : el.dataset[attr];
        if (prop === 'ariaLabel') el.setAttribute('aria-label', v); else el[prop] = v;
      });
    }
  }

  function set(l) {
    lang = l === 'ru' ? 'ru' : 'en';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    applyData();
    if (typeof document !== 'undefined' && document.querySelectorAll) applyDom();
  }

  // Порядковое место: «3-е место» / «3rd place»
  function place(n) {
    if (lang === 'ru') return `${n}-е место`;
    const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${s} place`;
  }

  return { get lang() { return lang; }, set, tr, pair, track, applyData, applyDom, place };
})();

const tr = I18N.tr;
const T = I18N.pair;
