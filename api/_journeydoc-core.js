/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.JourneyDoc — the journey, as a document

   The Journey Doc step accepted a CONTEXT document: prose, read for words,
   used to colour generation. It did not accept a JOURNEY. So the one document
   that says what the business actually does — its stages, its substages, what
   each one observes, and which results they add up to — was the only one of
   the three that could not be attached, and the journey on screen still came
   from a bundled template. That is the last place content arrived from
   somewhere other than a document.

   SAME CONTRACT AS THE OTHER TWO. Rows discriminated by `kind`, eight columns,
   identical in every industry. A .docx table, a .xlsx sheet and a .csv all
   normalise to the same objects, so there is one resolver and no format can
   quietly behave differently. Extend by adding row kinds, never columns.

     result      a headline outcome        · unit, direction
     stage       a prime stage             · order, result it contributes to
     substage    a stage between two stages · parent
     touchpoint  what is observed          · parent, observes

   WHAT IT OBSERVES IS BUSINESS LANGUAGE, NEVER A COLUMN NAME. A touchpoint
   naming `Fuel Consumption Rate-Engine` welds the journey to one workbook; the
   same journey run against a client's own export then observes nothing. The
   validator warns on this (J-COLUMNISH) and the rule is the same here.

   REFUSING IS A FEATURE. Every structural fault below rejects the document
   rather than loading a partial journey — the same argument `.docx — tables
   only` makes. A journey that loads differently depending on which row was
   malformed is worse than one that says which row and refuses.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

var HEAD = ['kind','name','parent','order','result','unit','direction','observes'];
var KINDS = ['result','stage','substage','touchpoint'];

function norm(s){ return String(s == null ? '' : s).trim(); }
function key(s){ return norm(s).toLowerCase(); }
function num(v){
  if(v == null || norm(v) === '') return null;
  var n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}
function fail(reason, hint){ return { ok:false, reason:reason, hint:hint || null }; }

/* ── rows → a journey ────────────────────────────────────────────────────── */

/** `rows` are plain objects keyed by lowercased header. Returns
 *  { ok, doc } or { ok:false, reason, hint }. */
