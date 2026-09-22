/* ما تغيّر اليوم، كاملاً — every company behind the cards on Today.
 *
 * The owner, 22 September 2026, of the "What changed today" shelf: the cards
 * "need to get a little bit bigger to show more companies", pressing a company
 * should open it, "but we also need option to go to the section that shows the
 * full page that show companies per sections and more data".
 *
 * WHY A PAGE OF ITS OWN AND NOT THREE LINKS ELSEWHERE
 * Each card could have pointed at the screen that already covers its subject —
 * the market table's "Unusual volume" view, the ownership lens, Connecting the
 * dots. Measured the same morning, none of them was the card's list at full
 * length. The market view carried three delisted over-the-counter names the
 * card leaves out (21 against 18); the ownership lens is a map of 1,605 stakes
 * and 1,348 holders, not the three filed this month; Connecting the dots opens
 * on a period picker whose "this week" starts on Sunday, not on the card's
 * four-day window. A reader who pressed "full list" on a card of 18 and landed
 * on 21, or on a map, has been told two different things by one site.
 *
 * So this page draws each card's own list, from the card's own selector
 * (changed-today.js), in the card's own words — the same limit line under each
 * section — and the count on the card's button is the length of the section
 * here. The screens that go further are one press away at the foot of each
 * section, named for what they add.
 *
 * NOTHING HERE IS A RANKING OF COMPANIES TO BUY
 * Each row is one measurement and the document it came from. The ordering is
 * the measurement's own — how far above its usual, how many documents — and
 * every section keeps the card's sentence about what the measurement is not.
 */
import { React as R } from './react-shim.js';
import { shareBar, evidenceChip, finite } from './primitives.js';
import {
  unusualCompanies, recentStakes, crossingCompanies, crossingCounts, named,
  companiesWord, filingsAr, storiesAr, sessionWord, sourceHref, holdersKey, FILING_DAYS,
} from './changed-today.js';

const h = R.createElement;

/** The sections, in the shelf's order of claim: what moved, where the index
 *  sits, what was filed, what coincided. */
export const SECTIONS = ['volume', 'index', 'ownership', 'crossings'];
export const sectionId = (key) => `cf-${key}`;

const whole = (v) => (finite(v) ? new Intl.NumberFormat('en').format(Math.round(v)) : '—');
const compact = (v) => (finite(v)
  ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '—');
