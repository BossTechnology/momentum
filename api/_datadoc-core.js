/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.DataDoc — span, grain, calendar, and the mode that picks the shape

   THE FORK RUNS THE RIGHT WAY ROUND. A template used to be a template, and the
   mode was whatever the person later typed into it. That is backwards: the
   three modes need genuinely different documents, and offering one shape for
   all three means two of the three arrive with rows that cannot apply and
   without the rows they need.

     replay  plays the attached rows back through the clock.
             Needs FIELDS to play, LIMITS so thresholds are declared rather
             than inferred, WINDOWS so a demo can start at a business moment.
     seeded  expands declared measures at the observed shape.
             Needs MEASURES to expand and SHAPES to expand them at.
     free    declares everything and reads nothing.
             Needs measures and shapes; fields and limits describe a file that
             is not there.

   REPLAY WITH NO ROWS IS UNAVAILABLE, NOT OFFERED-AND-EMPTY. There is a real
   difference between a mode that needs setting up and a mode that cannot
   exist. Handing someone a replay document with an empty field list invites
   them to fill in column names by hand for a file MOMENTUM has never seen —
   which is the exact failure the generated Config Doc was built to remove.
   So the mode is offered as unavailable, with the reason, and the reason is
   the thing they can act on: attach the data.

   Switching modes is allowed and never silent: the caller is told what the
   switch cost, because a mode change that quietly discards a chosen window is
   how a demo starts in the wrong place.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

var HEAD = ['kind','name','type','unit','mode','grain','span','field',
            'context','correct_low','correct_high','out_low','out_high',
            'persistence','starts','ends','notes'];

var KINDS = ['dataset','field','limit','window','calendar','measure','shape','event'];
var MODES = ['replay','seeded','free'];

/* Which row kinds each mode's document is MADE of. This table is the fork:
   everything below reads it rather than branching on the mode by hand. */
var SHAPE = {
  replay: { kinds:['dataset','calendar','field','limit','window'],
            needs:'field',
            label:'Replay',
            blurb:'Play the attached rows back through the clock.' },
  seeded: { kinds:['dataset','calendar','measure','shape','event','limit'],
            needs:'measure',
            label:'Seeded',
            blurb:'Expand declared measures at the shape observed in the data.' },
  free:   { kinds:['dataset','calendar','measure','shape','event'],
            needs:'measure',
            label:'Free',
            blurb:'Declare everything; read nothing.' }
};

function norm(s){ return String(s == null ? '' : s).trim(); }
function key(s){ return norm(s).toLowerCase(); }

/** Is this mode available given what is attached? `profile` is the bound data
 *  profile, or null. Returns { ok, why } — `why` is written for the person and
 *  says what to do, not what went wrong. */
function availability(mode, profile){
  mode = key(mode);
  if(MODES.indexOf(mode) === -1) return { ok:false, why:'not a mode' };
  if(mode !== 'replay') return { ok:true, why:'' };
  var rows = profile && profile.coverage && profile.coverage.rowsProfiled;
  if(!rows)
    return { ok:false, why:'Replay needs rows to play. Attach data above and ' +
                           'this becomes available.' };
  return { ok:true, why:'' };
}

/** Every mode with its availability, in one call, so a UI never has to know
 *  the rule — it renders what this returns. */
function modes(profile){
  return MODES.map(function(m){
    var a = availability(m, profile);
    return { mode:m, label:SHAPE[m].label, blurb:SHAPE[m].blurb,
             available:a.ok, why:a.why };
  });
}

/* ── the document ────────────────────────────────────────────────────────── */

function row(o){
  return HEAD.map(function(h){ return o[h] == null ? '' : String(o[h]); });
}

/** Rows for the Data Doc the chosen mode calls for. `profile` fills in what is
 *  actually there — real column names, real units, the profiled span and
 *  grain — so nobody types a field name from memory. Without a profile the
 *  document still comes out usable; it simply cannot pre-fill, and says so in
 *  the guidance rather than inventing names. */
