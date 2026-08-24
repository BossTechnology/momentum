/* Release 4, phase 2 — the document flow completed.
 *
 * Two items: the Journey Doc (download, attach, build) and the mode fork
 * (replay / seeded / free, chosen before download, picking the template).
 *
 * The writer is asserted against the READER throughout, never against a
 * recorded byte string. A fixture would pass while both halves drifted
 * together; a round trip cannot. The end-to-end case drives a real .docx
 * through the real file input, because the interesting failures in this area
 * are in the wiring rather than in either core.                             */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'momentum-Simulation_68.html');
const TMP  = path.join(ROOT, '.docflow-tmp');

let pass = 0, fail = 0;
const ok  = (m, d) => { pass++; console.log('  ok   ' + m + (d ? '  · ' + d : '')); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '  · ' + d : '')); };
const is  = (c, m, d) => c ? ok(m, d) : bad(m, d);
const head = t => console.log('\n' + t);

/* ── the cores, out of the browser ──────────────────────────────────────── */

function loadCores(){
  const ctx = { console, TextEncoder, TextDecoder, Blob, Response,
                DecompressionStream, URL, setTimeout };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  ['_configdoc-core.js', '_officedoc-core.js', '_docwrite-core.js',
   '_journeydoc-core.js', '_datadoc-core.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8'), ctx, { filename:f });
  });
  return ctx.MOMENTUM;
}
const M = loadCores();

const HEAD = M.JourneyDoc.HEAD;
const row = o => HEAD.map(h => o[h] == null ? '' : String(o[h]));

/* A journey that exercises every kind and every reference. */
const GOOD = [
  HEAD.slice(),
  row({ kind:'result', name:'Combustible por Tonelada', unit:'gal/ton', direction:'down' }),
  row({ kind:'result', name:'Toneladas Movidas', unit:'ton', direction:'up' }),
  row({ kind:'stage', name:'Carga',    order:'1', result:'Combustible por Tonelada' }),
  row({ kind:'stage', name:'Acarreo',  order:'2', result:'Combustible por Tonelada' }),
  row({ kind:'stage', name:'Descarga', order:'3', result:'Toneladas Movidas' }),
  row({ kind:'substage', name:'Cola de pala', parent:'Carga' }),
  row({ kind:'touchpoint', name:'Espera de carga', parent:'Carga',
        observes:'how long a truck waits to be loaded' }),
  row({ kind:'touchpoint', name:'Ralent\u00ed en cola', parent:'Cola de pala',
        observes:'time spent idling before the shovel' })
];
const objs = rows => M.OfficeDoc.toObjects(rows);

