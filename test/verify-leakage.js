/* ═══════════════════════════════════════════════════════════════════════════
   verify-leakage — mining may not appear where mining was not chosen.

   The rule this enforces: a default keyed to a chosen industry is fine; a
   default that applies regardless of industry is not. Mining content is
   welcome the moment mining is selected, and must be absent otherwise.

   The hard case is not an untouched board — identity45 already holds that
   byte-for-byte. It is a board where a MINING DATA PROFILE IS BOUND and a
   different industry is selected. That is the configuration where a demo
   would embarrass us: real haul-cycle telemetry attached, retail on screen.
   Nothing may bind that names a haul truck, a shift, a ramp or a gal/ton.

   Answers that cannot bind must land in `unresolved` and report by name.
   Reporting a miss is correct; inventing a value is the failure this catches.
   ═══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.resolve(ROOT, 'momentum-Simulation_68.html');
const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'p20.json'), 'utf8'));

/* Vocabulary that exists only because of the mining workbook. `gal/ton` is the
   locked ratio's unit; HT-nnn are haul trucks; OP-nn are operators; the Spanish
   result names are the mining template's. None may reach another industry. */
const MINING = [
  /Combustible por Tonelada/i, /Toneladas Movidas/i, /Horas en Ralent/i,
  /gal\/ton/i, /\bHT-0\d\d\b/, /\bOP-\d\d\b/, /Rampa B-11/i,
  /Restricci[oó]n de Filtro/i, /Saturaci[oó]n de filtro/i, /turno-noche/i,
];

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

function hits(text) {
  return MINING.filter(re => re.test(text)).map(re => String(re));
}

async function board(page, industry, bindProfile) {
  return page.evaluate(async (a) => {
    const [ind, prof] = a;
    if (MOMENTUM.Bind && MOMENTUM.Bind.active()) MOMENTUM.Bind.detach();
    document.getElementById('langSelect').value = 'en';
    const sel = document.getElementById('industrySelect');
    sel.value = ind; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const th = document.getElementById('journeyThemeSelect');
    if (!th.value) for (const o of th.options) { if (o.value) { th.value = o.value; break; } }
    if (prof) MOMENTUM.Bind.attach(prof);
    await new Promise(r => setTimeout(r, 300));
    applyConfig();
    await new Promise(r => setTimeout(r, 2600));
    return {
      kbrs: KBRS.map(k => ({ name: k.name, unit: k.unit || (k.goal && k.goal.unit) || '' })),
      answers: KBRS.reduce((s, k) => s.concat((k.answers || []).map(t => t.name)), []),
      risk: KBRS.reduce((s, k) => s.concat((k.riskTouchpoints || []).map(t => t.name)), []),
      theme: document.getElementById('journeyThemeSelect').value,
      surface: document.body.innerText
    };
  }, [industry, bindProfile ? profile : null]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/403|Failed to load resource|net::ERR/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  console.log('\nverify-leakage · mining stays where mining was chosen\n');

  console.log('1 · retail, nothing bound');
  let b = await board(page, 'retail', false);
  ok('no mining vocabulary on the board', hits(b.surface).length === 0, hits(b.surface).join(', '));
  ok('the results are retail results',
     b.kbrs.every(k => !MINING.some(re => re.test(k.name))), JSON.stringify(b.kbrs.map(k => k.name)));

  console.log('\n2 · retail, with the MINING profile bound');
  b = await board(page, 'retail', true);
  ok('no mining vocabulary on the board', hits(b.surface).length === 0, hits(b.surface).join(', '));
  ok('no mining result names', b.kbrs.every(k => !MINING.some(re => re.test(k.name))),
     JSON.stringify(b.kbrs.map(k => k.name)));
  ok('no mining answers', b.answers.every(n => !MINING.some(re => re.test(n))),
     JSON.stringify(b.answers.slice(0, 6)));
  ok('no mining risk touchpoints', b.risk.every(n => !MINING.some(re => re.test(n))),
     JSON.stringify(b.risk));
  ok('no haul-truck or operator identifiers leak into a value',
     !/\bHT-0\d\d\b|\bOP-\d\d\b/.test(b.surface));

  console.log('\n3 · healthcare, with the MINING profile bound');
  b = await board(page, 'healthcare', true);
  ok('no mining vocabulary on the board', hits(b.surface).length === 0, hits(b.surface).join(', '));
  ok('the results are healthcare results',
     b.kbrs.every(k => !MINING.some(re => re.test(k.name))), JSON.stringify(b.kbrs.map(k => k.name)));

  /* Was ecommerce; ecommerce now bundles a document of its own. `tech` is the
     control: an industry with nothing bundled must stay empty, and must not
     inherit from whichever industry was applied before it. */
  console.log('\n4 · tech — an industry with NO bundled document, profile bound');
  b = await board(page, 'tech', true);
  ok('no mining vocabulary on the board', hits(b.surface).length === 0, hits(b.surface).join(', '));

  /* Ecommerce bundles no document, so on a fresh page it correctly gets none.
     Reached by SWITCHING industry it inherits whatever the previous industry
     declared, because applyConfig() adds without clearing. That is the demo
     failure this section exists to catch: retail's tills on an ecommerce
     board. It is not mining-specific — it is every industry leaking into the
     next one within a single session. */
  ok('switching industry does not carry the previous one\u2019s touchpoints',
     b.risk.length === 0,
     b.risk.length + ' inherited: ' + JSON.stringify(b.risk).slice(0, 110));

  /* Seven industries now bundle a document. Seven is seven more chances for one
     industry's content to appear on another's board, so every one is checked
     against the mining vocabulary AND asserted to bring its own routing. */
  console.log('\n4b · every bundled industry arrives populated and routed, and none of it is mining');
  for(const ind of ['retail', 'healthcare', 'ecommerce', 'logistics', 'banking', 'hospitality']){
    const x = await board(page, ind, true);
    const counts = await page.evaluate(() => {
      const tps = KBRS.reduce((a, k) => a.concat(k.riskTouchpoints || []), []);
      return {
        tps: tps.length,
        chans: (MOMENTUM.Channels.list() || []).length,
        routed: KBRS.reduce((a, k) => a + ((k.riskConditions || [])
          .filter(c => (c.responses || []).some(r => (r.channels || []).length)).length), 0),
        rules: tps.reduce((a, t) => a + (((t.anomRules && t.anomRules.known) || []).length), 0)
      };
    });
    ok(ind + ' brings touchpoints, channels, routed conditions and rules',
       counts.tps > 0 && counts.chans > 0 && counts.routed > 0 && counts.rules > 0,
       JSON.stringify(counts));
    ok(ind + ' carries no mining vocabulary', hits(x.surface).length === 0,
       hits(x.surface).join(', '));
  }

  console.log('\n5 · mining — the same content IS present when mining is chosen');
  b = await board(page, 'mining', true);
  ok('the mining results are on the board',
     b.kbrs.some(k => /Combustible por Tonelada/i.test(k.name)),
     JSON.stringify(b.kbrs.map(k => k.name)));
  ok('the mining template is selected', b.theme === 'energy-haul-mining', b.theme);

  console.log('\n6 · the page');
  ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
