/* Release 4, phase 3C — entry windows.
 *
 * Phase 3B parsed, validated and stored every window's `ends`, and nothing
 * read it. This suite covers the reading.
 *
 * The stop behaviour is RUN ON, decided by the product owner: a declared range
 * says where the demo opens and what the board reports, and the playhead runs
 * past it exactly as it does today. So there is no assertion here that the
 * playhead halts — there is an assertion that it does NOT, because a phase
 * that quietly acquired a stop would be indistinguishable from this one until
 * someone left a demo running.
 *
 * The refusal reasons are asserted individually rather than through
 * `ok === false`. Session 6 lost two defects to that shortcut: both were
 * correct refusals carrying false reasons, and both passed every test that
 * only asked whether the document was rejected. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok  = (m, d) => { pass++; console.log('  ok   ' + m + (d ? '  · ' + d : '')); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '  · ' + d : '')); };
const is  = (c, m, d) => c ? ok(m, d) : bad(m, d);
const head = t => console.log('\n' + t);

function loadCores(){
  const ctx = { console, TextEncoder, TextDecoder };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  ['_configdoc-core.js', '_officedoc-core.js', '_datadoc-core.js', '_clock-core.js']
    .forEach(f => {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8'), ctx, { filename:f });
    });
  return ctx.MOMENTUM;
}

/* The mining day, ragged on purpose: 07:00:00 to 06:59:59. */
const ORIGIN = Date.parse('2025-08-08T07:00:00Z');
const END    = ORIGIN + 86399000;
const OPTS   = { originMs: ORIGIN, endMs: END };

const rows = (...rs) => rs.map(r => Object.assign(
  { kind:'', name:'', type:'', unit:'', mode:'', grain:'', span:'', field:'',
    context:'', correct_low:'', correct_high:'', out_low:'', out_high:'',
    persistence:'', starts:'', ends:'', notes:'' }, r));

const docSpan = (span, ...ws) => rows(
  { kind:'dataset', mode:'replay', span:span, grain:'per second' },
  { kind:'field', name:'Shift ID', type:'text' },
  ...ws);
const doc = (...ws) => rows(
  { kind:'dataset', mode:'replay', span:'24 hours', grain:'per second' },
  { kind:'field', name:'Shift ID', type:'text' },
  ...ws);

const M = loadCores();
const D = M.DataDoc;

const reasonFor = (r, name) => {
  const g = (r.doc.ignored || []).filter(x => x.why && x.why.indexOf('"' + name + '"') >= 0);
  return g.length ? g[0].why : '';
};
const countFor = (r, name) =>
  (r.doc.ignored || []).filter(x => x.why && x.why.indexOf('"' + name + '"') >= 0).length;

/* ── 1 · an open window is still legal ──────────────────────────────────── */
head('1 · a window with no end is an open window, not a broken one');

const open = D.fromRows(doc(
  { kind:'window', name:'night shift', starts:'23:00' }
), OPTS);
is(open.ok, 'the document applies');
is(open.doc.windows.length === 1, 'the window is carried');
is(open.doc.windows[0].endsMs === null || open.doc.windows[0].endsMs === undefined,
   'its end is absent rather than invented',
   String(open.doc.windows[0].endsMs));
is(countFor(open, 'night shift') === 0,
   'and nothing is refused — every window authored before 3C looks like this');

/* ── 2 · a range that reads ─────────────────────────────────────────────── */
head('2 · a declared range resolves to two instants');

const ranged = D.fromRows(doc(
  { kind:'window', name:'shift change', starts:'15:00', ends:'18:00' }
), OPTS);
const w = ranged.doc.windows[0];
is(w.startsMs === Date.parse('2025-08-08T15:00:00Z'), 'the start is an instant');
is(w.endsMs === Date.parse('2025-08-08T18:00:00Z'), 'and so is the end');
is(w.endsMs - w.startsMs === 3 * 3600000, 'the range is three hours wide',
   (w.endsMs - w.startsMs) + ' ms');
is(countFor(ranged, 'shift change') === 0, 'a good range is not refused');

