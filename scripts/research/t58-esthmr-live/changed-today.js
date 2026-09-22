/* ما تغيّر اليوم — what changed today, as three cards.
 *
 * The redesign's business card: a dateline, the name of the shape it is
 * drawn in, one sentence, one picture, then what the picture does NOT say,
 * then the document it came from. Three of them, and each uses a different
 * primitive on purpose — a reader who meets the same chart three times stops
 * reading the third one.
 *
 * WHY THE "LIMIT" LINE IS NOT DECORATION
 * Every card here is one measurement about one named company, which is the
 * closest this site gets to the line in §8. The limit line is the sentence
 * that keeps it a measurement: a volume multiple is activity and not
 * interest, an index below its own average is a description and not a
 * signal, a disclosed stake is a filing and not a holding. Take those
 * sentences out and three neutral facts start reading as three reasons.
 *
 * NOTHING HERE IS COMPUTED FROM NOTHING
 * A card that cannot find its two published figures is not drawn. There is
 * no "—" card and no placeholder: an absent document means an absent card,
 * and the row simply carries the two that are there.
 */
import { React as R } from './react-shim.js';
import { pairedBars, line, shareBar, datedTimeline, evidenceChip, finite } from './primitives.js';
/* A session at twice a company's own usual volume, on the exchange — the point
   where "it traded" becomes "it traded unusually" (see the note in
   volumeCard). Defined once, in explorer.js, because the market screen's
   "Unusual volume" view lists the same thing and must list the same names. */
import { unusualVolume } from './explorer.js';

const h = R.createElement;

/* How recent an ownership filing has to be to count as today's news. */
export const FILING_DAYS = 45;
/* How many companies a card lists before its "full list" takes over. The
   owner, 22 September 2026: the cards "need to get a little bit bigger to show
   more companies". Eight is the busiest-names list; the ownership card is
   bars, which are taller, so five; the crossing card's second list is the
   other companies of the week, under the one it is about. */
const LIST_ROWS = 8;
const STAKE_ROWS = 5;
const ALSO_ROWS = 5;

