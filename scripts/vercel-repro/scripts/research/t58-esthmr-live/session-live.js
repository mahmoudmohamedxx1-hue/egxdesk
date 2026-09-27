/* الجلسة الجارية — the session, while it is still running.
 *
 * WHY THIS EXISTS
 * On Sunday 20 September 2026 the owner asked why the website had not
 * updated that morning. It had: the code was deployed, the data had rebuilt
 * at 09:30 Cairo, and the quote feed was answering with 290 live prices. What
 * had not changed was the READING. Every dateline on Home said 17 September —
 * the Thursday the last document was built — while every price, every move
 * and every count under those datelines came from the session running at that
 * moment. Thursday's date over today's numbers is indistinguishable, from the
 * reader's chair, from a page that did not refresh.
 *
 * Three facts stacked to produce it. The exchange is shut Friday and
 * Saturday, so the newest settled session is always Thursday's. The daily
 * rebuild fires at 09:30 Cairo, half an hour BEFORE the 10:00 open, so at
 * build time the newest close is still Thursday's and cannot be anything
 * else. And the live feed replaces the prices without replacing the stamp
 * over them.
 *
 * So this band says, in the only place a reader looks first, which of the two
 * days the numbers belong to — and while the session is open it says how far
 * into it the reading is, because "10:48 on a session that runs to 14:30" is
 * the fact that turns an unchanged-looking page into a page that is early.
 *
 * WHAT IT IS NOT
 * It is not a ticker and it does not animate. A band that moves is read as a
 * price feed, and these are delayed figures. Nothing here is computed from
 * the reader's own clock: the minute comes from the feed's own Cairo stamp,
 * so a reader with a wrong clock sees the exchange's time and not theirs.
 *
 * It draws nothing it does not have. No feed, no band on an open day; no
 * session date, no band at all.
 */
import { React as R } from './react-shim.js';

const h = R.createElement;

/* The exchange's own hours, in Cairo minutes past midnight — the same two
   numbers the quotes Worker uses to decide `session.open`, so the band and
   the feed can never disagree about whether the market is trading. */
export const OPEN_MIN = 10 * 60;
export const CLOSE_MIN = 14 * 60 + 30;

/** Where a reading sits between the bell and the close, as 0…1.
 *
 * Clamped at both ends rather than extrapolated: the pre-open auction and the
 * closing auction both report minutes outside the session, and a marker drawn
 * past the end of its own bar is a rendering fault, not a fact. */
export function progressOf(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const span = CLOSE_MIN - OPEN_MIN;
  return Math.max(0, Math.min(1, (minutes - OPEN_MIN) / span));
}

