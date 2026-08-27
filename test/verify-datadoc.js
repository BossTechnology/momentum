/* Release 4, phase 3B — reading a Data Doc back.
 *
 * The writer had no reader: a Data Doc went out and could not come home, and
 * the clock's `declared` tier was wired to nothing. This suite covers the
 * other half of the round trip.
 *
 * Two assertions here are grounded in artifacts rather than in reasoning:
 *
 *   the three generated templates from phase 2 are parsed AS SHIPPED. If the
 *   writer and the reader ever drift apart, this is where it shows — not in a
 *   hand-written fixture that agrees with whichever side wrote it last.
 *
 *   the ragged span is asserted against the real number. Mining's own
 *   generated document declares "24 hours" for 86,399,000 ms. Enforcing a
 *   declared span would make MOMENTUM's template fail MOMENTUM's validation on
 *   first attach, so the suite asserts that it does NOT.
 *
 * The core runs out of the browser; the control and the wiring run in it,
 * because the interesting failures in an attach button are never arithmetic. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'public', 'index.html');
const FIX = path.join(__dirname, 'fixtures');

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

/* A day of mining: 07:00:00 to 06:59:59 the next morning. 86,399,000 ms — one
   second short of twenty-four hours, because a file sampled every second ends
   one second before the next period begins. */
const ORIGIN = Date.parse('2025-08-08T07:00:00Z');
const END    = ORIGIN + 86399000;
const OPTS   = { originMs: ORIGIN, endMs: END };

const rows = (...rs) => rs.map(r => Object.assign(
  { kind:'', name:'', type:'', unit:'', mode:'', grain:'', span:'', field:'',
    context:'', correct_low:'', correct_high:'', out_low:'', out_high:'',
    persistence:'', starts:'', ends:'', notes:'' }, r));