/** The ISO date `days` before `iso`, or '' when the date is unreadable. */
function recentSince(iso, days) {
  const at = new Date(`${String(iso || '')}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

const compact = (v) => (finite(v)
  ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  : '—');

/* Whether the session settled, in one word.
 *
 * These datelines said "close" unconditionally. Mid-session the volume in a
 * card is a PART of a day divided by twenty whole ones, so the multiple can
 * only climb until the bell: 3.2x at eleven o'clock and 3.2x at the close are
 * different readings, and calling the first one a close is the same class of
 * error as a demo banner over live data. The session state is already on the
 * data this module is handed; it was simply not read. */
/* A dateline from the parts that exist.
 *
 * `market.json` is not always there, and a multiple stamped with the wrong
 * day — or with the word `undefined` where the day should be — is worse than
 * one carrying no date at all. Joining a fixed template printed exactly that.
 * Drop what is missing and join what is left. */
function stamp(parts) {
  return parts.filter((x) => x !== null && x !== undefined && String(x).trim() !== ''
    && !/undefined|NaN|Invalid/.test(String(x))).join(' · ');
}

/** "17 Sep" / "17 سبتمبر" — a date short enough to label a mark with.
 *
 * The timeline gives each mark about a sixth of its width, and a full date
 * is wider than that; a label that does not fit is a label that overlaps the
 * one beside it. The full window is stated in the card's dateline. */
function shortOf(iso, ar) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const months = ar
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] || m[2]}`;
}

export function sessionWord(data, ar) {
  const settled = data.isClose && !data.livePrices;
  return settled ? (ar ? 'إغلاق' : 'close') : (ar ? 'الجلسة حتى الآن' : 'session so far');
}

/* A directory row carries its name as `{ en, ar }`, not as a string —
   `data.live()` builds it that way so a screen can pick a language without a
   second lookup. Reading it as a string printed "[object Object]" in the
   middle of an Arabic sentence. */
export function named(row, ar) {
  const n = row && row.name;
  if (n && typeof n === 'object') return (ar ? n.ar : n.en) || n.en || row.ticker;
  return n || (row && row.ticker) || '';
}

/* Arabic counts take four forms: شركة واحدة، شركتان، 3 شركات، 11 شركة. */
export function companiesWord(n, ar) {
  if (!ar) return `${n} ${n === 1 ? 'company' : 'companies'}`;
  return n === 1 ? 'شركة واحدة' : n === 2 ? 'شركتان' : n >= 3 && n <= 10 ? `${n} شركات` : `${n} شركة`;
}

/* A document's own address, only when it is one. A link carried from a feed
   is data; `javascript:` or a relative path is not a source a reader should be
   sent to from Home. */
export const sourceHref = (link) => (/^https:\/\/[^\s"'<>]+$/i.test(String(link || '')) ? link : null);

/* ── What each card is drawn from, and what its full list shows ────────────
 *
 * The owner, 22 September 2026, of this shelf: the cards "need to get a little
 * bit bigger to show more companies", pressing a company should open it, and
 * each needs a way to "the full page that shows companies per section and
 * more data". A card and its full list must never disagree about who is on
 * it, so both read the selectors below: the card takes the first few, the
 * page (changes-page.js) takes them all, and the count on the card's button
 * is the length of the list the page draws.
 * ──────────────────────────────────────────────────────────────────────── */

/** Every company at twice its own usual volume or more, busiest first. */
export function unusualCompanies(data) {
  return (data.companies || []).filter(unusualVolume)
    .sort((a, b) => b.rv - a.rv || String(a.ticker).localeCompare(String(b.ticker)));
}

/** Each company with a stake filed inside FILING_DAYS of the session.
 *
 * Newest filing first, one entry per company. `known` is every disclosed
 * holder added up — they are separate holders of one company's capital, and
 * the link document carries one level per holder — and the bar draws the
 * three largest with the rest as one band, so the remainder it hatches is
 * what nobody has filed, not what did not fit. */
export function recentStakes(data, ar) {
  const links = (data.sectorOwnership?.links || []).filter((l) => l && finite(l.percent) && l.held);
  if (!links.length) return [];
  const byCompany = new Map();
  links.slice().sort((x, y) => String(y.asOf || '').localeCompare(String(x.asOf || '')))
    .forEach((l) => { if (!byCompany.has(l.held)) byCompany.set(l.held, []); byCompany.get(l.held).push(l); });
  /* Recent, or it is not "today".
     The archive always holds an ownership filing, so the newest one is drawn
     whether it landed this week or last spring. Outside this window the card
     is silent rather than presenting an old disclosure as a change. */
  const horizon = recentSince(data.marketDate, FILING_DAYS);
  const out = [];
  for (const [held, all] of byCompany) {
    if (horizon && String(all[0].asOf || '') < horizon) continue;
    const holders = all.slice().sort((x, y) => y.percent - x.percent).map((l) => ({
      name: ar ? (l.ownerNameAr || l.ownerName) : l.ownerName,
      code: l.owner || '', percent: l.percent, asOf: l.asOf || '',
    }));
    const known = holders.reduce((sum, l) => sum + l.percent, 0);
    /* A company whose disclosed stakes already sum to 100% has no undisclosed
       remainder to show, and one at 0% has nothing to draw. Neither is a bar. */
    if (known <= 0 || known >= 100) continue;
    const rest = holders.slice(3);
    const parts = holders.slice(0, 3).map((l) => ({ label: l.name, value: l.percent }));
    if (rest.length) {
      parts.push({ label: ar ? `${rest.length} مالكين آخرين` : `${rest.length} more ${rest.length === 1 ? 'holder' : 'holders'}`,
        value: rest.reduce((sum, l) => sum + l.percent, 0) });
    }
    out.push({ held, holders, parts, known, asOf: all[0].asOf || '',
      name: ar ? (all[0].heldNameAr || all[0].heldName || held) : (all[0].heldName || held) });
  }
  return out;
}

/** Companies that reached the exchange AND the press inside the window.
 *
 * §8: only titles the builder vetted count, because press text can carry a
 * forecast and every one of these is printed. A company that only filed is
 * the filings screen's business; what is new here is the coincidence, and a
 * coincidence needs two different kinds of thing. Most documents first, then
 * the newest where two are level — never a company chosen for what its
 * strands say. */
export function crossingCompanies(data) {
  const items = (data.crossings && Array.isArray(data.crossings.items)) ? data.crossings.items : [];
  return items.map((item) => {
    const strands = (item.strands || []).filter((x) => x && x.date && x.titleOk);
    const filings = strands.filter((x) => x.kind === 'filing').length;
    const stories = strands.filter((x) => x.kind === 'news').length;
    const newest = strands.map((x) => String(x.date)).sort().at(-1) || '';
    return { item, strands, filings, stories, newest };
  }).filter((x) => x.strands.length >= 2 && x.filings > 0 && x.stories > 0)
    .sort((a, b) => b.strands.length - a.strands.length || b.newest.localeCompare(a.newest)
      || String(a.item.ticker).localeCompare(String(b.item.ticker)));
}

/* Arabic counts of the two kinds of document, in all four forms. The shelf
   printed "2 إفصاح" and "4 خبر", which is the singular after every number. */
export const filingsAr = (n) => (n === 1 ? 'إفصاح واحد' : n === 2 ? 'إفصاحان'
  : n >= 3 && n <= 10 ? `${n} إفصاحات` : `${n} إفصاحاً`);
export const storiesAr = (n) => (n === 1 ? 'خبر واحد' : n === 2 ? 'خبران'
  : n >= 3 && n <= 10 ? `${n} أخبار` : `${n} خبراً`);

/* "2 filings · 1 story" / "إفصاحان · خبر واحد" — what a crossing rests on. */
export function crossingCounts(x, ar) {
  if (ar) return [filingsAr(x.filings), storiesAr(x.stories)].join(' · ');
  return [`${x.filings} ${x.filings === 1 ? 'filing' : 'filings'}`,
    `${x.stories} ${x.stories === 1 ? 'story' : 'stories'}`].join(' · ');
}

/** A company's disclosed holders as a key to its share bar: the same order
 *  and the same four tints the bar draws, each with its level and the day it
 *  was filed. The bar's own legend is hidden where this stands — at a card's
 *  width it cut "Gadwa For Industrial Development 13.87" into the band beside
 *  it — and a list can carry the filing date the legend has no room for. */
export function holdersKey(co, ar, day = (iso) => iso) {
  const shown = co.holders.slice(0, 3);
  const rest = co.holders.slice(3);
  return h('ul', { class: 'ct-holders' },
    shown.map((l, i) => h('li', { key: `${l.name}-${i}` },
      h('i', { class: `ct-sw is-${i}`, 'aria-hidden': 'true' }),
      h('span', { class: 'ct-holder' }, l.name || '—'),
      h('b', { dir: 'ltr' }, `${l.percent.toFixed(2)}%`),
      l.asOf ? h('small', null, day(l.asOf)) : null)),
    rest.length ? h('li', { key: 'rest' },
      h('i', { class: 'ct-sw is-3', 'aria-hidden': 'true' }),
      h('span', { class: 'ct-holder' }, ar ? `${rest.length} مالكين آخرين` : `${rest.length} more ${rest.length === 1 ? 'holder' : 'holders'}`),
      h('b', { dir: 'ltr' }, `${rest.reduce((n, l) => n + l.percent, 0).toFixed(2)}%`)) : null);
}

/** The card frame every one of the three shares. */
function card({ dateline, primitive, title, titleGo, lede, visual, limit, chip, more, key }) {
  if (!visual) return null;
  return h('article', { key, class: 'ct-card' },
    h('div', { class: 'ct-head' },
      h('span', { class: 'ct-dateline' }, dateline),
      h('span', { class: 'ct-primitive' }, primitive)),
    /* A card about one company names it in the title, and a name is the
       first thing a reader presses. */
    h('h3', { class: 'ct-title' }, titleGo
      ? h('button', { type: 'button', class: 'ct-title-go', onClick: titleGo }, title)
      : title),
    // One plain line before the drawing: what this card means for the reader.
    // The limit line below the drawing keeps its job of saying what it is not.
    lede ? h('p', { class: 'ct-lede' }, lede) : null,
    h('div', { class: 'ct-rule' }),
    h('div', { class: 'ct-visual' }, visual),
    h('p', { class: 'ct-limit' }, limit),
    h('div', { class: 'ct-rule' }),
    h('div', { class: 'ct-foot' }, chip, more));
}

/**
 * The busiest companies in the session, each against its own normal.
 *
 * WHY THE BARS ARE MULTIPLES AND NOT SHARE COUNTS
 * The obvious chart — four companies' session volumes on one axis — cannot be
 * drawn honestly. On this exchange the busiest name trades billions of shares
 * and the fourth-busiest trades hundreds of thousands, so a shared axis draws
 * three of the four as hairlines on the floor and the card says "one company
 * traded and the others did not", which is false.
 *
 * So each company is drawn against ITSELF: its own twenty-session median is
 * the bar of 1, and this session is however many times that it reached. Now
 * the four are comparable, because the question the card asks — how far above
 * its own normal did this go — is the same question for each of them. The real
 * share count sits under its own bar so the multiple is never the only number
 * a reader leaves with.
 */
function volumeCard(data, ar, t, open, day, see) {
  /* UNUSUAL, OR IT IS NOT A CHANGE.
     This shelf is headed "what changed today". Every session has a busiest
     company, so drawing whichever one it is guarantees a card on the quietest
     day of the year — and a card on a page with that heading asserts that
     something happened. Twice its own usual volume is the bar; below it the
     company simply traded. */
  const rows = unusualCompanies(data);
  if (!rows.length) return null;
  // Four bars — a fifth would thin every bar under the card's width — and
  // the list beside them carries the next ones by name.
  const top = rows.slice(0, 4);
  const listed = rows.slice(0, LIST_ROWS);
  const lead = top[0];
  const name = named(lead, ar);
  return card({
    key: 'volume',
    dateline: t(stamp([day(data.marketDate), sessionWord(data, false), companiesWord(rows.length, false)]),
      stamp([day(data.marketDate), sessionWord(data, true), companiesWord(rows.length, true)])),
    primitive: t('PAIRED BARS', 'أعمدة مزدوجة'),
    lede: t('Something drew attention to this share today; the filings and the news say what, the volume alone does not.',
      'شيء جذب الانتباه إلى هذا السهم اليوم؛ الإفصاحات والأخبار تقول ماذا، لا الحجم وحده.'),
    title: top.length > 1
      ? t(`${lead.ticker} · ${name} traded ${lead.rv.toFixed(1)}× its usual volume, and it was not alone`,
        `${lead.ticker} · ${name} تداولت ${lead.rv.toFixed(1)}× حجمها المعتاد، ولم تكن وحدها`)
      : t(`${lead.ticker} · ${name} traded ${lead.rv.toFixed(1)}× its usual volume`,
        `${lead.ticker} · ${name} تداولت ${lead.rv.toFixed(1)}× حجمها المعتاد`),
    visual: h('div', { class: 'ct-volume-block' },
      pairedBars({ ar, width: 460, height: 136, groups: top.map((c, i) => ({
        prior: 1, now: c.rv,
        priorValue: '1×', nowValue: `${c.rv.toFixed(1)}×`,
        priorLabel: c.ticker, nowPeriodLabel: compact(c.volume),
        unit: i === 0 ? t('× its own usual', '× حجمها المعتاد') : '',
      })) }),
      h('div', { class: 'ct-abnormal-list', 'aria-label': t('Abnormal volume companies', 'الشركات ذات الحجم غير المعتاد') },
        listed.map((c) => {
          const cName = named(c, ar);
          const isUp = (c.pct || 0) >= 0;
          const maxRv = listed[0]?.rv || 1;
          const barWidth = Math.min(100, Math.max(10, Math.round((c.rv / maxRv) * 100)));
          return h('button', {
            type: 'button',
            key: c.ticker,
            class: 'ct-abnormal-row',
            onClick: () => open(c.ticker),
          }, [
            h('span', { class: 'ct-abnormal-co' }, [
              h('b', { class: 'ct-abnormal-code' }, c.ticker),
              h('small', { class: 'ct-abnormal-name' }, cName),
            ]),
            h('span', { class: 'ct-abnormal-bar-wrap' }, [
              h('span', { class: 'ct-abnormal-bar' }, [
                h('i', { style: { width: `${barWidth}%` } }),
              ]),
              h('small', { class: 'ct-abnormal-bar-lbl' }, t('vs normal', 'مقابل المعتاد')),
            ]),
            h('span', { class: 'ct-abnormal-mult', dir: 'ltr' }, `${c.rv.toFixed(1)}×`),
            finite(c.pct) ? h('span', { class: `ct-abnormal-pct ${isUp ? 'up' : 'down'}`, dir: 'ltr' },
              `${isUp ? '+' : ''}${c.pct.toFixed(2)}%`) : null,
            h('span', { class: 'ct-abnormal-arrow', 'aria-hidden': 'true' }, '↗'),
          ]);
        }))),
    limit: t('Each bar is measured against that company’s own usual volume, never against another company’s. Volume is activity, not interest: a session can be busy because one holder sold.',
      'كل عمود يُقاس على الحجم المعتاد للشركة نفسها، لا على شركة أخرى. الحجم نشاط وليس اهتماماً: قد تكون الجلسة نشطة لأن مالكاً واحداً باع.'),
    chip: evidenceChip({ ar, date: day(data.marketDate),
      basis: t('session volume ÷ median of 20 sessions', 'حجم الجلسة ÷ وسيط 20 جلسة'),
      source: 'EGX' }),
    more: fullList(see, 'volume', rows.length, ar)
      || h('button', { type: 'button', class: 'ct-more', onClick: () => open(lead.ticker) },
        t('Open the company ↗', 'افتح الشركة ↗')),
  });
}

/* The way from a card to every company behind it, with the count the page
   will draw. Absent when the host gave no page to go to, and the card keeps
   the one action it had.

   Worded for what the list HOLDS rather than "full list": put to Jev on 22
   September 2026 against "Full list · 18 companies", "See all 18 companies"
   and a question-first line, the Arabic that names the contents won outright
   (0.70); the English candidates tied (0.42–0.53), so English follows the
   Arabic. The count is the length of the page's section. */
const FULL_LABEL = {
  volume: (n, ar) => (ar ? `كل شركة فوق حجمها المعتاد، بأرقام أكثر (${n}) ↗`
    : n === 1 ? 'The one company above its usual volume, with more figures ↗'
      : `All ${n} companies above their usual volume, with more figures ↗`),
  ownership: (n, ar) => (ar ? `كل شركة أُفصح عن حصة فيها خلال ${FILING_DAYS} يوماً (${n}) ↗`
    : n === 1 ? `The one company with a stake filed in ${FILING_DAYS} days ↗`
      : `All ${n} companies with a stake filed in ${FILING_DAYS} days ↗`),
  crossings: (n, ar) => (ar ? `كل شركة في الإفصاحات والصحافة، بمستنداتها (${n}) ↗`
    : n === 1 ? 'The one company in the filings and the press ↗'
      : `All ${n} companies in the filings and the press ↗`),
};
function fullList(see, section, n, ar) {
  if (!see || !(n > 0) || !FULL_LABEL[section]) return null;
  return h('button', { type: 'button', class: 'ct-more ct-full', onClick: () => see(section) },
    FULL_LABEL[section](n, ar));
}

/**
 * The index against its own recent average.
 *
 * A description of where it sits, never a signal: the average is drawn as a
 * ghost line so it reads as a reference, and the limit line says the crossing
 * is not an event.
 */
function indexCard(data, ar, t, open, day, see) {
  const idx = (data.indices || []).find((i) => Array.isArray(i.points) && i.points.length >= 10);
  if (!idx) return null;
  const points = idx.points.filter(finite);
  if (points.length < 10) return null;
  const name = ar ? (idx.labelAr || idx.label) : idx.label;
  const mean = points.reduce((s, v) => s + v, 0) / points.length;
  const below = points[points.length - 1] < mean;
  /* A CROSSING, NOT A POSITION.
     An index is always on one side of its own average, and it was on that
     side yesterday too. Drawing where it sits makes a standing condition look
     like today's news — and since it is true every day, it filled a slot on
     this shelf every day. The card is drawn only on the session the index
     changed sides. Its own limit line still says a crossing is a description
     and not an event; what changed is that the drawing is now about something
     that happened today. */
  const priorBelow = points[points.length - 2] < mean;
  if (below === priorBelow) return null;
  /* STAMPED WITH ITS OWN SERIES' DATE, AND CALLED A CLOSE.
     Every point on this line is a settled close, so the card's date is the
     date of the last one and its word is "close" whatever the session is
     doing now. It borrowed the shelf's date and the shelf's word until 22
     September 2026, when the shelf moved to the live session's — and the card
     read "22 September · session so far … closed below its average ·
     official close 22 September" at 10:50, over Monday's crossing, while the
     index was up 0.32% in the headline above it. */
  const closedOn = idx.pointsTo || data.documentDate || data.marketDate;
  return card({
    key: 'index',
    dateline: t(stamp([day(closedOn), 'close', `${points.length} sessions`]),
      stamp([day(closedOn), 'إغلاق', `${points.length} جلسة`])),
    primitive: t('LINE', 'خط'),
    lede: below
      ? t('The index sits below its recent average: the last weeks were weaker than their own average. Where it is, not where it goes.',
        'المؤشر اليوم تحت متوسطه في الأسابيع الأخيرة، أي إن الأيام الأخيرة كانت أضعف من المعتاد. يصف أين هو، لا إلى أين يذهب.')
      : t('The index sits above its recent average: the last weeks were better than their own average. Where it is, not where it goes.',
        'المؤشر اليوم فوق متوسطه في الأسابيع الأخيرة، أي إن الأيام الأخيرة كانت أفضل من المعتاد. يصف أين هو، لا إلى أين يذهب.'),
    title: below
      ? t(`${name} closed below its ${points.length}-session average`,
        `${name} أغلق أدنى من متوسط ${points.length} جلسة`)
      : t(`${name} closed above its ${points.length}-session average`,
        `${name} أغلق أعلى من متوسط ${points.length} جلسة`),
    visual: line({ ar, points, ghost: points.map(() => mean), height: 104,
      label: t(`points · ${points.length} sessions · average dashed`,
        `نقطة · ${points.length} جلسة · المتوسط متقطّع`) }),
    limit: t('Where it sits against its own recent closes. A crossing is a description, not an event.',
      'موضعه مقابل إغلاقاته الأخيرة. التقاطع وصف، وليس واقعة.'),
    chip: evidenceChip({ ar, date: day(closedOn),
      basis: t('official close', 'إغلاق رسمي'), source: t('EGX session bulletin', 'نشرة جلسة EGX') }),
    more: see
      ? h('button', { type: 'button', class: 'ct-more ct-full', onClick: () => see('index') },
        t('Every index against its average ↗', 'كل المؤشرات مقابل متوسطها ↗'))
      : h('button', { type: 'button', class: 'ct-more', onClick: () => open(null) },
        t('The whole market ↗', 'السوق كله ↗')),
  });
}

/**
 * The newest disclosed cross-holdings — one bar per company.
 *
 * This is the card the share bar was built for. The disclosed stakes are
 * named; everything else is one hatched band that says "not disclosed" —
 * never normalised away, because "we know 12% of this" and "12% is all there
 * is" are opposite statements.
 *
 * THREE COMPANIES, THREE BARS, NOT ONE BAR OF THREE COMPANIES
 * Putting three companies in one bar would make the segments read as shares
 * of a single pot, and three companies' capital is not one pot. Each company
 * keeps its own bar, so each remainder is that company's own undisclosed
 * share rather than an average of three.
 */
function ownershipCard(data, ar, t, open, day, see) {
  /* THREE, NOW FIVE, COMPANIES — AND STILL ONE BAR EACH.
     Each company keeps its own bar, so each remainder is that company's own
     undisclosed share rather than an average of several. */
  const stakes = recentStakes(data, ar);
  const picked = stakes.slice(0, STAKE_ROWS);
  if (!picked.length) return null;

  const newest = picked[0];
  return card({
    key: 'ownership',
    dateline: t(stamp([day(newest.asOf), 'ownership filings', companiesWord(stakes.length, false)]),
      stamp([day(newest.asOf), 'إفصاحات ملكية', companiesWord(stakes.length, true)])),
    primitive: t('SHARE BAR', 'شريط نصيب'),
    lede: t('Whoever holds a large stake has filed it; the bar shows what is disclosed and what remains unknown.',
      'من يملك حصة كبيرة أفصح عنها؛ الشريط يريك المُعلن وما بقي مجهولاً.'),
    title: picked.length > 1
      ? t(`What is disclosed of ${picked.length} companies, and what is not`,
        `المُعلن من ${picked.length === 2 ? 'شركتين' : companiesWord(picked.length, true)}، وما ليس معلناً`)
      : t(`${newest.held} · ${newest.name}: ${newest.known.toFixed(2)}% is disclosed`,
        `${newest.held} · ${newest.name}: المُعلن ${newest.known.toFixed(2)}%`),
    visual: h('div', { class: 'ct-own-stack' }, picked.map((co) => h('div',
      { key: co.held, class: 'ct-own-row' },
      h('button', { type: 'button', class: 'ct-own-name', onClick: () => open(co.held) },
        h('span', { class: 'ct-own-code' }, co.held),
        h('span', { class: 'ct-own-label' }, co.name),
        h('span', { class: 'ct-own-known' }, t(`${co.known.toFixed(2)}% disclosed`,
          `المُعلن ${co.known.toFixed(2)}%`))),
      shareBar({ ar, parts: co.parts }),
      holdersKey(co, ar, (iso) => shortOf(iso, ar))))),
    limit: t('What is filed, not what is held. A stake under the disclosure threshold never appears here, and each bar is one company’s own capital.',
      'ما أُفصح عنه، لا ما هو مملوك. الحصة دون حدّ الإفصاح لا تظهر هنا أبداً، وكل شريط هو رأس مال شركة واحدة.'),
    chip: evidenceChip({ ar, date: day(newest.asOf),
      basis: t('Articles 29 & 38', 'إفصاحات المادتين 29 و 38'), source: 'EGX' }),
    more: fullList(see, 'ownership', stakes.length, ar)
      || h('button', { type: 'button', class: 'ct-more', onClick: () => open(newest.held) },
        t('Open the company ↗', 'افتح الشركة ↗')),
  });
}

/**
 * A company that turned up in two different places inside the same few days.
 *
 * WHY THIS CARD EXISTS — the shelf could only fill two of its three slots.
 * Measured on 20 September 2026 against the published index history: over 170
 * sessions with enough history behind them, EGX 30 crossed its own 34-session
 * average NINE times. `indexCard` is a crossing and not a position, which is
 * right — a standing condition drawn as news filled a slot every single day —
 * but it means the third slot was empty on about 19 sessions in 20, and what
 * stood in it said "on a quiet session there are fewer". Nineteen days in
 * twenty is not a quiet session; it is the normal one, and a shelf that
 * apologises most days has miscounted what it can supply, not what happened.
 *
 * `connections.json` is the missing supply. It is already fetched for Home
 * and already carries what an evidence card needs: dated strands, each with
 * the document behind it, and the pipeline's own sentence for why the company
 * is on the list. It is the one kind of evidence on this site that is ABOUT
 * TIME, which is why it is drawn on a timeline rather than a bar.
 *
 * TWO MARKS, BECAUSE THEY ARE TWO DIFFERENT CLAIMS
 * A filing is the company's own statement to the exchange; a story is
 * somebody writing about the company. The timeline draws the first filled and
 * the second outlined rather than flattening both into "a mention".
 *
 * THE BAR IT HAS TO CLEAR
 * A strand dated the session on screen, both kinds present, and every title
 * vetted by the builder. A company that only filed is the filings screen's
 * business and the ownership card's; what is new here is the coincidence, and
 * a coincidence needs two different kinds of thing to be one.
 */
function crossingCard(data, ar, t, open, day, see) {
  const doc = data.crossings;
  const all = crossingCompanies(data);
  if (!all.length) return null;
  /* The session, as an ISO date, because that is what a strand carries.
     Taken with a pattern rather than a slice: a caller that hands this module
     a FORMATTED date — "17 September 2026" — would otherwise be compared as
     its first ten characters, which match nothing and silently retire the
     card. Fails closed, because a crossing that cannot be tied to today's
     session is not today's news. */
  const session = (/^(\d{4}-\d{2}-\d{2})/.exec(String(data.marketDate || '')) || [])[1] || '';
  if (!session) return null;

  /* The card is about the most documented company with a document dated
     today; the rest of the week's companies are listed under it by name. */
  const lead = all.find((x) => x.strands.some((s) => s.date === session));
  if (!lead) return null;
  const { item, strands } = lead;
  const also = all.filter((x) => x !== lead).slice(0, ALSO_ROWS);
  const name = ar ? (item.nameAr || item.name) : (item.name || item.ticker);
  const why = ar ? (item.whyAr || item.why) : (item.why || '');
  if (!why) return null;

  /* Oldest first, because the drawing is a window of time and time runs one
     way. At most six, which is as many rows as the card has height for. */
  const shown = strands.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-6);
  const filings = shown.filter((x) => x.kind === 'filing').length;
  const stories = shown.length - filings;

  /* ONE MARK PER DAY, NOT ONE PER DOCUMENT.
     `datedTimeline` spaces its events evenly by position, so six strands —
     three of them filed on the same morning — came out as six equidistant
     marks under six labels that overlapped into each other, three of them
     reading the same date. A day is the unit this card's claim is in ("a
     filing and a story inside four days"), so a day is what gets a mark, and
     what happened on it is the label. */
  const byDay = new Map();
  shown.forEach((x) => {
    if (!byDay.has(x.date)) byDay.set(x.date, { filings: 0, stories: 0 });
    const d = byDay.get(x.date);
    if (x.kind === 'filing') d.filings += 1; else d.stories += 1;
  });
  const dayWord = (n, one, many) => (n === 1 ? `${n} ${one}` : `${n} ${many}`);
  const days = [...byDay.entries()].map(([date, d]) => ({
    // Short, because a label wider than its slot is a label that collides
    // with the one beside it. The full window is in the dateline above.
    date: shortOf(date, ar),
    kind: d.filings ? 'paid' : 'proposed',
    label: [d.filings ? t(dayWord(d.filings, 'filing', 'filings'), filingsAr(d.filings)) : '',
      d.stories ? t(dayWord(d.stories, 'story', 'stories'), storiesAr(d.stories)) : '',
    ].filter(Boolean).join(' · '),
  }));

  return card({
    key: 'crossing',
    /* The count is the list the full page draws — companies in both places
       with vetted titles — not the builder's `total`, which the page cannot
       show a row for when a title was refused. */
    dateline: t(stamp([`${day(doc.windowStart)} – ${day(doc.windowEnd)}`,
      companiesWord(all.length, false), `${shown.length} documents`]),
    stamp([`${day(doc.windowStart)} – ${day(doc.windowEnd)}`,
      companiesWord(all.length, true), shown.length === 2 ? 'مستندان' : `${shown.length} مستندات`])),
    primitive: t('DATED TIMELINE', 'خط زمني'),
    lede: t('The same company reached the exchange and the press inside a few days. Two records of one week, side by side — which is a coincidence of timing until a document says otherwise.',
      'الشركة نفسها وصلت إلى البورصة وإلى الصحافة خلال أيام قليلة. سجلّان لأسبوع واحد جنباً إلى جنب — وهذا تزامن في التوقيت إلى أن يقول مستند غير ذلك.'),
    title: `${item.ticker} · ${name}`,
    titleGo: () => open(item.ticker),
    visual: h('div', { class: 'ct-cross-block' },
      /* A filing is filled and a story is outlined: the primitive's own two
         marks, used for the difference they were drawn for — a filing is the
         company's statement to the exchange, a story is somebody writing
         about it. A day carrying both is drawn as a filing. */
      datedTimeline({ ar, height: 104, events: days }),
      h('p', { class: 'ct-cross-why' }, why),
      h('ul', { class: 'ct-cross-list' }, shown.slice().reverse().map((x) => {
        /* "A document for every one" is this shelf's promise, so each row
           opens the document it names — the exchange's filing or the story. */
        const label = ar ? (x.titleAr || x.title) : x.title;
        const href = sourceHref(x.link);
        return h('li', { key: x.id || x.date + x.title, class: `ct-cross-item is-${x.kind}` },
          h('span', { class: 'ct-cross-when' }, day(x.date)),
          href
            ? h('a', { class: 'ct-cross-title', href, target: '_blank', rel: 'noopener noreferrer' }, label, ' ↗')
            : h('span', { class: 'ct-cross-title' }, label));
      })),
      /* The rest of the week's companies in both places, each one a way in.
         The card is about one; the reader asked for more than one. */
      also.length ? h('div', { class: 'ct-also' },
        h('p', { class: 'ct-also-head' }, t('Also in the filings and the press this week',
          'وأيضاً في الإفصاحات والصحافة هذا الأسبوع')),
        also.map((x) => h('button', { type: 'button', key: x.item.ticker, class: 'ct-also-row',
          onClick: () => open(x.item.ticker) },
        h('b', { class: 'ct-also-code' }, x.item.ticker),
        h('span', { class: 'ct-also-name' }, ar ? (x.item.nameAr || x.item.name) : (x.item.name || x.item.ticker)),
        h('span', { class: 'ct-also-count' }, crossingCounts(x, ar)),
        h('span', { class: 'ct-also-arrow', 'aria-hidden': 'true' }, '↗')))) : null),
    limit: t('Appearing in two places in one week is timing, not cause: nothing here says the filing and the story are about each other, or that either moved the share.',
      'الظهور في مكانين خلال أسبوع تزامن لا سببية: لا شيء هنا يقول إن الإفصاح والخبر يخصّ أحدهما الآخر، ولا إن أياً منهما حرّك السهم.'),
    chip: evidenceChip({ ar, date: day(doc.windowEnd),
      basis: t(`${filings} filed · ${stories} written`, `${filingsAr(filings)} · ${storiesAr(stories)}`),
      source: t('EGX filings & the Egyptian press', 'إفصاحات البورصة والصحافة المصرية') }),
    more: fullList(see, 'crossings', all.length, ar)
      || h('button', { type: 'button', class: 'ct-more', onClick: () => open(item.ticker) },
        t('Open the company ↗', 'افتح الشركة ↗')),
  });
}

export function changedToday(data, ar, { openCompany, openMarket, openSection, heading, note, longDate }) {
  const t = (en, arabic) => (ar ? arabic : en);
  /* Every other dateline on the site runs through `longDate`; these three
     were handed the raw ISO string, so a card headed "17 سبتمبر 2026 · إغلاق"
     everywhere else read "2026-09-17 · إغلاق" here — a bare machine date
     wedged into an Arabic sentence, with its digits fighting the RTL run
     around them. */
  const day = typeof longDate === 'function' ? longDate : (iso) => iso;
  const open = (ticker) => (ticker ? openCompany(ticker) : openMarket());
  /* Where a card's full list lives: the page with every company behind the
     row, opened at that card's section. */
  const see = typeof openSection === 'function' ? openSection : null;
  /* Four builders for three slots, so the shelf has something to choose
     between rather than something to apologise for. The order is the order of
     claim: what moved, what crossed, what was filed, what coincided — and the
     first three that clear their own bar are drawn. Nothing is lowered to
     fill a slot; a builder that found nothing still returns null and the
     shelf still comes back short when the session really was quiet. */
  const cards = [volumeCard(data, ar, t, open, day, see), indexCard(data, ar, t, open, day, see),
    ownershipCard(data, ar, t, open, day, see), crossingCard(data, ar, t, open, day, see)]
    .filter(Boolean).slice(0, 3);
  if (!cards.length) return null;
  /* THE QUIET DAY IS A REAL ANSWER.
     Three slots and three card builders is an arrangement that fills itself:
     whatever each builder found became a card, so the shelf said "three things
     changed today" on a session where nothing did. Each builder now has a bar
     it has to clear, which means the shelf can come back with one card, or
     two. Saying so is the honest end of the sentence — the alternative is
     lowering a bar until the row looks full, which is how a page that
     promises evidence starts manufacturing it.

     Drawn as a card in the empty slot rather than a footnote, because a row of
     two cards and a gap reads as something that failed to load. */
  const shy = cards.length < 3
    ? h('article', { key: 'none', class: 'ct-card ct-none' },
      h('p', { class: 'ct-none-line' },
        t('No further verified changes.', 'لا تغيّرات موثّقة أخرى.')),
      h('p', { class: 'ct-none-why' },
        t('Every card here rests on a published document. On a quiet session there are fewer, and this shelf does not fill the space with something that did not happen.',
          'كل بطاقة هنا تستند إلى مستند منشور. في الجلسات الهادئة تكون أقل، ولا يملأ هذا الرفّ الفراغ بما لم يحدث.')))
    : null;
  return h('section', { class: 'ct-shelf', 'aria-label': heading },
    h('div', { class: 'ct-shelf-head' },
      h('h2', null, heading),
      h('span', { class: 'ct-shelf-note' }, note),
      see ? h('button', { type: 'button', class: 'ct-shelf-all', onClick: () => see(null) },
        t('Every company behind these cards ↗', 'كل شركة وراء هذه البطاقات ↗')) : null),
    h('p', { class: 'ct-shelf-lede' }, t(
      'What actually happened today, with a drawing and a document for each fact — no opinions: who traded far above usual, where the index stands, and who declared a stake.',
      'ما حدث فعلاً اليوم، برسم ومستند لكل واقعة — لا آراء: من تداول أكثر من عادته بكثير، وأين يقف المؤشر، ومن أعلن عن حصته.')),
    h('div', { class: 'ct-grid' }, shy ? cards.concat([shy]) : cards));
}