/** A Cairo minute count as HH:MM, or '' when there is nothing to print. */
export function clockOf(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Arabic counts for minutes, which take four different forms. */
function minutesAr(n) {
  if (n === 1) return 'دقيقة واحدة';
  if (n === 2) return 'دقيقتان';
  if (n >= 3 && n <= 10) return `${n} دقائق`;
  return `${n} دقيقة`;
}

const minutesWord = (n, ar) => (ar ? minutesAr(n) : `${n} minute${n === 1 ? '' : 's'}`);

/** How much of the session is gone and how much is left, in words.
 *
 * Both halves, because either alone is the wrong one for somebody: a reader
 * opening at 10:05 wants to know the session has barely started, and one
 * opening at 14:20 wants to know it is nearly over. */
export function spanWords(minutes, ar) {
  if (!Number.isFinite(minutes)) return '';
  const since = Math.max(0, Math.round(minutes - OPEN_MIN));
  const left = Math.max(0, Math.round(CLOSE_MIN - minutes));
  if (left === 0) return ar ? 'عند الإغلاق' : 'at the close';
  if (since === 0) return ar ? 'عند الجرس' : 'at the bell';
  /* Nouns rather than verbs on the Arabic side. "مضى 55 دقيقة" forces a
     verb to agree with a counted feminine noun after a number, which is one
     of the few places Arabic has no single uncontested form — and a line
     nobody can be sure is right does not belong on the first row of the page.
     "منذ الجرس" and "حتى الإغلاق" say the same thing and ask nothing. */
  return ar
    ? `منذ الجرس ${minutesAr(since)} · حتى الإغلاق ${minutesAr(left)}`
    : `${minutesWord(since, false)} in · ${minutesWord(left, false)} left`;
}

/** The bar: the session's own hours, with the reading marked on it.
 *
 * A bar and not a clock face. The question it answers is "how much of today
 * has the exchange already traded", which is a proportion, and a proportion
 * is read off a length. The filled part is elapsed; the marker is the moment
 * the figures on this page were read, which is fifteen minutes behind the
 * exchange and is labelled as such beside it.
 */
function sessionBar(minutes, ar) {
  const at = progressOf(minutes);
  if (at === null) return null;
  const pct = `${(at * 100).toFixed(1)}%`;
  return h('div', { class: 'sl-bar-wrap' },
    h('span', { class: 'sl-bar-end', dir: 'ltr' }, clockOf(OPEN_MIN)),
    h('div', {
      class: 'sl-bar',
      role: 'img',
      'aria-label': ar
        ? `الجلسة من ${clockOf(OPEN_MIN)} إلى ${clockOf(CLOSE_MIN)}، والقراءة عند ${clockOf(minutes)}`
        : `Session ${clockOf(OPEN_MIN)} to ${clockOf(CLOSE_MIN)}, read at ${clockOf(minutes)}`,
    },
    h('i', { class: 'sl-bar-done', style: `inline-size:${pct}` }),
    h('b', { class: 'sl-bar-mark', style: `inset-inline-start:${pct}` })),
    h('span', { class: 'sl-bar-end', dir: 'ltr' }, clockOf(CLOSE_MIN)));
}

/** Where the prices came from, counted. Never "live prices" over two sources.
 *
 * The exchange's own rows and a vendor's are both on this page on every
 * session — the exchange carries most of the listed names and the vendor most
 * of the tail — and a reader is entitled to the split rather than a single
 * word that covers both. */
function sourceWords(count, from, ar) {
  if (!Number.isFinite(count) || count <= 0) return '';
  const head = ar ? `${count} شركة لها سعر متحرّك` : `${count} companies quoting`;
  const egx = from && Number.isFinite(from.egx) ? from.egx : null;
  const vendor = from && Number.isFinite(from.vendor) ? from.vendor : null;
  if (egx === null && vendor === null) return head;
  const parts = [];
  if (egx !== null) parts.push(ar ? `${egx} من البورصة` : `${egx} from the exchange`);
  if (vendor !== null) parts.push(ar ? `${vendor} من مزوّد` : `${vendor} from a vendor`);
  return `${head} · ${parts.join(ar ? '، ' : ', ')}`;
}

/** The band.
 *
 * `data` is the shape `live()` returns; `longDate` formats an ISO date in the
 * reader's language and is passed in rather than imported so this module
 * keeps no opinion about how a date is spelled.
 *
 * Returns null when there is nothing true to say: no session date at all, or
 * a settled close on a day the exchange traded — the close is the ordinary
 * case and already carries its own date everywhere on the page.
 */
export function sessionLive(data, ar, { longDate = (iso) => iso, onOpenMarket = null } = {}) {
  const t = (en, arabic) => (ar ? arabic : en);
  const date = data.figuresDate || data.marketDate || null;
  if (!date) return null;

  const open = Boolean(data.livePrices);
  /* A settled document whose date has already passed in Cairo: the weekend
     and the holiday. Said from the archive and never from a trading calendar
     this site does not publish — "no session has been published for today" is
     a fact about what arrived, and naming the next one would be a claim about
     holidays nobody here can check. */
  const stale = !open && isOlderThanCairoToday(date);
  if (!open && !stale) return null;

  const minutes = Number.isFinite(data.liveMinutes) ? data.liveMinutes : null;
  /* THE WHOLE LAG, NOT HALF OF IT.
   *
   * `liveDelaySeconds` is the vendor's own delay and a property of the feed.
   * `liveAgeSeconds` is how long ago the snapshot on this page was taken, and
   * it is a property of what reached this reader. They add up, and printing
   * only the first is how a browser holding an hour-old copy came to show
   * "delayed 15 minutes" over it on 20 September 2026. The overlay refuses a
   * snapshot past `QUOTES_MAX_AGE_MS` now, so this can no longer be hours —
   * but it can be minutes, and minutes are what the number is for. */
  const behind = Number.isFinite(data.liveDelaySeconds) || Number.isFinite(data.liveAgeSeconds)
    ? Math.round(((data.liveDelaySeconds || 0) + (data.liveAgeSeconds || 0)) / 60)
    : null;

  const head = h('div', { class: 'sl-head' },
    h('span', { class: `sl-state${open ? ' is-open' : ''}` },
      h('i', { class: 'sl-dot', 'aria-hidden': 'true' }),
      open ? t('Session running', 'الجلسة جارية') : t('Exchange closed', 'البورصة مغلقة')),
    h('strong', { class: 'sl-date' }, longDate(date)),
    open && minutes !== null
      ? h('span', { class: 'sl-span' }, spanWords(minutes, ar))
      : null);

  if (!open) {
    return h('section', { class: 'session-live is-shut', 'aria-label': t('Exchange closed', 'البورصة مغلقة') },
      head,
      h('p', { class: 'sl-note' },
        t(`No session has been published for today. Every figure below is that day’s close.`,
          'لم تُنشر جلسة لليوم. وكل رقم بالأسفل هو إغلاق ذلك اليوم.')));
  }

  const source = sourceWords(data.liveCount, data.liveFrom, ar);
  return h('section', { class: 'session-live', 'aria-label': t('Session running', 'الجلسة جارية') },
    head,
    sessionBar(minutes, ar),
    /* Before the note and not after it: the note takes a whole row, so a
       button placed under it starts a third, and a three-row band above the
       headline is a band that has become a block. */
    onOpenMarket
      ? h('button', { type: 'button', class: 'sl-open', onClick: onOpenMarket },
        t('The whole session ↗', 'الجلسة كاملة ↗'))
      : null,
    h('p', { class: 'sl-note' },
      /* The two facts that stop a delayed figure reading as a live one, in
         the order a reader needs them: what they are looking at, then how far
         behind it is. */
      [source,
        behind !== null
          ? t(`${behind === 0 ? 'less than a minute' : minutesWord(behind, false)} behind the exchange`,
            `${behind === 0 ? 'أقل من دقيقة' : minutesAr(behind)} خلف البورصة`)
          : '',
        minutes !== null ? t(`read at ${clockOf(minutes)} Cairo`, `قراءة ${clockOf(minutes)} بتوقيت القاهرة`) : '',
      ].filter(Boolean).join(' · ')));
}

/** Is an ISO date earlier than today in Cairo?
 *
 * The exchange's day decides, not the reader's: somebody in Tokyo opening
 * this on their Sunday evening is in Cairo's Sunday too. */
function isOlderThanCairoToday(iso) {
  const date = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return date < today;
}