/* ── 3 · the four ways a range is wrong, each said honestly ─────────────── */
head('3 · one row, one reason — and the reason is the true one');

const backwards = D.fromRows(doc(
  { kind:'window', name:'backwards', starts:'18:00', ends:'15:00' }
), OPTS);
is(/before it starts/.test(reasonFor(backwards, 'backwards')),
   'an end before its start says so',
   reasonFor(backwards, 'backwards'));
is(!/not a time/.test(reasonFor(backwards, 'backwards')),
   'and does NOT call two good times bad ones');
is(/crosses midnight/.test(reasonFor(backwards, 'backwards')),
   'and names the thing the author probably meant');

const zero = D.fromRows(doc(
  { kind:'window', name:'instant', starts:'15:00', ends:'15:00' }
), OPTS);
is(/no duration/.test(reasonFor(zero, 'instant')),
   'a zero-width window is refused as unenterable, not as unreadable',
   reasonFor(zero, 'instant'));

const junkEnd = D.fromRows(doc(
  { kind:'window', name:'junk', starts:'15:00', ends:'teatime' }
), OPTS);
is(/is not a time/.test(reasonFor(junkEnd, 'junk')),
   'an unreadable end IS called unreadable', reasonFor(junkEnd, 'junk'));
is(/ends at/.test(reasonFor(junkEnd, 'junk')),
   'and is named as the END cell, not the start');

/* ── 4 · the ragged span, again ─────────────────────────────────────────── */
head('4 · the data ends at 06:59:59, and the check knows it');

/* 06:59:59 is the last instant in the file. A window ending exactly there is
   inside the data; one ending a second later is not. Rounding 86,399,000 up to
   a clean day would swallow the difference and pass both. */
const atTheEdge = D.fromRows(doc(
  { kind:'window', name:'last second', starts:'23:00', ends:'06:59:59' }
), OPTS);
is(countFor(atTheEdge, 'last second') === 0,
   'a window ending on the final instant is inside the data',
   'ends ' + new Date(atTheEdge.doc.windows[0].endsMs).toISOString());

/* A clock time earlier than the origin's own time of day wraps to the next
   day, which is what makes a night shift expressible at all. */
const midnight = D.fromRows(doc(
  { kind:'window', name:'night shift', starts:'23:00', ends:'02:00' }
), OPTS);
is(countFor(midnight, 'night shift') === 0,
   'a window crossing midnight is not mistaken for a backwards one');
is(midnight.doc.windows[0].endsMs - midnight.doc.windows[0].startsMs === 3 * 3600000,
   'and is three hours wide, not twenty-one',
   (midnight.doc.windows[0].endsMs - midnight.doc.windows[0].startsMs) + ' ms');

/* THE CONSEQUENCE OF THAT WRAP: on a span opening at 07:00, every clock time
   lands inside the span by construction — 07:00 and later on the first day,
   earlier than 07:00 on the second. So a clock time CANNOT overrun the data,
   and only an absolute instant can. Asserting this keeps the next reader from
   "fixing" the overrun check by writing a clock-time fixture that can never
   reach it. */
const cannotOverrun = D.fromRows(doc(
  { kind:'window', name:'late', starts:'23:00', ends:'06:59:59' }
), OPTS);
is(cannotOverrun.doc.windows[0].endsMs === END,
   'the last clock time of the day lands exactly on the last instant of data');

const pastTheEdge = D.fromRows(doc(
  { kind:'window', name:'overrun', starts:'23:00', ends:'2025-08-09T09:00:00Z' }
), OPTS);
is(/past the end of the attached data/.test(reasonFor(pastTheEdge, 'overrun')),
   'an absolute instant beyond the data is refused, and refused for that reason',
   reasonFor(pastTheEdge, 'overrun'));
is(/06:59:59/.test(reasonFor(pastTheEdge, 'overrun')),
   'the message quotes the real end, not a rounded one');
is(!/24 hours|24:00|07:00:00/.test(reasonFor(pastTheEdge, 'overrun')),
   'a ragged span is never reported as a clean one');

/* ── 5 · a window with no day to land on ────────────────────────────────── */
head('5 · nothing attached: one fault, reported once');