const signed = (v, places = 2) => (finite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(places)}%` : '—');
// An index level to two places always, so 20,546.00 does not sit under 54,950.30 as "20,546".
const level = (v) => (finite(v) ? v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

/** Every index with enough closes, against the average of the same closes.
 *
 * The card is drawn only on a session an index changed sides, because a
 * standing condition is not today's news. The full page says where each one
 * stands, and marks the one that crossed, so the card's claim can be checked
 * against the others on the same day. */
export function indexStanding(data) {
  return (data.indices || []).map((idx) => {
    const points = (Array.isArray(idx.points) ? idx.points : []).filter(finite);
    if (points.length < 10) return null;
    const mean = points.reduce((s, v) => s + v, 0) / points.length;
    const last = points[points.length - 1];
    const prior = points[points.length - 2];
    return {
      id: idx.id || idx.label, label: idx.label || idx.id || '', labelAr: idx.labelAr || idx.label || '',
      last, mean, sessions: points.length, gap: (last / mean - 1) * 100,
      below: last < mean, crossed: (last < mean) !== (prior < mean),
      asOf: idx.pointsTo || null,
    };
  }).filter(Boolean);
}

/** The page, opened at `section` when a card sent the reader to one. */
export function changesPage(data, ar, {
  openCompany, openScreen, goHome, longDate, section = null, landed = null,
} = {}) {
  const t = (en, arabic) => (ar ? arabic : en);
  const day = typeof longDate === 'function' ? longDate : (iso) => iso;
  const company = (ticker) => () => openCompany(ticker);

  const volume = unusualCompanies(data);
  const indices = indexStanding(data);
  const stakes = recentStakes(data, ar);
  const cross = crossingCompanies(data);
  const counts = {
    volume: volume.length, index: indices.length, ownership: stakes.length, crossings: cross.length,
  };
  const names = {
    volume: t('Unusual volume', 'حجم غير معتاد'),
    index: t('The indices', 'المؤشرات'),
    ownership: t('Stakes filed', 'حصص مُعلنة'),
    crossings: t('Filings and the press', 'الإفصاحات والصحافة'),
  };

  /* Where a card asked to land. After the patch, and once: a later redraw of
     the same page must not pull the reader back up to the section. */
  if (section && SECTIONS.includes(section) && typeof queueMicrotask === 'function') {
    queueMicrotask(() => {
      const el = typeof document !== 'undefined' && typeof document.getElementById === 'function'
        ? document.getElementById(sectionId(section)) : null;
      if (el && el.isConnected !== false && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
      if (typeof landed === 'function') landed();
    });
  }

  const jump = (key) => () => {
    const el = typeof document !== 'undefined' && typeof document.getElementById === 'function'
      ? document.getElementById(sectionId(key)) : null;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return h('div', { class: 'om-scr cf-screen' },
    h('header', { class: 'cf-head' },
      typeof goHome === 'function'
        ? h('button', { type: 'button', class: 'cf-back', onClick: goHome }, t('Back to Today', 'العودة إلى اليوم'))
        : null,
      h('p', { class: 'cf-dateline' }, [day(data.marketDate), sessionWord(data, ar)].filter(Boolean).join(' · ')),
      /* Named for what is on it. Put to Jev on 22 September 2026 against "What
         changed today, in full", "Everything that changed today" and "Today's
         changes, company by company"; this won at 0.88. */
      h('h1', { class: 'cf-title' }, t('Every company behind today’s cards', 'كل شركة وراء بطاقات اليوم')),
      h('p', { class: 'cf-lede' }, t(
        'Every company behind the cards on Today, each with more of its figures. Nothing here is an opinion: each row is one measurement and the document it came from. Press a company to open it.',
        'كل شركة وراء بطاقات «اليوم»، ومع كل منها أرقام أكثر. لا شيء هنا رأي: كل صف قياس واحد والمستند الذي جاء منه. اضغط على شركة لتفتحها.')),
      h('nav', { class: 'cf-jump', 'aria-label': t('Sections', 'الأقسام') },
        SECTIONS.map((key) => h('button', { type: 'button', key, class: 'cf-jump-item', onClick: jump(key) },
          h('span', null, names[key]),
          h('b', { dir: 'ltr' }, String(counts[key])))))),
    volumeSection(data, volume, { t, ar, day, company, openScreen }),
    indexSection(data, indices, { t, ar, day, openScreen }),
    ownershipSection(data, stakes, { t, ar, day, company, openScreen }),
    crossingsSection(data, cross, { t, ar, day, company, openScreen }));
}

/** A section's frame: heading and count, how it is measured, the rows, what
 *  the measurement is not, where it came from, and the screen that goes on. */
function section({ key, title, count, how, body, empty, limit, chip, deeper }) {
  return h('section', { class: 'cf-section', id: sectionId(key), 'aria-labelledby': `${sectionId(key)}-h` },
    h('div', { class: 'cf-section-head' },
      h('h2', { id: `${sectionId(key)}-h` }, title),
      count ? h('span', { class: 'cf-count' }, count) : null),
    how ? h('p', { class: 'cf-how' }, how) : null,
    body || h('p', { class: 'cf-empty' }, empty),
    h('p', { class: 'cf-limit' }, limit),
    h('div', { class: 'cf-foot' }, chip, deeper));
}

function deeperButton(label, go) {
  return typeof go === 'function'
    ? h('button', { type: 'button', class: 'cf-deeper', onClick: go }, label) : null;
}

/* ── Unusual volume ─────────────────────────────────────────────────────── */
function volumeSection(data, rows, { t, ar, day, company, openScreen }) {
  const max = rows.length ? rows[0].rv : 1;
  const cols = ['#', t('Company', 'الشركة'), t('Against its usual', 'مقابل المعتاد'),
    t('Session', 'الجلسة'), t('Usual (20-session median)', 'المعتاد (وسيط 20 جلسة)'),
    t('Trades', 'الصفقات'), t('Value traded', 'قيمة التداول'), t('Price · change', 'السعر · التغير')];
  /* Rows are buttons — each one opens its company — so the column heads are
     for the eye only; a screen reader hears each row as one sentence. */
  const body = rows.length ? h('div', { class: 'cf-vol' },
    h('div', { class: 'cf-vol-row cf-vol-headrow', 'aria-hidden': 'true' },
      cols.map((label, i) => h('span', { key: i, class: `cf-vol-c${i}` }, label))),
    rows.map((c, i) => h('button', { type: 'button', key: c.ticker, class: 'cf-vol-row', onClick: company(c.ticker) },
      h('span', { class: 'cf-vol-c0 cf-rank' }, String(i + 1)),
      h('span', { class: 'cf-vol-c1 cf-co' },
        h('b', { class: 'cf-code' }, c.ticker),
        h('span', { class: 'cf-name' }, named(c, ar)),
        (ar ? (c.sectorAr || c.sector) : c.sector) ? h('small', { class: 'cf-sector' }, ar ? (c.sectorAr || c.sector) : c.sector) : null),
      h('span', { class: 'cf-vol-c2 cf-mult' },
        h('span', { class: 'cf-bar', 'aria-hidden': 'true' },
          h('i', { style: { width: `${Math.max(4, Math.min(100, (c.rv / max) * 100)).toFixed(1)}%` } })),
        h('b', { dir: 'ltr' }, `${c.rv.toFixed(1)}×`)),
      h('span', { class: 'cf-vol-c3 cf-num', 'data-label': t('Session', 'الجلسة') }, h('bdi', { dir: 'ltr' }, whole(c.volume))),
      h('span', { class: 'cf-vol-c4 cf-num', 'data-label': t('Usual', 'المعتاد') }, h('bdi', { dir: 'ltr' }, whole(c.medianVolume))),
      h('span', { class: 'cf-vol-c5 cf-num', 'data-label': t('Trades', 'الصفقات') }, h('bdi', { dir: 'ltr' }, whole(c.trades))),
      h('span', { class: 'cf-vol-c6 cf-num', 'data-label': t('Value', 'القيمة') },
        finite(c.turnover) ? h('bdi', { dir: 'ltr' }, `${compact(c.turnover)} ${t('EGP', 'ج.م')}`) : '—'),
      h('span', { class: `cf-vol-c7 cf-num cf-move ${finite(c.pct) ? (c.pct >= 0 ? 'up' : 'down') : ''}` },
        h('bdi', { dir: 'ltr' }, finite(c.close) ? `${c.close.toFixed(2)} · ${signed(c.pct)}` : signed(c.pct)))))) : null;
  return section({
    key: 'volume',
    title: t('Traded far above their usual volume', 'تداولت أكثر من حجمها المعتاد بكثير'),
    count: companiesWord(rows.length, ar),
    how: t('Each company against itself: shares traded in the session ÷ the median of its own last 20 sessions. At 2× or more the session was unusual. Shares delisted from the exchange, which trade over the counter on two days a week, are left out.',
      'كل شركة مقابل نفسها: الأسهم المتداولة في الجلسة ÷ وسيط آخر 20 جلسة لها هي. عند ضعفين أو أكثر تكون الجلسة غير معتادة. الأسهم المشطوبة من البورصة، التي تُتداول خارج المقصورة يومين في الأسبوع، مستبعدة.'),
    body,
    empty: t('No company traded at twice its usual volume this session.', 'لم تتداول أي شركة ضعف حجمها المعتاد في هذه الجلسة.'),
    limit: t('Each bar is measured against that company’s own usual volume, never against another company’s. Volume is activity, not interest: a session can be busy because one holder sold.',
      'كل عمود يُقاس على الحجم المعتاد للشركة نفسها، لا على شركة أخرى. الحجم نشاط وليس اهتماماً: قد تكون الجلسة نشطة لأن مالكاً واحداً باع.'),
    chip: evidenceChip({ ar, date: day(data.marketDate),
      basis: t('session volume ÷ median of 20 sessions', 'حجم الجلسة ÷ وسيط 20 جلسة'), source: 'EGX' }),
    deeper: deeperButton(t('Rank the whole market by it ↗', 'رتّب السوق كله بهذا المقياس ↗'),
      openScreen && (() => openScreen('market-volume'))),
  });
}

/* ── The indices ────────────────────────────────────────────────────────── */
function indexSection(data, rows, { t, ar, day, openScreen }) {
  const asOf = rows.map((r) => r.asOf).filter(Boolean).sort().at(-1) || data.documentDate || data.marketDate;
  const body = rows.length ? h('div', { class: 'cf-idx' },
    rows.map((r) => h('div', { key: r.id, class: `cf-idx-row${r.crossed ? ' is-crossed' : ''}` },
      h('b', { class: 'cf-idx-name' }, ar ? r.labelAr : r.label),
      h('span', { class: 'cf-idx-last', dir: 'ltr' }, level(r.last)),
      h('span', { class: 'cf-idx-mean' },
        t(`average of ${r.sessions} sessions `, `متوسط ${r.sessions} جلسة `),
        h('bdi', { dir: 'ltr' }, level(r.mean))),
      h('span', { class: `cf-idx-side ${r.below ? 'down' : 'up'}` },
        r.below ? t('below it by ', 'تحته بـ') : t('above it by ', 'فوقه بـ'),
        h('bdi', { dir: 'ltr' }, `${Math.abs(r.gap).toFixed(2)}%`)),
      r.crossed ? h('span', { class: 'cf-idx-cross' },
        t('changed sides on its last session', 'غيّر جهته في جلسته الأخيرة')) : null))) : null;
  return section({
    key: 'index',
    title: t('Where each index stands against its own average', 'أين يقف كل مؤشر من متوسطه'),
    count: '',
    how: t('The last close against the average of the same closes. The card on Today is drawn only on a session an index changes sides; here every index is shown, and the one that changed sides is marked.',
      'آخر إغلاق مقابل متوسط الإغلاقات نفسها. بطاقة «اليوم» لا تظهر إلا في جلسة يغيّر فيها مؤشر جهته؛ هنا تظهر المؤشرات كلها، ويُعلَّم الذي غيّر جهته.'),
    body,
    empty: t('No index has enough published closes to compare yet.', 'لا يوجد مؤشر له إغلاقات منشورة كافية للمقارنة بعد.'),
    limit: t('Where it sits against its own recent closes. A crossing is a description, not an event.',
      'موضعه مقابل إغلاقاته الأخيرة. التقاطع وصف، وليس واقعة.'),
    chip: evidenceChip({ ar, date: day(asOf), basis: t('official close', 'إغلاق رسمي'),
      source: t('EGX session bulletin', 'نشرة جلسة EGX') }),
    deeper: deeperButton(t('The whole market ↗', 'السوق كله ↗'), openScreen && (() => openScreen('market'))),
  });
}

/* ── Stakes filed ───────────────────────────────────────────────────────── */
function ownershipSection(data, stakes, { t, ar, day, company, openScreen }) {
  const body = stakes.length ? h('div', { class: 'cf-own' },
    stakes.map((co) => h('article', { key: co.held, class: 'cf-own-item' },
      h('button', { type: 'button', class: 'cf-own-co', onClick: company(co.held) },
        h('b', { class: 'cf-code' }, co.held),
        h('span', { class: 'cf-name' }, co.name),
        h('span', { class: 'cf-own-known' }, t(`${co.known.toFixed(2)}% disclosed`, `المُعلن ${co.known.toFixed(2)}%`)),
        h('span', { class: 'cf-arrow', 'aria-hidden': 'true' }, '↗')),
      shareBar({ ar, parts: co.parts }),
      holdersKey(co, ar, (iso) => t(`filed ${day(iso)}`, `أُفصح في ${day(iso)}`)),
      /* Beyond the bar's three, every holder by name: the card groups them
         into one band, and the full list is where they are named. */
      co.holders.length > 3 ? h('ul', { class: 'cf-holders' }, co.holders.slice(3).map((l, i) => h('li', { key: `${l.name}-${i}` },
        h('span', { class: 'cf-holder' }, l.name || '—'),
        h('b', { dir: 'ltr' }, `${l.percent.toFixed(2)}%`),
        l.asOf ? h('small', null, t(`filed ${day(l.asOf)}`, `أُفصح في ${day(l.asOf)}`)) : null))) : null))) : null;
  const newest = stakes.map((s) => s.asOf).filter(Boolean).sort().at(-1) || '';
  return section({
    key: 'ownership',
    title: t(`Stakes filed in the last ${FILING_DAYS} days`, `حصص أُفصح عنها خلال آخر ${FILING_DAYS} يوماً`),
    count: companiesWord(stakes.length, ar),
    how: t('One listed company’s filed stake in another, at the level its last form printed. Each company’s percentages are its own and are never added across companies; the hatched part of a bar is what nobody has filed.',
      'حصة شركة مدرجة في أخرى كما طبعها آخر نموذج إفصاح. نِسب كل شركة تخصّها وحدها ولا تُجمع عبر الشركات؛ والجزء المظلّل من الشريط هو ما لم يُفصح عنه أحد.'),
    body,
    empty: t(`No stake was filed in the last ${FILING_DAYS} days.`, `لم يُفصح عن أي حصة خلال آخر ${FILING_DAYS} يوماً.`),
    limit: t('What is filed, not what is held. A stake under the disclosure threshold never appears here, and each bar is one company’s own capital.',
      'ما أُفصح عنه، لا ما هو مملوك. الحصة دون حدّ الإفصاح لا تظهر هنا أبداً، وكل شريط هو رأس مال شركة واحدة.'),
    chip: evidenceChip({ ar, date: newest ? day(newest) : '',
      basis: t('Articles 29 & 38', 'إفصاحات المادتين 29 و 38'), source: 'EGX' }),
    deeper: deeperButton(t('Everything disclosed, in the ownership lens ↗', 'كل المُعلن، في عدسة الملكية ↗'),
      openScreen && (() => openScreen('ownership'))),
  });
}

/* ── Filings and the press ──────────────────────────────────────────────── */
function crossingsSection(data, rows, { t, ar, day, company, openScreen }) {
  const doc = data.crossings || {};
  const filed = rows.reduce((n, x) => n + x.filings, 0);
  const written = rows.reduce((n, x) => n + x.stories, 0);
  const body = rows.length ? h('div', { class: 'cf-cross' },
    rows.map((x) => {
      const item = x.item;
      const why = ar ? (item.whyAr || item.why) : item.why;
      const docs = x.strands.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return h('article', { key: item.ticker, class: 'cf-cross-item' },
        h('button', { type: 'button', class: 'cf-cross-co', onClick: company(item.ticker) },
          h('b', { class: 'cf-code' }, item.ticker),
          h('span', { class: 'cf-name' }, ar ? (item.nameAr || item.name) : (item.name || item.ticker)),
          h('span', { class: 'cf-cross-count' }, crossingCounts(x, ar)),
          h('span', { class: 'cf-arrow', 'aria-hidden': 'true' }, '↗')),
        why ? h('p', { class: 'cf-why' }, why) : null,
        h('ul', { class: 'cf-docs' }, docs.map((s) => {
          const href = sourceHref(s.link);
          const label = ar ? (s.titleAr || s.title) : s.title;
          return h('li', { key: s.id || s.date + s.title, class: `cf-doc is-${s.kind}` },
            h('span', { class: 'cf-doc-when' }, day(s.date)),
            h('span', { class: 'cf-doc-kind' }, s.kind === 'filing' ? t('filing', 'إفصاح') : t('story', 'خبر')),
            href ? h('a', { class: 'cf-doc-title', href, target: '_blank', rel: 'noopener noreferrer' }, label, ' ↗')
              : h('span', { class: 'cf-doc-title' }, label));
        })));
    })) : null;
  return section({
    key: 'crossings',
    title: t('In the exchange’s filings and the press, the same few days', 'في إفصاحات البورصة وفي الصحافة، خلال الأيام نفسها'),
    count: companiesWord(rows.length, ar),
    how: doc.windowStart && doc.windowEnd
      ? t(`Companies that filed with the exchange and were written about in the press between ${day(doc.windowStart)} and ${day(doc.windowEnd)}, most documents first. A filled dot is a filing — the company’s own statement; an outlined dot is a story — somebody writing about it. Each document opens at its source.`,
        `شركات أودعت إفصاحاً لدى البورصة وكُتب عنها في الصحافة بين ${day(doc.windowStart)} و${day(doc.windowEnd)}، الأكثر مستندات أولاً. النقطة الممتلئة إفصاح — بيان الشركة نفسها؛ والمفرغة خبر — كتابة غيرها عنها. كل مستند يفتح عند مصدره.`)
      : '',
    body,
    empty: t('No company was in both the filings and the press in this window.', 'لم تظهر أي شركة في الإفصاحات والصحافة معاً خلال هذه النافذة.'),
    limit: t('Appearing in two places in one week is timing, not cause: nothing here says the filing and the story are about each other, or that either moved the share.',
      'الظهور في مكانين خلال أسبوع تزامن لا سببية: لا شيء هنا يقول إن الإفصاح والخبر يخصّ أحدهما الآخر، ولا إن أياً منهما حرّك السهم.'),
    chip: evidenceChip({ ar, date: doc.windowEnd ? day(doc.windowEnd) : '',
      basis: t(`${filed} filed · ${written} written`, `${filingsAr(filed)} · ${storiesAr(written)}`),
      source: t('EGX filings & the Egyptian press', 'إفصاحات البورصة والصحافة المصرية') }),
    deeper: deeperButton(t('Every company in the news and the filings ↗', 'كل الشركات في الأخبار والإفصاحات ↗'),
      openScreen && (() => openScreen('crossings'))),
  });
}