head('1 \u00b7 the writer, read back by the reader');
(async () => {
  const dx = M.DocWrite.docxTable(GOOD, { title:'t', notes:['guidance, not content'] });
  const back = await M.OfficeDoc.readDocx(new Uint8Array(dx));
  is(back.ok, 'a written .docx opens');
  is(JSON.stringify(back.rows) === JSON.stringify(GOOD),
     'and every cell survives the round trip', back.rows.length + ' rows');

  const xl = M.DocWrite.xlsxSheet(GOOD, { sheetName:'Data Doc' });
  const bx = await M.OfficeDoc.readXlsx(new Uint8Array(xl));
  is(bx.ok, 'a written .xlsx opens');
  is(objs(bx.rows).length === GOOD.length - 1 &&
     objs(bx.rows)[6].observes === 'how long a truck waits to be loaded',
     'and sparse cells do not shift the columns after them');

  /* The characters that break a hand-rolled XML writer. */
  const nasty = [['kind','name'], ['stage', 'A & B <c> "d" \u00e1\u00f1']];
  const nb = await M.OfficeDoc.readDocx(new Uint8Array(M.DocWrite.docxTable(nasty)));
  is(nb.ok && nb.rows[1][1] === 'A & B <c> "d" \u00e1\u00f1',
     'ampersands, angle brackets, quotes and accents survive',
     nb.ok ? nb.rows[1][1] : 'unreadable');

  const empty = M.DocWrite.docxTable([['kind'], ['stage']]);
  is(M.DocWrite.crc32(M.DocWrite.bytes('')) === 0,
     'crc32 of nothing is zero \u2014 the table is right way round');
  is(empty.length > 0 && empty[0] === 0x50 && empty[1] === 0x4b,
     'the archive starts with a local file header');

  head('2 \u00b7 the journey doc \u2014 what it accepts');
  const g = M.JourneyDoc.fromRows(objs(GOOD));
  is(g.ok, 'the well-formed journey parses', g.ok ? '' : g.reason);
  is(g.ok && g.doc.counts.results === 2 && g.doc.counts.stages === 3 &&
     g.doc.counts.subs === 1 && g.doc.counts.tps === 2,
     'and every kind is counted', g.ok ? M.JourneyDoc.describe(g.doc) : '');
  is(g.ok && g.doc.stages[0].name === 'Carga' && g.doc.stages[2].name === 'Descarga',
     'order sets the spine');

  /* Written out and read back is the same journey — the round trip the
     download/attach loop actually asks for. */
  const viaDocx = await M.OfficeDoc.readDocx(
    new Uint8Array(M.DocWrite.docxTable(GOOD)));
  const g2 = M.JourneyDoc.fromRows(objs(viaDocx.rows));
  is(g2.ok && JSON.stringify(g2.doc) === JSON.stringify(g.doc),
     'a journey written to .docx and read back is the same journey');

  head('3 \u00b7 the journey doc \u2014 what it refuses');
  const refuse = (mut, label) => {
    const r = M.JourneyDoc.fromRows(objs(mut));
    is(!r.ok, label, r.ok ? 'ACCEPTED' : r.reason);
  };
  const clone = () => GOOD.map(r => r.slice());
  let m;
  m = clone(); m[3][0] = 'phase';            refuse(m, 'an unknown row kind');
  m = clone(); m[3][1] = '';                 refuse(m, 'a row with no name');
  m = clone(); m[4][1] = 'Carga';            refuse(m, 'two stages with the same name');
  m = clone(); m[1][6] = 'sideways';         refuse(m, 'a direction that is neither up nor down');
  m = clone(); m[3][4] = 'Margen';           refuse(m, 'a stage feeding a result nobody declared');
  m = clone(); m[6][2] = 'Molienda';         refuse(m, 'a substage whose parent is not a stage');
  m = clone(); m[7][2] = '';                 refuse(m, 'a touchpoint with no parent');
  m = clone(); m[8][2] = 'Chancado';         refuse(m, 'a touchpoint naming a parent that does not exist');
  refuse([HEAD.slice(), row({ kind:'result', name:'X', direction:'up' })],
         'a document with no stages at all');

  const colish = clone();
  colish[7][7] = 'Truck Payload-Communication Gateway #2';
  const cr = M.JourneyDoc.fromRows(objs(colish));
  is(cr.ok && cr.doc.columnish.length === 1,
     'a touchpoint observing a COLUMN loads, and is reported',
     cr.ok ? cr.doc.columnish.join(',') : cr.reason);

  head('4 \u00b7 the journey doc \u2014 placed on the board');
  const sized = M.JourneyDoc.toSized(g.doc, { maxPrimes:8 });
  is(sized.primes.length === 3 && sized.primes[0].name === 'Carga',
     'stages become prime hexagons in declared order');
  is(Object.keys(sized.subs).length === 1 && sized.subs[0].name === 'Cola de pala',
     'a substage lands in the valley after its parent');
  is(sized.primes[0].tps.length === 1 && sized.subs[0].tps.length === 1,
     'touchpoints follow their own parent, stage or substage');
  is(sized.unplaced.length === 0, 'and nothing is left over');

  const lastSub = clone();
  lastSub[6][2] = 'Descarga';                       /* parent is the last stage */
  const ls = M.JourneyDoc.toSized(M.JourneyDoc.fromRows(objs(lastSub)).doc, { maxPrimes:8 });
  is(ls.unplaced.length === 1 && /last stage/.test(ls.unplaced[0]),
     'a substage on the LAST stage is reported, not dropped', ls.unplaced[0]);

  const twoSubs = clone();
  twoSubs.push(row({ kind:'substage', name:'Segunda cola', parent:'Carga' }));
  const ts = M.JourneyDoc.toSized(M.JourneyDoc.fromRows(objs(twoSubs)).doc, { maxPrimes:8 });
  is(Object.keys(ts.subs).length === 1 && ts.unplaced.length === 1,
     'two substages competing for one valley \u2014 one placed, one reported',
     ts.unplaced[0]);

  const narrow = M.JourneyDoc.toSized(g.doc, { maxPrimes:2 });
  is(narrow.primes.length === 2 && narrow.unplaced.length >= 1,
     'a journey longer than the board reports the overflow rather than trimming in silence',
     narrow.unplaced[0]);

  const kb = M.JourneyDoc.resultsAsKbrs(g.doc);
  is(kb.length === 2 && kb[0].direction === 'down' && kb[0].unit === 'gal/ton',
     'declared results become KBRs with their declared unit and direction');
  is(M.JourneyDoc.resultsAsKbrs({ results:[] }) === null,
     'a journey declaring no results declares none \u2014 it does not invent three');

  head('5 \u00b7 the mode fork');
  const D = M.DataDoc;
  const noData = D.modes(null);
  const replay = noData.filter(x => x.mode === 'replay')[0];
  is(replay && !replay.available,
     'with nothing attached, replay is UNAVAILABLE');
  is(replay && /attach data/i.test(replay.why),
     'and the reason says what would change it', replay && replay.why);
  is(noData.filter(x => x.mode !== 'replay').every(x => x.available),
     'seeded and free need nothing attached');

  const withRows = { coverage:{ rowsProfiled: 864000,
    measures:[{ name:'Fuel Consumption Rate-Engine', unit:'gal/h' }],
    contextColumns:[{ name:'Shift ID' }],
    span:{ label:'24 hours' }, resolution:{ label:'per second' },
    cycles:{ strongest:{ name:'Truck Payload' } } } };
  is(D.availability('replay', withRows).ok,
     'attach rows and replay becomes available');

  const kindsOf = (mode, prof) => {
    const r = D.templateRows(mode, prof || null);
    return r.slice(1).map(x => x[0]).filter(Boolean);
  };
  const kR = kindsOf('replay', withRows), kS = kindsOf('seeded', withRows),
        kF = kindsOf('free', null);
  is(kR.indexOf('field') >= 0 && kR.indexOf('limit') >= 0 && kR.indexOf('window') >= 0,
     'the replay document is made of fields, limits and windows');
  is(kR.indexOf('measure') === -1,
     'and carries no measures \u2014 there is nothing to expand, only rows to play');
  is(kS.indexOf('measure') >= 0 && kS.indexOf('shape') >= 0 && kS.indexOf('field') === -1,
     'the seeded document is made of measures and shapes, not fields');
  is(kF.indexOf('field') === -1 && kF.indexOf('limit') === -1 && kF.indexOf('window') === -1,
     'the free document describes no file, so it declares no fields, limits or windows');
  is(kR.length && kS.length && kF.length &&
     JSON.stringify(kR) !== JSON.stringify(kS) &&
     JSON.stringify(kS) !== JSON.stringify(kF),
     'three modes, three genuinely different documents');

  const filled = D.templateRows('replay', withRows);
  is(filled.some(r => r[0] === 'field' && r[1] === 'Fuel Consumption Rate-Engine'),
     'a replay document pre-fills the REAL column names from the profile');
  is(D.templateRows('replay', null).filter(r => r[0] === 'field')
      .every(r => !r[1]),
     'and with no profile it leaves them blank rather than guessing');
  const ds = filled.filter(r => r[0] === 'dataset')[0];
  is(ds && ds[HEAD.indexOf('mode') >= 0 ? D.HEAD.indexOf('mode') : 4] === 'replay',
     'the dataset row declares the mode it was generated for');

  /* GUIDANCE MUST BE INVISIBLE TO THE READER. `#` opens a comment in a .csv,
     but a spreadsheet has no such convention — guidance written into sheet 1
     comes back as rows whose kind is "# Rows may be added...", which is the
     phantom-declaration bug the Config Doc template already had. The test is
     the round trip, not the convention: write the document the way the app
     writes it, read it with the reader the app reads it with, and see whether
     anything but declarations comes back. */
  const guide = D.guide('free', null);
  const book = M.DocWrite.xlsxBook([
    { name:'Data Doc', rows: D.templateRows('free', null) },
    { name:'Guidance', rows: guide.map(g => [g]) }
  ]);
  const readBack = M.OfficeDoc.toObjects((await M.OfficeDoc.readXlsx(new Uint8Array(book))).rows);
  is(readBack.length > 0 && readBack.every(r => D.KINDS.indexOf(String(r.kind).toLowerCase()) >= 0),
     'a written Data Doc reads back as declarations and nothing else',
     readBack.length + ' rows, kinds: ' + [...new Set(readBack.map(r => r.kind))].join('/'));
  is(guide.length > 4 && !readBack.some(r => /^#|Rows may be added/.test(String(r.kind))),
     'its guidance is on a sheet the reader never opens',
     guide.length + ' lines of guidance, 0 read back');

  head('6 \u00b7 end to end, in the browser');
  fs.mkdirSync(TMP, { recursive: true });
  const docxPath = path.join(TMP, 'journey.docx');
  fs.writeFileSync(docxPath, Buffer.from(M.DocWrite.docxTable(GOOD)));
  const prosePath = path.join(TMP, 'notes.txt');
  fs.writeFileSync(prosePath, 'We haul ore from the pit to the crusher all day.');
  const brokenPath = path.join(TMP, 'broken.docx');
  const brokenRows = GOOD.map(r => r.slice()); brokenRows[3][0] = 'phase';
  fs.writeFileSync(brokenPath, Buffer.from(M.DocWrite.docxTable(brokenRows)));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1200);

  const openWith = async industry => {
    await page.evaluate(ind => {
      openSidebar();
      document.getElementById('industrySelect').value = ind;
      onIndustryChange();
    }, industry);
    await page.waitForTimeout(250);
  };
  await openWith('mining');

  const fork = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#modeForkRow .mode-chip')];
    return { n: chips.length,
             labels: chips.map(c => c.textContent.trim()),
             disabled: chips.filter(c => c.disabled).map(c => c.dataset.mode),
             on: chips.filter(c => c.classList.contains('on')).map(c => c.dataset.mode),
             why: document.getElementById('modeForkWhy').textContent };
  });
  is(fork.n === 3, 'the fork renders three modes', fork.labels.join(' / '));
  is(fork.disabled.length === 1 && fork.disabled[0] === 'replay',
     'replay is the one that is unavailable with no data attached');
  is(fork.on.length === 1 && fork.on[0] === 'free',
     'free is selected, and nothing was chosen on the person\u2019s behalf');
  is(/attach data/i.test(fork.why), 'the reason is on screen, not in a tooltip only');

  const clicked = await page.evaluate(() => {
    document.querySelector('.mode-chip[data-mode="replay"]').click();
    return SB_CFG.dataMode;
  });
  is(clicked === 'free', 'clicking an unavailable mode does not select it', clicked);

  const seeded = await page.evaluate(() => {
    document.querySelector('.mode-chip[data-mode="seeded"]').click();
    return { mode: SB_CFG.dataMode,
             btn: document.getElementById('dataDocBtn').textContent };
  });
  is(seeded.mode === 'seeded' && /seeded/.test(seeded.btn),
     'an available mode selects, and the download says which document it will give',
     seeded.btn.trim());

  /* The journey document, through the real input. */
  await page.setInputFiles('#contextDocFile', docxPath);
  await page.waitForTimeout(700);
  const attached = await page.evaluate(() => ({
    held: !!(SB_CFG.journeyDoc && SB_CFG.journeyDoc.doc),
    ctx: !!SB_CFG.contextDoc,
    status: document.getElementById('docAttachStatus').textContent,
    themeDisabled: document.getElementById('journeyThemeSelect').disabled,
    preview: document.getElementById('journeyPreview').textContent
  }));
  is(attached.held, 'a .docx table attaches as a JOURNEY, not as context');
  is(!attached.ctx, 'and does not also sit in the context slot');
  is(/3 stages/.test(attached.status), 'the status line counts what it declared',
     attached.status.slice(0, 90));
  is(attached.themeDisabled,
     'the template selector stands down while a document is held');
  is(/Carga/.test(attached.preview) && /Descarga/.test(attached.preview),
     'and the preview shows the document\u2019s own stages');

  const built = await page.evaluate(async () => {
    applyConfig();
    await new Promise(r => setTimeout(r, 1600));
    const named = journeyStages.filter(s => s.name);
    return { named: named.map(s => s.name),
             active: journeyStages.filter(s => s.state !== 'inactive').length,
             kbrs: KBRS.map(k => ({ name:k.name, unit:k.unit, dir:k.direction })) };
  });
  is(built.named.includes('Carga') && built.named.includes('Acarreo') &&
     built.named.includes('Descarga'),
     'Apply builds the document\u2019s stages onto the board', built.named.join(' \u2192 '));
  is(built.named.includes('Cola de pala'), 'including its substage');
  is(built.kbrs[0].name === 'Combustible por Tonelada' &&
     built.kbrs[0].unit === 'gal/ton' && built.kbrs[0].dir === 'down',
     'and the document\u2019s results, with their declared unit and direction');
  is(built.kbrs[2].name === '',
     'a third result nobody declared stays undeclared \u2014 no invented trio');

  /* Prose is still context. This is the path that already worked and the one
     most likely to be broken by making the slot cleverer. */
  await page.evaluate(() => clearContextDoc());
  await page.setInputFiles('#contextDocFile', prosePath);
  await page.waitForTimeout(500);
  const prose = await page.evaluate(() => ({
    held: !!(SB_CFG.journeyDoc && SB_CFG.journeyDoc.doc),
    ctx: !!(SB_CFG.contextDoc && SB_CFG.contextDoc.text),
    themeDisabled: document.getElementById('journeyThemeSelect').disabled,
    status: document.getElementById('docAttachStatus').textContent
  }));
  is(!prose.held && prose.ctx, 'prose still attaches as context, as it always did');
  is(!prose.themeDisabled, 'and the template selector comes back');
  is(/context/i.test(prose.status), 'the status says which of the two it became',
     prose.status.slice(0, 70));

  /* A document that announced itself with a kind column and then failed is
     REFUSED, never quietly demoted to context. */
  await page.evaluate(() => clearContextDoc());
  await page.setInputFiles('#contextDocFile', brokenPath);
  await page.waitForTimeout(500);
  const broke = await page.evaluate(() => ({
    held: !!(SB_CFG.journeyDoc && SB_CFG.journeyDoc.doc),
    ctx: !!(SB_CFG.contextDoc && SB_CFG.contextDoc.text),
    status: document.getElementById('docAttachStatus').textContent
  }));
  is(!broke.held && !broke.ctx,
     'a malformed journey is refused outright, not demoted to context');
  is(/Not applied/.test(broke.status) && /unknown kind/.test(broke.status),
     'and the refusal names the row and the reason', broke.status.slice(0, 90));

  await page.evaluate(() => clearContextDoc());
  const cleared = await page.evaluate(() => ({
    held: !!SB_CFG.journeyDoc,
    themeDisabled: document.getElementById('journeyThemeSelect').disabled
  }));
  is(!cleared.held && !cleared.themeDisabled,
     'removing the document puts the template selector back in charge');

  head('7 \u00b7 optionality \u2014 the fork changes nothing by itself');
  const page2 = await browser.newPage();
  page2.on('pageerror', e => errors.push(e.message));
  await page2.goto(FILE);
  await page2.waitForTimeout(1200);
  const inert = await page2.evaluate(() => {
    openSidebar();
    document.getElementById('industrySelect').value = 'retail';
    onIndustryChange();
    document.querySelector('.mode-chip[data-mode="seeded"]').click();
    return { named: journeyStages.filter(s => s.name).length,
             kbrs: KBRS.filter(k => k.name).length,
             tps: journeyStages.reduce((n, s) => n + (s.touchpoints || []).length, 0) };
  });
  is(inert.named === 0 && inert.kbrs === 0 && inert.tps === 0,
     'choosing an industry and a mode declares nothing \u2014 the board is still empty',
     JSON.stringify(inert));
  await page2.close();

  head('8 \u00b7 the page');
  is(errors.length === 0, 'no page errors across the whole run',
     errors.slice(0, 3).join(' | '));

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