const noData = D.fromRows(doc(
  { kind:'window', name:'shift change', starts:'15:00', ends:'18:00' }
), {});
is(noData.ok, 'the document still applies');
is(countFor(noData, 'shift change') === 1,
   'ONE reason, not one per cell — the fault is the missing day, not the times',
   countFor(noData, 'shift change') + ' reasons');
is(/no day to place it on/.test(reasonFor(noData, 'shift change')),
   'and it is the honest one', reasonFor(noData, 'shift change'));
is(!/is not a time/.test(reasonFor(noData, 'shift change')),
   'a good time is never called a bad one');

/* ── 6 · UTC on both sides ──────────────────────────────────────────────── */
head('6 · resolved and captioned in the same zone');

/* Session 6 shipped a bug that passed in the sandbox and would have failed at
   any client site outside UTC. The end-of-data caption is new surface with the
   same exposure, so it is asserted under a half-hour offset. */
const tz = process.env.TZ;
process.env.TZ = 'Asia/Kolkata';
const kolkata = loadCores().DataDoc.fromRows(doc(
  { kind:'window', name:'overrun', starts:'23:00', ends:'2025-08-09T09:00:00Z' }
), OPTS);
process.env.TZ = tz;
is(/06:59:59/.test(reasonFor(kolkata, 'overrun')),
   'the caption reads 06:59:59 under a half-hour offset too',
   reasonFor(kolkata, 'overrun'));

/* ── 7 · run on: the decision, asserted ─────────────────────────────────── */
head('7 · a declared range does not stop the playhead');

const clock = M.Clock.create({ originMs: ORIGIN, endMs: END,
                               windows: ranged.doc.windows });
clock.seek(Date.parse('2025-08-08T16:00:00Z'));
is(clock.playhead() === Date.parse('2025-08-08T16:00:00Z'),
   'the playhead sits inside the declared range');
clock.seek(Date.parse('2025-08-08T20:00:00Z'));
is(clock.playhead() === Date.parse('2025-08-08T20:00:00Z'),
   'and moves past its end without being clamped to it',
   'RUN ON, not freeze');
is(clock.atEnd() === false,
   'passing a window end is not the end of the data');
clock.seek(END + 3600000);
is(clock.playhead() === END,
   'the DATA end still clamps — the range is advisory, the span is not');

/* ── 7b · a clock time that happens more than once ──────────────────────── */
head('7b · long spans: a good time written where a good time is not enough');

/* A 90-day claims cycle. "15:00" names ninety instants; the reader used to
   place the window silently on day one. Refused now, and refused for the true
   reason — with the thing to write instead. */
const LONG = { originMs: ORIGIN, endMs: ORIGIN + 90 * 86400000 };
const quarter = D.fromRows(docSpan('90 days',
  { kind:'window', name:'review call', starts:'15:00', ends:'18:00' }
), LONG);
is(/happens 90 times/.test(reasonFor(quarter, 'review call')),
   'it is refused, and the count is stated rather than described',
   reasonFor(quarter, 'review call'));
is(/name the day/.test(reasonFor(quarter, 'review call')),
   'and the message says what to write instead');
is(/2025-08-08T15:00:00Z/.test(reasonFor(quarter, 'review call')),
   'giving a real instant as the example, not a placeholder');
is(!/is not a time/.test(reasonFor(quarter, 'review call')),
   'a good time is not called a bad one — the fault is ambiguity, not syntax');
is(quarter.doc.windows[0].startsMs === null,
   'and it is NOT placed at its first occurrence and reported as fine',
   'refuse, don\'t demote');
is(countFor(quarter, 'review call') === 1,
   'one reason for the row, though both cells are ambiguous');

/* An absolute instant is unambiguous however long the span. */
const dated = D.fromRows(docSpan('90 days',
  { kind:'window', name:'review call', starts:'2025-09-01T15:00:00Z',
    ends:'2025-09-01T18:00:00Z' }
), LONG);
is(countFor(dated, 'review call') === 0,
   'naming the day resolves it, on the same 90-day span');