(async () => {
  const M = loadCores();
  const D = M.DataDoc;

  /* ── 1 · the labels MOMENTUM itself writes ──────────────────────────── */
  head('1 · span and grain arrive as human labels, not as numbers');

  is(D.duration('24 hours') === 86400, 'the profiler writes "24 hours"', D.duration('24 hours'));
  is(D.duration('per second') === 1, 'and "per second" for a one-second grain', D.duration('per second'));
  is(D.duration('1 s') === 1, 'grainLabel spells the same thing "1 s"');
  is(D.duration('5 min') === 300, '"5 min" is five minutes');
  is(D.duration('90 days') === 7776000, '"90 days" is a claims cycle');
  is(D.duration('every 15 min') === 900, '"every 15 min" reads as a grain');
  is(D.duration('irregular') === null, '"irregular" is not a duration and says so');
  is(D.duration('') === null && D.duration(null) === null, 'and neither is nothing');

  head('2 · a clock time needs a day, and may cross midnight');

  is(D.instant('15:00', ORIGIN) === Date.parse('2025-08-08T15:00:00Z'),
     '15:00 lands on the origin\'s own day');
  is(D.instant('03:00', ORIGIN) === Date.parse('2025-08-09T03:00:00Z'),
     '03:00 rolls to the NEXT morning — a span from 07:00 crosses midnight',
     'the mining case');
  is(D.instant('15:00', null) === null,
     'without an origin a bare clock time cannot resolve, and does not guess');
  is(D.instant('2025-08-08T23:30Z', ORIGIN) === Date.parse('2025-08-08T23:30:00Z'),
     'a full instant needs no rollover');
  is(D.instant('99:99', ORIGIN) === null, 'and 99:99 is not a time');

  /* ── 3 · the two classes of refusal ─────────────────────────────────── */
  head('3 · a document that cannot do its job is refused whole');

  is(D.fromRows([], OPTS).ok === false, 'an empty document is refused');
  is(D.fromRows([{ name:'x' }], OPTS).reason.indexOf('kind') >= 0,
     'a table with no kind column is not a Data Doc');

  const noMode = D.fromRows(rows({ kind:'dataset', name:'x' },
                                 { kind:'field', name:'Truck' }), OPTS);
  is(!noMode.ok && /declares no mode/.test(noMode.reason),
     'a dataset row with no mode is refused — the mode decides the shape',
     noMode.reason);

  const badMode = D.fromRows(rows({ kind:'dataset', mode:'playback' }), OPTS);
  is(!badMode.ok && /not a mode/.test(badMode.reason),
     'and a mode that does not exist is named back', badMode.reason);

  const noNeeds = D.fromRows(rows({ kind:'dataset', mode:'replay' },
                                  { kind:'limit', field:'fuel', out_high:'9' }), OPTS);
  is(!noNeeds.ok && /at least one field row/.test(noNeeds.reason),
     'a replay document declaring no fields cannot play anything', noNeeds.reason);

  head('4 · an unedited blank template gets the message that says so');

  const blank = D.templateRows('replay', {
    coverage:{ rowsProfiled:864000, contextColumns:[{ name:'Shift ID' }],
               measures:[{ name:'Fuel', unit:'gal/h' }],
               span:{ label:'24 hours' }, resolution:{ label:'per second' } } },
    { blank:true });
  const asObjects = blank.slice(1).map(r => {
    const o = {}; blank[0].forEach((h, i) => o[h] = r[i]); return o; });
  const res = D.fromRows(asObjects, OPTS);
  is(!res.ok && /blank replay template/.test(res.reason),
     'the commonest beginner mistake is named, not answered with a generic complaint',
     res.reason);
  is(/download the example/i.test(res.hint || ''),
     'and the hint points at the example beside it');

  head('5 · a row this mode cannot use is refused, named and counted');

  const stray = D.fromRows(rows(
    { kind:'dataset', mode:'replay', span:'24 hours', grain:'per second' },
    { kind:'field', name:'Shift ID', type:'text' },
    { kind:'measure', name:'left over from seeded mode' },
    { kind:'sasquatch', name:'?' }
  ), OPTS);
  is(stray.ok, 'the document still applies — one stray row is not a corrupt document');
  is(stray.doc.ignored.length === 2, 'both unusable rows are counted', stray.doc.ignored.length);
  is(stray.doc.ignored[0].row === 4 && /no meaning in replay/.test(stray.doc.ignored[0].why),
     'the measure row is named by its row number and its reason',
     'row ' + stray.doc.ignored[0].row);
  is(/not a row kind/.test(stray.doc.ignored[1].why),
     'and an invented kind is refused on its own terms', stray.doc.ignored[1].why);
  is(/1 field/.test(stray.summary) && /2 rows ignored/.test(stray.summary),
     'the summary reports what applied AND what did not — naming is not demotion',
     stray.summary);

  /* ── 6 · the ragged span ────────────────────────────────────────────── */
  head('6 · the declared span is compared, never enforced');

  const ragged = D.fromRows(rows(
    { kind:'dataset', mode:'replay', span:'24 hours', grain:'per second' },
    { kind:'field', name:'Shift ID', type:'text' }
  ), OPTS);
  is(ragged.ok, 'mining\'s own document says "24 hours" for 86,399,000 ms and is ACCEPTED',
     'enforcing this would fail our own template');
  is(ragged.doc.notes.length === 0,
     'a difference inside one grain step is the same statement, so nothing is said');

  const near = D.fromRows(rows(
    { kind:'dataset', mode:'replay', span:'23 hours', grain:'per second' },
    { kind:'field', name:'Shift ID', type:'text' }
  ), OPTS);
  is(near.ok && near.doc.notes.length === 1,
     'a difference inside the tolerance is reported once, and the rows still play',
     near.doc.notes[0]);

  const wrongFile = D.fromRows(rows(
    { kind:'dataset', mode:'replay', span:'7 days', grain:'per second' },
    { kind:'field', name:'Shift ID', type:'text' }
  ), OPTS);
  is(!wrongFile.ok && /may be the wrong file/.test(wrongFile.reason),
     'seven days against a day of rows is not rounding — it is a different file',
     wrongFile.reason);

  const unreadableSpan = D.fromRows(rows(
    { kind:'dataset', mode:'replay', span:'a while', grain:'per second' },
    { kind:'field', name:'Shift ID', type:'text' }
  ), OPTS);
  is(unreadableSpan.ok && /could not be read/.test(unreadableSpan.doc.notes[0] || ''),
     'an unreadable span is reported and the profiled one is used — refuse the cell, not the file');

  /* ── 7 · windows and the opening position ───────────────────────────── */
  head('7 · windows resolve to instants the clock can use');

  const withWindows = D.fromRows(rows(
    { kind:'dataset', mode:'replay', span:'24 hours', grain:'per second', starts:'shift change' },
    { kind:'calendar', name:'operating hours', starts:'07:00', ends:'19:00' },
    { kind:'field', name:'Shift ID', type:'text' },
    { kind:'window', name:'shift change', starts:'15:00', ends:'18:00' },
    { kind:'window', name:'night shift', starts:'23:00' },
    { kind:'window', name:'broken', starts:'not a time' }
  ), OPTS);
  is(withWindows.ok, 'the document applies');
  is(withWindows.doc.windows.length === 3, 'every named window is carried',
     withWindows.doc.windows.length);
  is(withWindows.doc.windows[0].startsMs === Date.parse('2025-08-08T15:00:00Z'),
     'a window start becomes an absolute instant');
  is(withWindows.doc.windows[0].endsMs === Date.parse('2025-08-08T18:00:00Z'),
     'and its END is read and stored, though phase 3B does not use it',
     'so documents authored now are complete when 3C arrives');
  is(withWindows.doc.ignored.some(g => /not a time/.test(g.why)),
     'a window whose start is unreadable is named rather than dropped');

  /* Found by looking at a screenshot, not by a test. With nothing attached the
     refusal was right and its REASON was wrong: "15:00 is not a time" sends a
     person to rewrite a cell that was already correct. */
  const noOrigin = D.fromRows(rows(
    { kind:'dataset', mode:'replay', starts:'shift change' },
    { kind:'field', name:'Shift ID', type:'text' },
    { kind:'window', name:'shift change', starts:'15:00', ends:'18:00' }
  ), {});
  is(noOrigin.ok, 'a Data Doc attached before the data still applies');
  is(/no day to place it on/.test(noOrigin.doc.ignored[0].why),
     'and an unresolvable clock time says WHY it is unresolvable, not that it is invalid',
     noOrigin.doc.ignored[0].why);
  is(!/is not a time/.test(noOrigin.doc.ignored[0].why),
     'a good time is never called a bad one');
  is(withWindows.doc.opening === 'shift change',
     'the opening position rides in the dataset row\'s starts cell',
     withWindows.doc.opening);

  head('8 · the clock reads what the reader produced — the tier is fed');

  const clock = M.Clock.create({ originMs: ORIGIN, endMs: END, grainSec: 1,
                                 calendar: true, windows: withWindows.doc.windows });
  const byName = clock.resolve({ declared: withWindows.doc.opening });
  is(byName.source === 'declared', 'tier 2 resolves from the Data Doc', byName.source);
  is(byName.how === 'window' && byName.window === 'shift change',
     'by the name a person wrote, not by a fraction they computed');
  is(Math.abs(byName.fraction - (8 * 3600000) / 86399000) < 1e-6,
     '15:00 on a span opening at 07:00 is eight hours in',
     (byName.fraction * 100).toFixed(2) + '%');
  is(/15:00$/.test(clock.label(byName.fraction)),
     'and the caption a person reads ends at 15:00, not 14:59',
     clock.label(byName.fraction));

  const sess = clock.resolve({ session:'75%', declared: withWindows.doc.opening });
  is(sess.source === 'session',
     'Settings still outranks the document — precedence is unchanged by 3B');

  const refused = clock.resolve({ declared:'a moment ago', config:'1/3' });
  is(refused.source === 'config' && refused.refused.length === 1,
     'an unreadable declared opening is refused AND reported, and the tier below applies',
     refused.refused[0].why);

  /* ── 9 · the three shipped templates, parsed as generated ───────────── */
  head('9 · the phase 2 templates round-trip through the reader');

  const readBook = async (file) => {
    const buf = fs.readFileSync(path.join(FIX, file));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return M.OfficeDoc.readRows(ab, file);
  };

  const rep = await readBook('data-doc-replay-template.xlsx');
  is(rep.ok, 'the shipped replay template is readable as rows', rep.ok ? rep.rows.length + ' rows' : rep.reason);
  const repDoc = D.fromRows(rep.rows, OPTS);
  is(repDoc.ok, 'and parses — the writer and the reader agree on the grammar',
     repDoc.ok ? repDoc.summary : repDoc.reason);
  is(repDoc.ok && repDoc.doc.mode === 'replay', 'its mode comes from its own dataset row');
  is(repDoc.ok && repDoc.doc.fields.length === 4,
     'its four profiled columns arrive as fields',
     repDoc.ok ? repDoc.doc.fields.map(f => f.name).join(', ') : '');
  is(repDoc.ok && repDoc.doc.span && repDoc.doc.span.ms === 86400000,
     'its declared span reads as 24 hours');
  is(repDoc.ok && repDoc.doc.grain && repDoc.doc.grain.seconds === 1,
     'and its declared grain as one second, from the words "per second"');
  is(repDoc.ok && repDoc.doc.windows.length === 0 && repDoc.doc.limits.length === 0,
     'its empty window and limit scaffolds are scaffolding, not malformed rows');

  for (const [file, mode] of [['data-doc-seeded-template.xlsx', 'seeded'],
                              ['data-doc-free-template.xlsx', 'free']]) {
    const r = await readBook(file);
    const doc = r.ok ? D.fromRows(r.rows, OPTS) : r;
    /* Both were generated with nothing attached, so both are blanks in every
       sense that matters — and both are refused with the message that says so
       rather than a general complaint. That is the round trip working. */
    is(!doc.ok && /blank .* template/.test(doc.reason),
       'the ' + mode + ' template was generated unfed, and is refused as a blank',
       doc.reason);
  }

  head('10 · Example and Blank are one document in two renderings');

  const prof = { coverage:{ rowsProfiled:864000,
    contextColumns:[{ name:'Shift ID' }],
    measures:[{ name:'Fuel Consumption Rate-Engine', unit:'gal/h' }],
    span:{ label:'24 hours' }, resolution:{ label:'per second' } } };
  const ex = D.templateRows('replay', prof);
  const bl = D.templateRows('replay', prof, { blank:true });
  is(ex.length === bl.length, 'the blank has every row the example has', ex.length + ' rows');
  is(ex.map(r => r[0]).join() === bl.map(r => r[0]).join(),
     'in the same order, of the same kinds — the row COUNT is the point of a blank');
  is(bl[1][4] === 'replay', 'the mode survives blanking — it is structure, not content');
  is(bl.slice(1).every(r => r[1] === ''), 'every authored name is emptied');
  is(ex.slice(1).some(r => r[1] !== ''), 'and the example still carries the real columns');
  is(bl.slice(1).every((r, i) => r[2] === ex[i + 1][2]),
     'declared types survive: what a column IS does not change when its name is cleared');
  is(/BLANK flavour/.test(D.guide('replay', prof, true).join('\n')),
     'the guidance says which flavour this is');
  is(/dataset row/.test(D.guide('replay', prof, true).join('\n')),
     'and where to write the opening position');

  /* ── 11 · the control, in the browser ───────────────────────────────── */
  head('11 · the control');

  const br = await chromium.launch();
  const page = await br.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(FILE, { waitUntil:'load' });
  await page.waitForTimeout(1500);

  const present = await page.evaluate(() => {
    const fork = document.getElementById('modeFork');
    const att = document.getElementById('dataDocAttachBtn');
    return { inFork: !!(fork && att && fork.contains(att)),
             input: !!document.getElementById('dataDocDeclFile'),
             blank: !!document.getElementById('dataDocBlankBtn'),
             rawAttach: !!document.getElementById('dataAttachBtn') };
  });
  is(present.inFork, 'Attach Data Doc sits inside the mode fork, beside its download');
  is(present.input, 'and has a real file input behind it');
  is(present.rawAttach, 'the raw-data attach is untouched — they are different files');

  await page.evaluate(() => { SB_CFG.industry = 'mineria'; MOMENTUM.Data.syncModeFork(); });
  const labels = await page.evaluate(() => ({
    ex: document.getElementById('dataDocBtn').textContent.trim(),
    bl: document.getElementById('dataDocBlankBtn').textContent.trim()
  }));
  is(/free/.test(labels.ex) && /free/.test(labels.bl),
     'both downloads name the mode they would give', labels.ex + '  |  ' + labels.bl);

  /* Through the real input, the way a person does it. */
  await page.setInputFiles('#dataDocDeclFile', path.join(FIX, 'data-doc-replay-template.xlsx'));
  await page.waitForTimeout(900);
  const attached = await page.evaluate(() => ({
    held: !!(SB_CFG.dataDoc && SB_CFG.dataDoc.doc),
    status: document.getElementById('dataDocStatus').textContent
  }));
  is(attached.held, 'a real .xlsx attaches through the real input', attached.status.slice(0, 90));

  await page.evaluate(() => window.clearDataDocDecl());
  const cleared = await page.evaluate(() => ({
    held: !!(SB_CFG.dataDoc && SB_CFG.dataDoc.doc),
    chip: document.getElementById('dataDocChip').style.display
  }));
  is(!cleared.held && cleared.chip === 'none',
     'and clearing it puts the tier back to declaring nothing');

  is(errs.length === 0, 'no page errors across the run', errs.slice(0, 3).join(' | '));
  await br.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
