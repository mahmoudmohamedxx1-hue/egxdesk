/* ابحث عن شركة — the header's search box, that searches.
 *
 * The owner, 22 September 2026: "when [I] press find a company I have to
 * select the search bar below to search — why [doesn't] the search bar I
 * clicked just work instead". It was a button dressed as a search box.
 * Pressing it opened the Market screen, whose own box then had to be found
 * and pressed a second time before a letter could be typed.
 *
 * Now it is the box. Typing lists the matching companies under it; a press or
 * Enter opens one; the arrow keys move through them; Escape clears. When more
 * match than the list shows, the last row opens them all on the Market screen,
 * already searched — so nothing the old button reached is out of reach.
 *
 * ONE CAVEAT OF THIS SITE'S RENDERER, HANDLED HERE
 * dc.js rebuilds the page on every state change and puts the caret back into
 * the input by position. Removing the focused input to rebuild it fires a
 * `blur` in some browsers, which would close the list after every keystroke.
 * So a blur only closes the list if, a tick later, focus is somewhere other
 * than this box.
 */
import { React as R } from './react-shim.js';

const h = R.createElement;

/** How many matches the list shows before "see all" takes over. */
export const FIND_ROWS = 8;
export const FIND_INPUT_ID = 'journal-find-input';
const LIST_ID = 'journal-find-results';
const optionId = (i) => `journal-find-option-${i}`;

/* The pieces a name is split into for "a word starts with". Arabic names
   carry punctuation and Latin brand names in brackets as often as spaces. */
