const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type()==='error' && !/403|Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  console.log('\nPhase 4.5 · the generated world, made visible\n');

  console.log('1 · a mining journey, nothing bound');
  const built = await page.evaluate(() => {
    /* Mining is now its own industry. It used to be a journey filed under
       Energy & Utilities, so this suite reached it through 'energy' — that
       list no longer carries it, which is the point of the split. */
    document.getElementById('industrySelect').value = 'mining';
    SB_CFG.industry='mining'; SB_CFG.size='large'; SB_CFG.lang='en';
    const list = templatesFor('mining');
    const haul = list.find(t=>/haul|acarreo|ciclo|fleet|mining|miner/i.test(t.name)) || list[0];
    SB_CFG.themeId = haul.id;
    applyJourneyTemplate('mining', currentSizedJourney());
    applyKbrSimulation(); applyLanguage();
    return { journey: haul.name, primes: journeyStages.filter(s=>s.kind==='prime'&&s.name).map(s=>s.name) };
  });
  ok('a mining journey is on screen', built.primes.length >= 4, built.journey + ' · ' + built.primes.join(' / '));
  const pre = await page.evaluate(() => ({ occ:(MOMENTUM.Bind.stageMap() ? 1 : 0),
    strip:document.querySelectorAll('.kbr-bound').length, banner:!!document.getElementById('bindIncident') }));
  ok('nothing bound → no fleet occupancy is painted at all', pre.occ === 0);
  ok('nothing bound → no KBR strips', pre.strip === 0);
  ok('nothing bound → no incident banner', !pre.banner);
  await page.screenshot({ path: 'shot45-1-unbound.png' });

  console.log('\n2 · attach the profiled workbook');
  await page.evaluate(p => { MOMENTUM.Data.profile = p; MOMENTUM.Data.renderCoverage(p);
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T12:00:00Z')); }, profile);
  await page.waitForTimeout(1400);
  const bound = await page.evaluate(() => {
    /* The occupancy badge was retired: the hexagon's own border now carries
       the share, as a yellow arc clipped by stroke-dasharray over a dark grey
       base ring. The facts under test are unchanged — that occupancy appears,
       accounts for the whole fleet, and redistributes as the clock runs — so
       they are read off the ring instead of off a text node. */
    const sm = MOMENTUM.Bind.stageMap();
    const mappedIds = sm ? Object.keys(sm.map) : [];
    const arcs = mappedIds.map(id => {
      const cell = document.querySelector('.hex-cell[data-id="' + id + '"]');
      const a = cell && cell.querySelector('.hex-arc');
      if(!a) return 0;
      const d=(a.style.strokeDasharray||'').split(/[, ]+/).filter(Boolean).map(parseFloat);
      if(d.length<2||!d[1]) return 0;
      const L=a.getTotalLength()||0;
      return L? Math.round((d[0]/L)*100) : 0;
    });
    const badges=arcs.map(n=>n+'%');
    return { occ:badges.length, badges, sum:arcs.reduce((a,b)=>a+b,0),
      map:MOMENTUM.Bind.stageMap(),
      /* The bound strip moved off the board card and into each result's
         Activity drawer. The FACTS it asserts are unchanged — a strip appears
         only where the number belongs, it carries the locked gal/ton, and the
         tonnage is counted once per cycle — so the assertions were relocated
         rather than dropped. Opening each drawer in turn is what the reader
         does, and it is what this now checks. */
      all:[...document.querySelectorAll('.kbr-col')].map(c=>({
        name:(c.querySelector('.kbr-name')||{}).textContent||'' })) };
  });
  const drawers = await page.evaluate(async () => {
    const out = [];
    for(const k of KBRS){
      openKbrPanel(k.id);
      await new Promise(r => setTimeout(r, 400));
      const e = document.querySelector('#kbrActContent .kbr-bound');
      out.push({ name: k.name, strip: e ? e.innerText : '' });
      if(typeof closeKbrPanel === 'function') closeKbrPanel();
      await new Promise(r => setTimeout(r, 200));
    }
    return out;
  });
  bound.all = drawers;
  bound.strip = drawers.filter(d => d.strip).length;
  bound.stripText = drawers.map(d => d.strip).filter(Boolean).join(' || ');
  ok('occupancy appears on the honeycomb, as border arcs', bound.occ >= 4,
     bound.occ+' rings: '+bound.badges.join(' '));
  ok('stage→state mapping is recorded', bound.map && bound.map.mapped >= 4,
     bound.map.mapped+' of '+bound.map.stages+' stages mapped to '+bound.map.states+' states');
  ok('the arcs account for the whole fleet', Math.abs(bound.sum-100) <= 4,
     bound.sum+'% across '+bound.map.mapped+' mapped stages');
  ok('a strip lands in Activity only where the number belongs', bound.strip >= 1 && bound.strip < bound.all.length,
     bound.all.map(k=>k.name+': '+(k.strip?'strip':'none')).join(' | '));
  ok('the ratio KBR shows the locked gal/ton', /0\.1[4-7]\d\d/.test(bound.stripText),
     bound.stripText.replace(/\n/g,' · '));
  ok('attainment reads as exceeded', /exceeded/.test(bound.stripText));
  ok('the tonnage KBR shows the quantity counted once per cycle',
     /counted once per completed cycle/.test(bound.stripText));
  await page.screenshot({ path: 'shot45-2-bound.png' });

  console.log('\n3 · the fleet moves as the clock runs');
  const moved = await page.evaluate(() => {
    const sm = MOMENTUM.Bind.stageMap();
    const read = () => (sm ? Object.keys(sm.map) : []).map(id => {
      const c = document.querySelector('.hex-cell[data-id="' + id + '"]');
      const a = c && c.querySelector('.hex-arc');
      return a ? (a.style.strokeDasharray || '') : '';
    }).join(' ');
    const a = read();
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T12:11:00Z')); MOMENTUM.Bind.paintAll();
    const b = read();
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T12:23:00Z')); MOMENTUM.Bind.paintAll();
    return { a, b, c: read() };
  });
  ok('occupancy redistributes over eleven minutes', moved.a !== moved.b, moved.a+'  →  '+moved.b);
  ok('and again over the next twelve', moved.b !== moved.c, moved.b+'  →  '+moved.c);
  await page.screenshot({ path: 'shot45-3-moved.png' });

  console.log('\n4 · scrub to a scripted incident');
  const inc = await page.evaluate(() => {
    const g = MOMENTUM.Bind.generator();
    const c = g.plan.cases.find(x=>x.unit==='HT-001'&&x.placement==='scheduled');
    MOMENTUM.Bind.seek(c.startMs-600000); MOMENTUM.Bind.paintAll();
    const b0 = document.getElementById('bindIncident');
    const before = b0 ? /HT-001/.test(b0.innerText) : false;
    MOMENTUM.Bind.seek(c.startMs+5400000); MOMENTUM.Bind.paintAll();
    const el = document.getElementById('bindIncident');
    return { before, after:!!el, text: el?el.innerText.replace(/\n/g,' '):'', onset:new Date(c.startMs).toISOString() };
  });
  ok('HT-001 is not named ten minutes before its onset', !inc.before, 'onset '+inc.onset);
  ok('HT-001 is named once its fault is live', inc.after && /HT-001/.test(inc.text), inc.text);
  await page.screenshot({ path: 'shot45-4-incident.png' });

  console.log('\n5 · the strip reports what the file MEASURES, not what the clock shows');
  /* This section once asserted the opposite: that the header range drove the
     strip's figures. It did, because the strip read the Generator — and that
     is exactly why it reported 19,021 gal over 304 cycles for a workbook
     containing 19,644.7 over 299. Synthesised, windowed, and near enough to
     look right.

     The strip now reads the profile's measured rollups and states its period
     outright. Its figures do NOT move with the clock, and that immobility is
     the guarantee worth protecting: it is what would break the moment anyone
     reconnected it to the Generator. The moving, windowed picture belongs to
     the rest of the board. */
  const rng = await page.evaluate(async () => {
    const read = async () => {
      openKbrPanel(KBRS[0].id);
      await new Promise(r => setTimeout(r, 400));
      const e = document.querySelector('#kbrActContent .kbr-bound');
      const t = e ? e.innerText.replace(/\n/g, ' · ') : '';
      if(typeof closeKbrPanel === 'function') closeKbrPanel();
      await new Promise(r => setTimeout(r, 200));
      return t;
    };
    const out = {};
    onTimeChange('today'); MOMENTUM.Bind.paintAll(); out.today = await read();
    onTimeChange('week');  MOMENTUM.Bind.paintAll(); out.week  = await read();
    onTimeChange('today'); MOMENTUM.Bind.paintAll();
    return out;
  });
  const cyc = t => parseInt((/over ([\d,]+) completed/.exec(t)||[0,'0'])[1].replace(/,/g,''),10);
  ok('the strip reports the locked 299 completed cycles', cyc(rng.today) === 299,
     cyc(rng.today) + ' cycles');
  ok('and the header range does not move them', rng.week === rng.today,
     cyc(rng.today) + ' \u2192 ' + cyc(rng.week) + ' cycles');
  ok('it names the period it measured', /of attached data/.test(rng.today),
     rng.today.slice(0, 90));

  console.log('\n6 · detach');
  await page.evaluate(() => { MOMENTUM.Bind.resume(); MOMENTUM.Data.profile = null; });
  await page.waitForTimeout(1300);
  const off = await page.evaluate(() => ({ occ:document.querySelectorAll('.hex-occ').length,
    bg:document.querySelectorAll('.hex-occbg').length,
    /* Scoped to the board and to a FRESHLY rendered drawer. Closing the panel
       hides it without clearing its markup, so a detached profile leaves stale
       bound content sitting in a hidden node until the next open re-renders
       it. What matters is that nothing bound is reachable: none on the board,
       and none when the drawer is opened again. */
    strip:(function(){
      var board = document.querySelectorAll('#kbrGrid .kbr-bound').length;
      openKbrPanel(KBRS[0].id);
      var drawer = document.querySelectorAll('#kbrActContent .kbr-bound').length;
      closeKbrPanel();
      return board + drawer;
    })(),
    banner:!!document.getElementById('bindIncident'), active:MOMENTUM.Bind.active() }));
  ok('every badge is removed', off.occ===0 && off.bg===0);
  /* detach: the drawer is closed, so no strip is in the DOM at all — the
     assertion is that nothing bound survives, which it does either way */
  ok('every strip is removed', off.strip===0);
  ok('the banner is removed', !off.banner);
  ok('the painter stopped', !off.active);
  await page.screenshot({ path: 'shot45-6-detached.png' });
  ok('no page errors across the whole run', errors.length===0, errors.slice(0,2).join(' | '));
  console.log('\n'+pass+' passed · '+fail+' failed\n');
  await browser.close();
  process.exit(fail?1:0);
})();
