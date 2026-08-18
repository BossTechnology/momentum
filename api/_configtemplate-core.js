/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.ConfigTemplate — a Config Doc built from the client's own data

   A blank example asks someone to type column names from memory, and a single
   typo produces an answer that silently binds to nothing. This generates the
   document from the bound profile instead: the real dimensions, the real
   measures, the real units, and the highest-variance questions already filled
   in as editable rows.

   So the failure mode the Config Doc is most exposed to — naming a column that
   does not exist — is removed at the source rather than reported afterwards.

   It is a starting point, not an answer. The variance shortlist proposes
   questions that MOVE, which is a statistical property and not a business one;
   whoever knows the operation still decides which are worth a slot. That is
   why the rows are editable and why the reference block lists every column
   rather than only the ones proposed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

var HEAD = ['kind','kbr','name','unit','format','direction','target','notes',
            'dimension','measure','denominator','aggregation','rank',
            'op','value','response','channels','dna','weight','rollup'];

/* Score a candidate against the result it is being offered for. Unit match is
   the strongest signal — a gal/ton result wants fuel questions — then shared
   words between the measure and the result's name. */
function relevantFirst(cands, kbr){
  var unit = String(kbr.unit || '').toLowerCase();
  var words = String(kbr.name || '').toLowerCase()
    .normalize ? String(kbr.name || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(function(w){
          return w.length > 3; })
    : [];
  return (cands || []).map(function(q, i){
    var hay = String(q.measure + ' ' + (q.unit || '')).toLowerCase();
    var score = 0;
    if(unit && q.unit && String(q.unit).toLowerCase() === unit) score += 100;
    if(unit && hay.indexOf(unit.split('/')[0]) >= 0) score += 40;
    words.forEach(function(w){ if(hay.indexOf(w) >= 0) score += 25; });
    return { q:q, score:score, i:i };
  }).sort(function(a, b){
    return (b.score - a.score) || (a.i - b.i);
  }).map(function(x){ return x.q; });
}

function cell(v){
  var s = (v == null) ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function row(o){
  return HEAD.map(function(h){ return cell(o[h]); }).join(',');
}

/** Build the CSV. `kbrs` are the live results; `profile` supplies the columns. */
function generate(kbrs, profile, opts){
  opts = opts || {};
  var A = MOMENTUM.Answer;
  var lines = [HEAD.join(',')];

  /* A channel every configuration needs, shown so the shape is obvious. */
  lines.push(row({ kind:'channel', name:'Operations Team', channels:'ops@example.com',
                   dna:'email', notes:'replace with a real distribution list' }));

  (kbrs || []).forEach(function(k){
    lines.push(row({
      kind:'kbr', kbr:k.name, unit:k.unit || '',
      format:(k.goal && k.goal.format) || k.format || '',
      direction:(k.goal && k.goal.direction) || '',
      target:(k.goal && k.goal.target != null) ? k.goal.target : '',
      notes:(k.goal && k.goal.provisional) ? 'provisional' : ''
    }));

    /* Questions the data can actually answer, highest variance first — an
       answer that never changes is not worth a slot on the board. */
    /* The variance shortlist is global, so every result was offered the same
       four questions — "Terrain Inclination by OHT Truck Payload State" on the
       fuel result, the tonnage result and the idle result alike. A suggestion
       that ignores which result it is for is barely a suggestion.

       Candidates whose measure or unit relates to THIS result are floated to
       the top; the rest still follow, because variance is a real signal and
       the author may want something the name never hinted at. */
    var picks = (A && profile)
      ? relevantFirst(A.shortlist(profile, (k.answers || []).map(function(a){
          return a.name; }), (opts.perKbr || 4) * 4), k).slice(0, opts.perKbr || 4)
      : [];
    picks.forEach(function(q){
      lines.push(row({
        kind:'answer', kbr:k.name, name:q.question,
        unit:q.unit || '', format:q.format || '',
        dimension:q.column, measure:q.measure,
        aggregation:'mean', rank:'max',
        notes:'variance ' + q.variance.toFixed(2) + ' \u00b7 ' + q.members + ' members'
      }));
    });
    if(!picks.length){
      lines.push(row({ kind:'answer', kbr:k.name, name:'',
                       notes:'no profile bound \u2014 fill dimension and measure by hand' }));
    }

    lines.push(row({ kind:'risk', kbr:k.name, name:'', dna:'Analog', weight:'MED',
                     rollup:'weighted', notes:'a leading indicator that warns before this result moves' }));
    lines.push(row({ kind:'condition', kbr:k.name, name:'',
                     op:(k.goal && k.goal.direction === 'down') ? 'gt' : 'lt',
                     value:(k.goal && k.goal.target != null) ? k.goal.target : '',
                     response:'alarm', channels:'Operations Team',
                     notes:'fires when the result crosses this value' }));
  });

  lines.push('');
  lines.push('# Reference \u2014 every column in the attached data. Copy a name into');
  lines.push('# `dimension` or `measure`. Business terms also work: the profile');
  lines.push('# dictionary resolves "turno" to Shift ID and "fuel" to the fuel rate.');
  ((profile && profile.context) || []).forEach(function(c){
    /* A column with one distinct value cannot differentiate anything, so
       every question built on it is degenerate by construction. Listing it
       without saying so invites someone to spend an afternoon on an answer
       that can never move. */
    var degenerate = (c.distinct || 0) < 2;
    lines.push('# dimension: ' + c.name + '   (' + (c.distinct || 0) + ' value' +
      ((c.distinct || 0) === 1 ? '' : 's') + ')' +
      (degenerate ? '   \u2014 UNUSABLE: one value only, nothing to compare' : ''));
  });
  ((profile && profile.measures) || []).forEach(function(m){
    lines.push('# measure:   ' + m.name + (m.unit ? '   [' + m.unit + ']' : ''));
  });
  /* MINING VOCABULARY ON A RETAIL SURFACE.
     `__gallons`, `__tons` and `__cycles` are reserved tokens the Answer Engine
     resolves against a cycle model — a haul truck filling and dumping. They
     were printed into EVERY template, so a retail client downloading one to
     describe till queues read a reference list mentioning gallons and tons.

     The tokens are not renamed: the Answer Engine resolves them directly and
     renaming them is a change to settled behaviour. They are simply not
     offered where they cannot be used. A profile with no cycle model has no
     rollups to read, so the line is not merely off-topic there — it is wrong. */
  var hasCycles = !!(profile && profile.rollups && profile.rollups.cycleModel &&
                     (profile.rollups.cycleModel.candidates || []).length);
  if(hasCycles)
    lines.push('# measure:   __gallons, __tons, __cycles  (reserved readings of the rollups)');

  /* `unit`, `roster` and `incident` are industry-neutral — a haul truck, a
     nurse, a till are all "unit" — and BUILTIN_DIMS resolves them without a
     profile, so they are always offered. */
  lines.push('# dimension: unit, roster, incident        (reserved dimensions)');

  return lines.join('\n');
}

/** Hand it to the browser as a download. */
function download(kbrs, profile, filename){
  var csv = generate(kbrs, profile);
  try {
    var blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'momentum-config-template.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
  } catch(e){}
  return csv;
}

MOMENTUM.ConfigTemplate = { version:1, HEAD:HEAD, generate:generate, download:download };

})();

/* The template is generated from whatever is bound. With no data document it
   still produces a usable skeleton — it simply cannot pre-fill the columns,
   and says so rather than emitting names that do not exist. */
function downloadConfigTemplate(){
  var T = window.MOMENTUM && MOMENTUM.ConfigTemplate;
  var stat = document.getElementById('cfgAttachStatus');
  if(!T){ if(stat) stat.textContent = 'Template generator unavailable.'; return; }
  var profile = (MOMENTUM.Bind && MOMENTUM.Bind.active() && MOMENTUM.Bind.profile)
              ? MOMENTUM.Bind.profile() : null;
  T.download(KBRS, profile, 'momentum-config-template.csv');
  if(stat) stat.textContent = profile
    ? 'Template built from the attached data \u2014 real column names are pre-filled.'
    : 'Template downloaded. No data document is bound, so dimensions and measures are blank.';
}
window.downloadConfigTemplate = downloadConfigTemplate;