/* THE RAGGED DAY IS UNTOUCHED. 07:00 to 06:59:59 contains each clock time
   exactly once, including 07:00 itself, so nothing about mining changes. This
   is why the rule counts occurrences instead of calling a span "long". */
const stillFine = D.fromRows(doc(
  { kind:'window', name:'day shift', starts:'07:00', ends:'18:00' }
), OPTS);
is(countFor(stillFine, 'day shift') === 0,
   'the mining day still resolves every clock time it is given',
   'span 86,399,000 ms');

/* ── 8 · reading the range: which window is the playhead in ─────────────── */
head('8 · the range is read, and reading it moves nothing');

const roster = [
  { name:'day shift',   startsMs:Date.parse('2025-08-08T07:00:00Z'),
                        endsMs:  Date.parse('2025-08-08T19:00:00Z') },
  { name:'night shift', startsMs:Date.parse('2025-08-08T19:00:00Z'),
                        endsMs:  END },
  { name:'ramp maintenance', startsMs:Date.parse('2025-08-08T22:00:00Z'),
                        endsMs:  Date.parse('2025-08-08T23:00:00Z') },
  { name:'from noon',   startsMs:Date.parse('2025-08-08T12:00:00Z'), endsMs:null }
];
const c2 = M.Clock.create({ originMs: ORIGIN, endMs: END, windows: roster });
const at = t => c2.windowAt(Date.parse(t));
const allAt = t => c2.windowsAt(Date.parse(t)).map(w => w.name).sort();

is(at('2025-08-08T09:00:00Z').name === 'day shift',
   'the playhead reports the window it is in', at('2025-08-08T09:00:00Z').name);
is(c2.playhead() === ORIGIN,
   'and asking did NOT move the playhead — reading is not seeking',
   String(c2.playhead() === ORIGIN));

is(at('2025-08-08T19:00:00Z').name === 'night shift',
   'a boundary instant belongs to the window it OPENS, not the one it closes',
   at('2025-08-08T19:00:00Z').name);
is(allAt('2025-08-08T19:00:00Z').indexOf('day shift') === -1,
   'so no instant is ever inside two adjacent shifts at once');

is(at('2025-08-08T22:30:00Z').name === 'ramp maintenance',
   'where ranges overlap the NARROWEST is reported',
   allAt('2025-08-08T22:30:00Z').join(' + '));
is(allAt('2025-08-08T22:30:00Z').length === 3,
   'though every containing window is still available',
   allAt('2025-08-08T22:30:00Z').join(' + '));
is(at('2025-08-08T13:00:00Z').name === 'day shift',
   'an open window never displaces a bounded one, being the widest thing there is',
   at('2025-08-08T13:00:00Z').name);

/* The last instant of the data has no successor to hand itself to. */
is(c2.windowsAt(END).map(w => w.name).indexOf('night shift') >= 0,
   'the final instant of the data belongs to the shift that runs to it',
   c2.windowsAt(END).map(w => w.name).join(' + '));
is(c2.windowsAt(ORIGIN - 1).length === 0,
   'and an instant before the data is in nothing at all');

const crossed = c2.windowsCrossed(Date.parse('2025-08-08T18:30:00Z'),
                                  Date.parse('2025-08-08T22:30:00Z'));
is(crossed.left.map(w => w.name).join() === 'day shift',
   'crossing a boundary reports what was left', crossed.left.map(w => w.name).join());
is(crossed.entered.map(w => w.name).sort().join() === 'night shift,ramp maintenance',
   'and what was entered, including one nested inside another',
   crossed.entered.map(w => w.name).sort().join());
is(c2.playhead() === ORIGIN,
   'and still nothing moved');

/* ── 9 · the chip: the range made visible ───────────────────────────────── */
/* Under RUN ON a declared range changes nothing about how the playhead moves.
   That decision is only defensible if the range is VISIBLE — a range that
   alters nothing and says nothing is indistinguishable from one that was never
   read, which is what 3B shipped. So the caption is the behaviour here, and it
   is asserted in a real page against a real document driven through the real
   file input, not against a hand-built fixture object. */