const WORDS = /[\s().,،&/\-–—«»"'’]+/;

/** Companies matching `query`, best first.
 *
 * The ticker itself, then tickers that start with it, then names with a word
 * that starts with it, then names that contain it anywhere — the order a
 * reader who knows either the code or the name expects. Within one kind the
 * larger company first: "مصر" matches dozens and the bank a reader means is
 * more likely than the smallest listing. Arabic is folded the way the Market
 * screen folds it (hamza forms, taa marbuta, diacritics). */
/* A word without the Arabic article: «البنك» is «بنك», and «للألومنيوم» —
   "for the aluminium", the article contracted after لِ — is «ألومنيوم». A
   reader types the noun, with or without its article, and should find the
   name either way. */
const bare = (w) => (w.length > 3 && (w.startsWith('ال') || w.startsWith('لل')) ? w.slice(2) : w);

export function findCompanies(companies, query, fold) {
  const q = fold(String(query || '').trim());
  if (!q) return [];
  const qBare = bare(q);
  const hits = [];
  for (const c of companies || []) {
    if (!c || !c.ticker) continue;
    const ticker = fold(c.ticker);
    const names = (c.name && typeof c.name === 'object' ? [c.name.en, c.name.ar] : [c.name])
      .filter(Boolean).map((n) => fold(n));
    let rank = -1;
    if (ticker === q) rank = 0;
    else if (ticker.startsWith(q)) rank = 1;
    else if (names.some((n) => n.split(WORDS).some((w) => w
      && (w.startsWith(q) || bare(w).startsWith(qBare))))) rank = 2;
    else if (names.some((n) => n.includes(q) || (qBare !== q && n.includes(qBare)))) rank = 3;
    if (rank >= 0) hits.push({ c, rank });
  }
  const cap = (c) => (typeof c.cap === 'number' && Number.isFinite(c.cap) ? c.cap : -1);
  return hits.sort((a, b) => a.rank - b.rank || cap(b.c) - cap(a.c)
    || String(a.c.ticker).localeCompare(String(b.c.ticker))).map((x) => x.c);
}

/** The box, and the list under it while there is something typed. */
export function companySearch(component, companies, ar) {
  const st = component.state || {};
  const t = (en, arabic) => (ar ? arabic : en);
  const fold = typeof component.fold === 'function' ? (s) => component.fold(s) : (s) => String(s || '').toLowerCase();
  const query = typeof st.findQ === 'string' ? st.findQ : '';
  const typed = query.trim();
  const open = Boolean(st.findOpen && typed);
  const all = open ? findCompanies(companies, typed, fold) : [];
  const shown = all.slice(0, FIND_ROWS);
  const active = shown.length ? Math.min(Math.max(Number(st.findActive) || 0, 0), shown.length - 1) : -1;

  const shut = { findQ: '', findOpen: false, findActive: 0 };
  /* Leaving the box once a choice is made: the renderer would otherwise put
     the caret back into it on the next screen, and on a phone that keeps the
     keyboard up over the company the reader just opened. */
  const leave = () => {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    if (el && el.id === FIND_INPUT_ID && typeof el.blur === 'function') el.blur();
  };
  const go = (ticker) => { leave(); component.setState({ screen: 'company', ticker, ...shut }); };
  const seeAll = (text = typed) => { leave(); component.setState({ screen: 'market', marketMode: '', q: text, sector: 'All', ...shut }); };
  const nameOf = (c) => (c.name && typeof c.name === 'object'
    ? (ar ? c.name.ar : c.name.en) || c.name.en || c.ticker : c.name || c.ticker);
  const sectorOf = (c) => (ar ? (c.sectorAr || c.sector) : c.sector) || '';
  // A press on a row must not take focus out of the box first: the blur
  // would close the list before the click arrived.
  const keepFocus = (e) => { if (e && typeof e.preventDefault === 'function') e.preventDefault(); };

  const onKeyDown = (e) => {
    const key = e && e.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== 'Escape') return;
    /* The state as it is NOW, not as it was when this box was drawn. Two keys
       pressed inside one frame both land on the same drawing, and read from
       the drawing the second ArrowDown repeated the first, and an Enter typed
       hard on a letter opened the match for the word before it. */
    const now = component.state || {};
    const text = String(now.findQ || '').trim();
    const list = text ? findCompanies(companies, text, fold).slice(0, FIND_ROWS) : [];
    const at = list.length ? Math.min(Math.max(Number(now.findActive) || 0, 0), list.length - 1) : -1;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      const step = key === 'ArrowDown' ? 1 : -1;
      component.setState({ findOpen: true, findActive: (at + step + list.length) % list.length });
    } else if (key === 'Enter') {
      if (!text) return;
      e.preventDefault();
      if (list.length) go(list[at].ticker); else seeAll(text);
    } else {
      component.setState(now.findOpen && text ? { findOpen: false } : shut);
    }
  };

  return h('div', { class: 'journal-find' },
    h('svg', { class: 'journal-find-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '1.8', 'stroke-linecap': 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M10.6 17.2a6.6 6.6 0 1 0 0-13.2 6.6 6.6 0 0 0 0 13.2M15.4 15.4 20.4 20.4' })),
    h('input', {
      id: FIND_INPUT_ID, class: 'journal-find-input', type: 'search', value: query,
      placeholder: t('Find a company', 'ابحث عن شركة'),
      'aria-label': t('Find a company by name or ticker', 'ابحث عن شركة بالاسم أو الرمز'),
      autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-controls': LIST_ID,
      'aria-expanded': open ? 'true' : 'false',
      'aria-activedescendant': open && active >= 0 ? optionId(active) : null,
      onInput: (e) => component.setState({ findQ: e.target.value, findOpen: true, findActive: 0 }),
      onFocus: () => { if (typed && !st.findOpen) component.setState({ findOpen: true }); },
      onBlur: () => setTimeout(() => {
        const now = typeof document !== 'undefined' ? document.activeElement : null;
        if (now && now.id === FIND_INPUT_ID) return;
        if (component.state && component.state.findOpen) component.setState({ findOpen: false });
      }, 0),
      onKeyDown,
    }),
    open ? h('div', { class: 'journal-find-panel', id: LIST_ID, role: 'listbox',
      'aria-label': t('Matching companies', 'الشركات المطابقة') },
    shown.length
      ? shown.map((c, i) => h('button', {
        type: 'button', id: optionId(i), role: 'option', tabindex: '-1',
        'aria-selected': i === active ? 'true' : 'false',
        class: `journal-find-row${i === active ? ' is-active' : ''}`,
        onMouseDown: keepFocus, onClick: () => go(c.ticker),
      },
      h('b', { class: 'journal-find-code' }, c.ticker),
      h('span', { class: 'journal-find-name' }, nameOf(c)),
      sectorOf(c) ? h('small', { class: 'journal-find-sector' }, sectorOf(c)) : null))
      : h('p', { class: 'journal-find-none' },
        t(`No company matches “${typed}”.`, `لا توجد شركة تطابق «${typed}».`)),
    all.length > shown.length
      ? h('button', { type: 'button', class: 'journal-find-all', onMouseDown: keepFocus, onClick: () => seeAll() },
        t(`All ${all.length} matches on the Market screen ↗`, `كل النتائج (${all.length}) في شاشة السوق ↗`))
      : null) : null);
}
