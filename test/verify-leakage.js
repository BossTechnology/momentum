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
    /* BLANK SLATE: Apply builds the journey and the declared results and
       stops. The channels, indicators, conditions and rules this suite is
       about are DECLARED, and they arrive with the document — the same call
       the attach flow makes. Applying it here is what the industry used to do
       silently on the reader's behalf. */
    applyExampleConfig(ind);
    await new Promise(r => setTimeout(r, 500));
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

  /* This check used an industry that bundled nothing as its control: reach it
     by switching and any touchpoint on the board had to have leaked from the
     previous one. The control moved from ecommerce to tech as each got
     populated, and now every industry bundles a document, so there is no empty
     one left to borrow.

     The invariant never depended on the control being empty. What it forbids is
     one industry's touchpoints surviving onto the next board — retail's tills
     on an ecommerce board — because applyConfig() adds without clearing.
     Comparing the two sets says exactly that, and says it for any pair rather
     than only when one side happens to be blank. */
  const previas = b.risk.slice();          // healthcare's, from section 3
  console.log('\n4 \u00b7 tech \u2014 switching industry must not carry the previous board');
  b = await board(page, 'tech', true);
  ok('no mining vocabulary on the board', hits(b.surface).length === 0, hits(b.surface).join(', '));

  const heredadas = b.risk.filter(n => previas.includes(n));
  ok('switching industry does not carry the previous one\u2019s touchpoints',
     heredadas.length === 0,
     heredadas.length + ' inherited from healthcare: ' + JSON.stringify(heredadas).slice(0, 110));

  /* Seven industries now bundle a document. Seven is seven more chances for one
     industry's content to appear on another's board, so every one is checked
     against the mining vocabulary AND asserted to bring its own routing. */
  console.log('\n4b · every bundled industry arrives populated and routed, and none of it is mining');
  for(const ind of ['education', 'retail', 'banking', 'healthcare', 'hospitality', 'telecom',
                    'fnb', 'ecommerce', 'tech', 'insurance', 'gaming', 'vending',
                    'ports', 'logistics', 'energy', 'manufacturing']){
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

  /* WHAT 449 ASSERTIONS DID NOT SAY.

     Section 4b above counted. It asserted that an industry brings touchpoints,
     channels, routed conditions and rules — and every count was healthy while
     all fifty-one results on the seventeen boards were measured by the same
     two pairs, 'Revenue Stream / Order Volume' and 'Funnel Conversion /
     Repeat Behaviour'. A mining board measured fuel with a Stripe settlement
     feed and the suite called it populated.

     Counting cannot see sameness. These three sections assert identity: that
     the measurement layer differs BETWEEN industries, that it is reachable for
     EVERY industry on the dropdown rather than the subset that had documents,
     and that a declared result and the document beneath it agree about what
     kind of number it is. Each corresponds to a defect that shipped. */
  console.log('\n4c \u00b7 the measurement layer is industry-specific, not one pair repeated');
  const seen = {};
  const mismatched = [];
  let generic = 0, unmeasured = 0;
  const inds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#industrySelect option')).map(o => o.value).filter(Boolean));
  ok('every industry on the dropdown is testable', inds.length >= 17, inds.length + ' industries');

  for(const ind of inds){
    await board(page, ind, true);
    /* The measurement layer is the DECLARED one now. `touchpoints` used to be
       manufactured on apply out of the industry archetype library, and this
       section exists because that library repeated two generic pairs across
       all seventeen boards. Nothing manufactures them any more, so the layer
       under test is what the document declares: its risk indicators. */
    const tps = await page.evaluate(() =>
      KBRS.map(k => (k.riskTouchpoints || []).map(t => t.name).join(' / ')));
    /* Collected on this pass rather than on a second one. Section 4e used to
       walk all seventeen industries again, at ~3 s of settling each; the board
       it needs is the one already on screen. */
    (await page.evaluate(i => {
      const out = [];
      const rows = (DEMO_CONFIG[i] || '').trim().split('\n')
        .filter(r => r.indexOf('kbr,') === 0).map(r => r.split(','));
      rows.forEach((d, n) => {
        const k = KBRS[n]; if(!k) return;
        const name = (d[1] || '').trim();
        if(name && k.name && k.name !== name) out.push(i + '/' + name + ' bound to ' + k.name);
        if(d[4] && k.format && d[4] !== k.format)
          out.push(i + '/' + name + ' format ' + d[4] + ' vs ' + k.format);
        if(d[5] && k.direction && d[5] !== k.direction)
          out.push(i + '/' + name + ' direction ' + d[5] + ' vs ' + k.direction);
        if(d[3] && k.unit && d[3] !== k.unit)
          out.push(i + '/' + name + ' unit ' + d[3] + ' vs ' + k.unit);
      });
      return out;
    }, ind)).forEach(x => mismatched.push(x));

    tps.forEach(sig => {
      if(/Revenue Stream|Order Volume|Funnel Conversion|Repeat Behaviour/.test(sig)) generic++;
      /* An EMPTY signature is a result whose document declares no indicators
         for it. That is an absence, not a repetition, and counting two
         absences as 'the same measurement layer twice' conflates a content gap
         with the copy-paste defect this section is about. The gap has its own
         report: the validator's C-HALFRISK, which counts exactly these. */
      if(!sig){ unmeasured++; return; }
      seen[sig] = (seen[sig] || 0) + 1;
    });
  }
  const repeated = Object.entries(seen).filter(([, n]) => n > 1);
  ok('no result falls back to the generic archetype pair', generic === 0,
     generic + ' of ' + Object.values(seen).reduce((a, b) => a + b, 0) + ' results generic');
  ok('no measurement signature is shared by two results', repeated.length === 0,
     repeated.slice(0, 2).map(([s, n]) => s + ' \u00d7' + n).join(' | '));
  /* Pinned, not tolerated. Two results across the seventeen boards declare no
     risk indicators at all — mining's Toneladas Movidas and Horas en Ralentí,
     the two empty Risk Meter panels from production testing. The validator
     reports them as C-HALFRISK × 2. If a document is fixed or another one
     regresses, this number moves and says so. */
  ok('exactly two results declare no measurement layer, and they are known',
     unmeasured === 2, unmeasured + ' of ' +
     (Object.values(seen).reduce((a, b) => a + b, 0) + unmeasured) + ' results');

  console.log('\n4d \u00b7 the Risk Meter never shows a figure it cannot attribute');
  for(const ind of ['mining', 'retail', 'manufacturing']){
    await board(page, ind, true);
    const attr = await page.evaluate(() => KBRS.map(k => {
      const c = kbrCompositeRisk(k);
      return { n:k.name, pct:c && c.pct, comps:c ? c.components.length : 0,
               rtps:(k.riskTouchpoints || []).length };
    }));
    ok(ind + ' \u2014 every meter reading has at least one configured component',
       attr.every(a => a.pct == null || a.comps > 0),
       JSON.stringify(attr.map(a => a.n + ':' + a.pct + '/' + a.comps + 'c')).slice(0, 130));
  }

  console.log('\n4e \u00b7 a bundled document agrees with the result it declares');
  /* This used to diff each bundled document against INDUSTRY_KBRS, the
     seventeen hardcoded result sets the board adopted when an industry was
     chosen. Those are gone: the document is now the only declaration, so
     there is no second registry for it to disagree with.

     The check that remains is the one that matters — that the result on the
     board says what the document said. It is not a tautology: the document's
     `format` reaches the KBR through ConfigApply and can be overridden by a
     journey template that declared something else first, which is exactly how
     mining's 'Horas en Ralentí' came to render as 10.0 instead of a
     duration. */
  /* Collected during 4c's pass over every industry, above. */
  ok('no bundled document declares another metric\u2019s unit, format or direction',
     mismatched.length === 0, mismatched.slice(0, 3).join(' | '));

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