function fromRows(rows){
  if(!rows || !rows.length) return fail('the table had no rows below its header');

  var results = [], stages = [], subs = [], tps = [], i, r, k;

  for(i = 0; i < rows.length; i++){
    r = rows[i];
    k = key(r.kind);
    if(!k) continue;                                   /* a spacer row */
    if(KINDS.indexOf(k) === -1)
      return fail('row ' + (i + 2) + ' has an unknown kind "' + norm(r.kind) + '"',
                  'Expected one of: ' + KINDS.join(', ') + '.');
    if(!norm(r.name))
      return fail('row ' + (i + 2) + ' declares a ' + k + ' with no name');
    if(k === 'result') results.push(r);
    else if(k === 'stage') stages.push(r);
    else if(k === 'substage') subs.push(r);
    else tps.push(r);
  }

  if(!stages.length)
    return fail('the document declares no stages',
                'A journey needs at least one row of kind "stage". ' +
                'Without one there is nothing to draw.');

  /* Names are how every other row refers to these, so a duplicate makes a
     reference ambiguous rather than merely untidy. */
  var dup = null;
  [[results,'result'], [stages,'stage'], [subs,'substage']].forEach(function(pair){
    var seen = {};
    pair[0].forEach(function(row){
      var kk = key(row.name);
      if(seen[kk] && !dup) dup = 'two ' + pair[1] + 's are both named "' + norm(row.name) + '"';
      seen[kk] = 1;
    });
  });
  if(dup) return fail(dup, 'Names are how parents and results are referred to, ' +
                           'so a repeated one makes a reference ambiguous.');

  var resultNames = results.map(function(x){ return key(x.name); });
  var stageNames  = stages.map(function(x){ return key(x.name); });
  var subNames    = subs.map(function(x){ return key(x.name); });
  var nodeNames   = stageNames.concat(subNames);

  for(i = 0; i < results.length; i++){
    var d = key(results[i].direction);
    if(d && d !== 'up' && d !== 'down')
      return fail('result "' + norm(results[i].name) + '" declares direction "' +
                  norm(results[i].direction) + '"',
                  'Direction must be up (higher is better) or down (lower is better). ' +
                  'A result whose direction is unknown cannot be scored.');
  }
  for(i = 0; i < stages.length; i++){
    if(norm(stages[i].result) && resultNames.indexOf(key(stages[i].result)) === -1)
      return fail('stage "' + norm(stages[i].name) + '" contributes to "' +
                  norm(stages[i].result) + '", which this document does not declare',
                  'Add a row of kind "result" with that name, or clear the column.');
  }
  for(i = 0; i < subs.length; i++){
    if(!norm(subs[i].parent))
      return fail('substage "' + norm(subs[i].name) + '" names no parent stage');
    if(stageNames.indexOf(key(subs[i].parent)) === -1)
      return fail('substage "' + norm(subs[i].name) + '" names parent "' +
                  norm(subs[i].parent) + '", which is not a stage in this document');
  }
  for(i = 0; i < tps.length; i++){
    if(!norm(tps[i].parent))
      return fail('touchpoint "' + norm(tps[i].name) + '" names no parent');
    if(nodeNames.indexOf(key(tps[i].parent)) === -1)
      return fail('touchpoint "' + norm(tps[i].name) + '" names parent "' +
                  norm(tps[i].parent) + '", which is not a stage or substage here');
  }

  /* ── assemble ─────────────────────────────────────────────────────────── */

  var byNode = {};
  function node(name, kind, row){
    var n = { name: norm(row.name), kind: kind, row: row, tps: [] };
    byNode[key(row.name)] = n;
    return n;
  }

  var stageNodes = stages.map(function(row){ return node(null, 'stage', row); });
  var subNodes   = subs.map(function(row){ return node(null, 'substage', row); });

  /* `order` decides the spine. Rows without one keep the order they were
     written in, after those that declared one — a document half-numbered
     still reads the way its author laid it out. */
  stageNodes.forEach(function(n, ix){ n._ord = num(n.row.order); n._ix = ix; });
  stageNodes.sort(function(a, b){
    if(a._ord != null && b._ord != null) return (a._ord - b._ord) || (a._ix - b._ix);
    if(a._ord != null) return -1;
    if(b._ord != null) return 1;
    return a._ix - b._ix;
  });

  var columnish = [];
  tps.forEach(function(row){
    var parent = byNode[key(row.parent)];
    var obs = norm(row.observes);
    if(obs && /[#_]|Gateway|Ctrl\b|-Engine\b/.test(obs)) columnish.push(norm(row.name));
    parent.tps.push({ name: norm(row.name), observes: obs });
  });

  subNodes.forEach(function(n){ n.parent = norm(n.row.parent); });

  var doc = {
    name: '',
    results: results.map(function(row){
      return { name: norm(row.name), unit: norm(row.unit),
               direction: key(row.direction) === 'down' ? 'down' : 'up',
               declaredDirection: !!norm(row.direction) };
    }),
    stages: stageNodes.map(function(n){
      return { name: n.name, order: n._ord,
               result: norm(n.row.result), tps: n.tps };
    }),
    subs: subNodes.map(function(n){
      return { name: n.name, parent: n.parent, tps: n.tps };
    }),
    counts: { results: results.length, stages: stages.length,
              subs: subs.length, tps: tps.length },
    columnish: columnish
  };
  return { ok:true, doc: doc };
}

/* ── text formats ────────────────────────────────────────────────────────── */

/** csv / tsv, through the SAME row splitter the Config Doc uses — so `#`
 *  opens a comment in both, and guidance written into a template is never
 *  read back as content. */
function parse(text, filename){
  var CD = MOMENTUM.ConfigDoc;
  if(!CD || !CD.splitRows) return fail('the document reader is unavailable');
  var sep = /\.tsv$/i.test(String(filename || '')) ? '\t' : ',';
  var rows = CD.splitRows(String(text || ''), sep);
  if(!rows.length) return fail('the document is empty');
  var head = rows[0].map(function(h){ return String(h || '').trim().toLowerCase(); });
  if(head.indexOf('kind') === -1)
    return fail('the first row is not a header',
                'The header row must name the columns, starting with: ' + HEAD.join(', ') + '.');
  return fromRows(rows.slice(1).map(function(r){
    var o = {};
    head.forEach(function(h, i){ if(h) o[h] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  }));
}

/* ── the journey, as the board wants it ──────────────────────────────────── */

/** A Journey Doc becomes exactly the object a journey TEMPLATE becomes, so
 *  applyJourneyTemplate, the preview and the KBR path all work unchanged.
 *  The document is simply another way of arriving at the same shape.
 *
 *  It deliberately does NOT go through makeSized. A size selector trims a
 *  template to four, six or eight stages; a document declaring seven stages is
 *  the client's own word about their business, not a number to round. */
function toSized(doc, opts){
  opts = opts || {};
  if(!doc || !doc.stages || !doc.stages.length) return null;
  var maxPrimes = opts.maxPrimes || doc.stages.length;
  var unplaced = [];

  var primes = doc.stages.slice(0, maxPrimes).map(function(s){
    return { name: s.name, icon: '', tps: s.tps.slice() };
  });
  doc.stages.slice(maxPrimes).forEach(function(s){
    unplaced.push('stage "' + s.name + '" — the board has room for ' + maxPrimes);
  });

  var index = {};
  primes.forEach(function(p, i){ index[key(p.name)] = i; });

  /* A substage sits in the VALLEY between two prime stages, so it needs a
     stage on both sides. One hanging off the last stage has no valley to sit
     in, and two hanging off the same stage want the same valley. Neither is
     malformed — the document is legal — so they are reported rather than
     rejected, and reported rather than dropped in silence. */
  var subs = {}, taken = {};
  doc.subs.forEach(function(s){
    var i = index[key(s.parent)];
    if(i == null){
      unplaced.push('substage "' + s.name + '" — its parent stage is not on the board');
      return;
    }
    if(i >= primes.length - 1){
      unplaced.push('substage "' + s.name + '" — "' + s.parent +
                    '" is the last stage, and a substage needs a stage on both sides');
      return;
    }
    if(taken[i]){
      unplaced.push('substage "' + s.name + '" — "' + taken[i] +
                    '" already occupies the gap after "' + s.parent + '"');
      return;
    }
    taken[i] = s.name;
    subs[i] = { name: s.name, icon: '', tps: s.tps.slice() };
  });

  return {
    id: 'journeydoc', themeId: 'journeydoc', size: 'document',
    name: doc.name || 'Attached journey',
    primes: primes, subs: subs, unplaced: unplaced, fromDocument: true
  };
}

/** The declared results, in the shape applyKbrSimulation reads. A result with
 *  no unit keeps an empty one: inference is a suggestion everywhere else in
 *  this product and does not get to become an override here. */
function resultsAsKbrs(doc){
  if(!doc || !doc.results || !doc.results.length) return null;
  return doc.results.slice(0, 3).map(function(r){
    return { name: r.name, unit: r.unit,
             type: /%/.test(r.unit) ? 'percentage' : 'value',
             direction: r.direction };
  });
}

/* ── the template ────────────────────────────────────────────────────────── */

var GUIDE = [
  'MOMENTUM Journey Doc — one row per declaration, kind in the first column.',
  '',
  'kind=result      a headline outcome. unit and direction (up = higher is better).',
  'kind=stage       a prime stage. order sets the spine; result names the outcome it feeds.',
  'kind=substage    sits in the gap between two stages. parent names the stage before it.',
  'kind=touchpoint  what is observed. parent names its stage or substage.',
  '',
  'A touchpoint says WHAT IT OBSERVES in business language, never a column name.',
  '"how long a truck waits to be loaded" travels to any dataset; "Truck Payload-',
  'Communication Gateway #2" only ever works against one workbook.',
  '',
  'Rows may be added, removed and reordered. Columns may not — every industry',
  'uses these eight. Anything outside the table is guidance and is not read.'
];

/** Rows for a starter document. `spec` is optional: given the journey
 *  currently previewed, the template comes back already filled in with it, so
 *  the round trip is template → document → edit → attach rather than a blank
 *  page and a schema to retype. */
function templateRows(spec){
  spec = spec || {};
  var rows = [HEAD.slice()];
  var results = spec.results && spec.results.length ? spec.results : [
    { name:'', unit:'', direction:'up' }
  ];
  results.slice(0, 3).forEach(function(r){
    rows.push(['result', r.name || '', '', '', '', r.unit || '', r.direction || 'up', '']);
  });

  var primes = (spec.primes || []);
  if(!primes.length) primes = [{ name:'' }, { name:'' }];
  primes.forEach(function(p, i){
    rows.push(['stage', p.name || '', '', String(i + 1),
               (results[0] && results[0].name) || '', '', '', '']);
  });
  Object.keys(spec.subs || {}).forEach(function(k){
    var s = spec.subs[k], parent = primes[parseInt(k, 10)];
    rows.push(['substage', s.name || '', (parent && parent.name) || '', '', '', '', '', '']);
  });
  primes.forEach(function(p){
    (p.tps || []).forEach(function(t){
      rows.push(['touchpoint', t.name || '', p.name || '', '', '', '', '',
                 t.observes || '']);
    });
  });

  /* A document with no touchpoints anywhere teaches nothing about the column
     that matters most, so one worked row is written in rather than left to be
     inferred from the guidance underneath. */
  var hasTp = rows.some(function(r){ return r[0] === 'touchpoint'; });
  if(!hasTp && primes.length)
    rows.push(['touchpoint', '', primes[0].name || '', '', '', '', '',
               'what this stage lets you see, in business language']);

  return rows;
}

function describe(doc){
  if(!doc) return 'nothing declared';
  var c = doc.counts, out = [];
  function t(n, one, many){ if(n) out.push(n + ' ' + (n === 1 ? one : many)); }
  t(c.results, 'result', 'results');
  t(c.stages, 'stage', 'stages');
  t(c.subs, 'substage', 'substages');
  t(c.tps, 'touchpoint', 'touchpoints');
  return out.join(', ') || 'nothing declared';
}

MOMENTUM.JourneyDoc = {
  version: 1, HEAD: HEAD, KINDS: KINDS, GUIDE: GUIDE,
  fromRows: fromRows, parse: parse, toSized: toSized,
  resultsAsKbrs: resultsAsKbrs, templateRows: templateRows, describe: describe
};

})();