(async () => {
  const { chromium } = require('playwright');
  const FILE = 'file://' + path.join(ROOT, 'public', 'index.html');
  const FIX  = path.join(ROOT, 'test', 'fixtures');
  const prof = JSON.parse(fs.readFileSync(path.join(ROOT, 'p20.json'), 'utf8'));

  const br = await chromium.launch();
  const page = await br.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  head('9 · a declared window is placed on the bound day');
  await page.evaluate(p2 => { SB_CFG.industry = 'mineria';
                              MOMENTUM.Data.syncModeFork();
                              MOMENTUM.Bind.attach(p2); }, prof);
  await page.waitForTimeout(1200);
  await page.setInputFiles('#dataDocDeclFile', path.join(FIX, 'data-doc-shift-roster.csv'));
  await page.waitForTimeout(1200);

  const read = await page.evaluate(() => ({
    held: !!(SB_CFG.dataDoc && SB_CFG.dataDoc.doc),
    ignored: (SB_CFG.dataDoc.doc.ignored || []).map(i => i.why),
    placed: SB_CFG.dataDoc.doc.windows.filter(w => w.startsMs != null).length,
    total: SB_CFG.dataDoc.doc.windows.length
  }));
  is(read.held, 'the roster attaches through the real input');
  /* THE SEAM. The Data Doc reader took its origin from the PROFILER's record of
     the attached profile. MOMENTUM.Bind keeps its own, set by attach(), which
     is reachable without profiling anything — a profile restored from
     persistence, or a rebind. When only Bind's was set, every clock-time window
     was refused with "no data is attached yet ... attach the data and this
     resolves". The data was attached. The reason was false and the remedy it
     named was impossible.

     Caught by looking at the chip, which read "past every declared window" at
     every instant of the day. Asserting on ok === false would have shown
     nothing: the document applied and its rows were correctly named. */
  is(read.placed === read.total,
     'all ' + read.total + ' windows resolve against a Bind-attached profile',
     read.placed + ' of ' + read.total + ' placed');
  is(read.ignored.length === 0,
     'and none is refused for a day that is in fact attached',
     read.ignored.join(' | ') || 'nothing refused');

  head('10 · the chip says which of four things is true');
  const chipAt = async (hoursFromOrigin) => page.evaluate(h => {
    const c = MOMENTUM.Bind.clock();
    MOMENTUM.Bind.seek(h === null ? c.end() : c.origin() + h * 3600000);
    MOMENTUM.Bind.paintAll();
    const e = document.getElementById('bindWindow');
    return e ? { cls: e.className, text: e.textContent } : null;
  }, hoursFromOrigin);

  const inDay = await chipAt(9);
  is(inDay && /bw-in/.test(inDay.cls) && /day shift/.test(inDay.text),
     'inside a window, it is named', inDay && inDay.text);
  const nested = await chipAt(15);
  is(nested && /ramp maintenance/.test(nested.text),
     'where two overlap, the narrower one is named', nested && nested.text);
  const gap = await chipAt(11.25);
  is(gap && /bw-gap/.test(gap.cls) && /between windows/.test(gap.text),
     'in a handover gap, the gap is named rather than the nearest shift',
     gap && gap.text);
  const past = await chipAt(null);
  is(past && /bw-past/.test(past.cls) && /still running/.test(past.text),
     'past every window it says so AND says it is still running',
     past && past.text);
  /* RUN ON, asserted at the surface as well as in the clock. */
  const stillMoving = await page.evaluate(() => {
    const c = MOMENTUM.Bind.clock();
    return c.playhead() === c.end() && !c.atEnd() === false;
  });
  is(stillMoving, 'and the playhead really is at the end of DATA, not of a range');

  head('11 · nothing declared, nothing shown');
  await page.evaluate(() => window.clearDataDocDecl());
  await page.evaluate(() => MOMENTUM.Bind.paintAll());
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() => !!document.getElementById('bindWindow'));
  is(gone === false,
     'clearing the document removes the chip — a board with no windows has none to caption');

  is(errs.length === 0, 'no page errors across the run', errs.join(' | '));
  await br.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