function templateRows(mode, profile, opts){
  mode = key(mode);
  if(MODES.indexOf(mode) === -1) mode = 'free';
  opts = opts || {};
  var shape = SHAPE[mode];
  var has = function(k){ return shape.kinds.indexOf(k) !== -1; };
  var cov = (profile && profile.coverage) || {};
  var rows = [HEAD.slice()];

  rows.push(row({
    kind:'dataset', name: opts.name || (cov.span && cov.span.label) || 'my dataset',
    mode: mode,
    grain: (cov.resolution && cov.resolution.label) || '',
    span:  (cov.span && cov.span.label) || '',
    notes: shape.blurb
  }));

  if(has('calendar'))
    rows.push(row({ kind:'calendar', name:'operating hours', starts:'', ends:'',
                    notes:'when the business is running — blank means around the clock' }));

  if(has('field')){
    var cols = (cov.contextColumns || []).concat(cov.measures || []);
    if(cols.length) cols.forEach(function(c){
      rows.push(row({ kind:'field', name:c.name,
                      type: c.unit ? 'number' : 'text', unit: c.unit || '' }));
    });
    else rows.push(row({ kind:'field', name:'', type:'number', unit:'',
                         notes:'one row per column the clock reads' }));
  }

  if(has('measure')){
    var ms = cov.measures || [];
    if(ms.length) ms.forEach(function(m){
      rows.push(row({ kind:'measure', name:m.name, unit:m.unit || '' }));
    });
    else rows.push(row({ kind:'measure', name:'', unit:'',
                         notes:'one row per quantity the simulation produces' }));
  }

  if(has('shape'))
    rows.push(row({ kind:'shape', name: (cov.cycles && cov.cycles.strongest &&
                                         cov.cycles.strongest.name) || '',
                    notes:'the repeating pattern a measure follows over a day or a week' }));

  if(has('event'))
    rows.push(row({ kind:'event', name:'', notes:'something that interrupts the shape' }));

  if(has('limit')){
    /* Declared limits beat inferred ones. Inferring a threshold from a file
       that contains injected faults teaches the detector that the fault is
       normal — the mining workbook has ten of them and its manual is explicit
       that they must not feed detection. */
    rows.push(row({ kind:'limit', field:'', context:'',
                    correct_low:'', correct_high:'', out_low:'', out_high:'',
                    persistence:'',
                    notes:'declared thresholds, so the generator and the Risk Meter share one source' }));
  }

  if(has('window')){
    rows.push(row({ kind:'window', name:'', starts:'', ends:'',
                    notes:'a named moment a demo can start at, instead of a row offset' }));
  }

  return rows;
}

/** Guidance written outside the table, so it is legible to a person and
 *  invisible to the reader. */
function guide(mode, profile){
  mode = key(mode);
  var shape = SHAPE[mode] || SHAPE.free;
  var a = availability(mode, profile);
  var out = [
    'MOMENTUM Data Doc — ' + shape.label.toLowerCase() + ' mode.',
    shape.blurb,
    '',
    'This document is the ' + shape.label.toLowerCase() + ' shape: rows of kind ' +
      shape.kinds.join(', ') + '.',
    'A different mode is a different document — change the mode in MOMENTUM and',
    'download again rather than editing the mode column here.',
    ''
  ];
  if(!a.ok) out.push('NOTE: ' + a.why, '');
  if(!(profile && profile.coverage && profile.coverage.rowsProfiled))
    out.push('No data was attached when this was generated, so field and measure',
             'names are blank rather than guessed. Attaching data first fills them',
             'in from the real columns.', '');
  out.push('Rows may be added, removed and reordered. Columns may not — every',
           'industry and every mode uses these ' + HEAD.length + '.');
  return out;
}

MOMENTUM.DataDoc = {
  version: 1, HEAD: HEAD, KINDS: KINDS, MODES: MODES, SHAPE: SHAPE,
  availability: availability, modes: modes,
  templateRows: templateRows, guide: guide
};

})();
