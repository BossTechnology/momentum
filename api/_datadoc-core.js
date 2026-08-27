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
                    notes:'a named moment a demo can start at \u2014 put its name in the ' +
                          'dataset row\'s starts cell to open there' }));
  }

  /* THE BLANK IS THE EXAMPLE WITH ITS AUTHORED CELLS EMPTIED, never a second
     document. Authoring two per industry per mode is how a column added to one
     goes missing from the other, silently, six months later. One code path
     produces both, so a column added here arrives in both in the same build.

     What survives is structure: the kind, the type, the mode, the guidance.
     What empties is what the person owns. The row COUNT survives too, which is
     the point of a blank \u2014 a header row tells you the columns, but a blank of
     the same shape tells you how many rows of each kind a finished document
     has. */
  if(opts.blank) rows = [rows[0]].concat(rows.slice(1).map(blankRow));

  return rows;
}

var KEPT = { kind:1, type:1, mode:1, notes:1 };
function blankRow(cells){
  return cells.map(function(c, i){ return KEPT[HEAD[i]] ? c : ''; });
}

/** Guidance written outside the table, so it is legible to a person and
 *  invisible to the reader. */
function guide(mode, profile, blank){
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
  if(!blank && !(profile && profile.coverage && profile.coverage.rowsProfiled))
    out.push('No data was attached when this was generated, so field and measure',
             'names are blank rather than guessed. Attaching data first fills them',
             'in from the real columns.', '');
  if(blank)
    out.push('This is the BLANK flavour: every row the example has, with the cells',
             'you fill in left empty. Download the example alongside it to see a',
             'completed one. Attaching this unedited is refused, and says so.', '');
  out.push('TO OPEN A DEMO PART-WAY IN, put a position in the dataset row\'s',
           '"starts" cell. It reads a ratio (1/3), a percentage (33%), a clock',
           'time (15:00), an instant, or the name of a window declared below.',
           '');
  out.push('Rows may be added, removed and reordered. Columns may not — every',
           'industry and every mode uses these ' + HEAD.length + '.');
  return out;
}


/* ── reading a Data Doc back ──────────────────────────────────────────────
   THE WRITER HAD NO READER. A Data Doc could be downloaded, edited and never
   returned: the clock's `declared` tier was wired and starved. Everything
   below is the other half of that round trip.

   TWO CLASSES OF PROBLEM, TWO ANSWERS. A document that cannot do its job is
   refused whole — no rows of the kind its mode needs, a mode it does not
   declare, a span that describes a different file. A document that merely
   says something this mode cannot use keeps working: the row is refused, NAMED
   and COUNTED, and the rest applies. That is not demotion. Demotion is
   dropping row 14 and reporting thirteen; naming it is the opposite.

   THE ROWS ARE GROUND TRUTH; THE DECLARATION IS INTENT. `span` and `grain`
   arrive as human labels — "24 hours", "per second" — because that is what the
   profiler writes into the template. The mining file holds 86,399,000 ms, one
   second short of the "24 hours" its own generated document claims. Enforcing
   the declaration would make MOMENTUM's own template fail MOMENTUM's own
   validation on first attach. So a declared span is compared and reported,
   never enforced — except when it is so far out that the likeliest reading is
   a different file, which is worth refusing loudly.
   ═══════════════════════════════════════════════════════════════════════════ */

var DUR = { s:1, sec:1, secs:1, second:1, seconds:1,
            m:60, min:60, mins:60, minute:60, minutes:60,
            h:3600, hr:3600, hrs:3600, hour:3600, hours:3600,
            d:86400, day:86400, days:86400,
            w:604800, week:604800, weeks:604800 };

/** Every spelling MOMENTUM writes and every spelling a person types over it:
 *  "24 hours", "1 s", "per second", "every 5 min". Returns seconds or null. */
function duration(v){
  var s = key(v).replace(/,/g, '').replace(/^(per|every|each)\b/, '').trim();
  if(!s) return null;
  /* "per second" means one second; "every 15 min" already carries its count. */
  if(!/^\d/.test(s)) s = '1 ' + s;
  var m = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if(m){
    var n = parseFloat(m[1]), u = DUR[m[2]];
    return (isFinite(n) && u) ? n * u : null;
  }
  var b = s.match(/^([a-z]+)$/);
  return b ? (DUR[b[1]] || null) : null;
}

/** A clock time, or an absolute instant. A bare "15:00" is meaningless without
 *  a day to hang it on, so it is resolved against the origin — and rolled
 *  forward when it lands before it, because a span that starts at 07:00 and
 *  runs a day puts 03:00 on the FOLLOWING morning. Spans crossing midnight are
 *  the normal case in mining, not the exception. */
function instant(v, originMs){
  var s = norm(v);
  if(!s) return null;
  var hm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(hm){
    if(originMs == null) return null;
    var h = +hm[1], mi = +hm[2], se = hm[3] ? +hm[3] : 0;
    if(h > 23 || mi > 59 || se > 59) return null;
    /* UTC, MATCHING Clock.label(). The clock reads the span in UTC; a window
       resolved with local setHours and captioned with getUTCHours names one
       instant and prints another, and only on machines outside UTC — the worst
       kind of defect, because it passes here and fails at a client site. */
    var d = new Date(originMs);
    d.setUTCHours(h, mi, se, 0);
    var t = d.getTime();
    if(t < originMs) t += 86400000;
    return t;
  }
  var abs = Date.parse(s.replace(' ', 'T'));
  return isNaN(abs) ? null : abs;
}

/* How far a declared span may sit from the profiled one before it stops being
   a rounding of the same file and starts being a different file. */
var SPAN_TOLERANCE = 0.05;

/** Rows -> a document, or a refusal that names the row and the reason.
 *  `opts.originMs` / `opts.endMs` come from the profiled span; without them
 *  clock times cannot resolve and windows say so rather than guessing. */
function fromRows(rows, opts){
  opts = opts || {};
  if(!rows || !rows.length) return { ok:false, reason:'the document has no rows below its header' };
  if(!('kind' in rows[0]))
    return { ok:false, reason:'no "kind" column — this is not a Data Doc',
             hint:'Download a Data Doc and edit that; the 17 columns are fixed.' };

  var originMs = opts.originMs == null ? null : +opts.originMs;
  var endMs    = opts.endMs    == null ? null : +opts.endMs;
  var profiledMs = (originMs != null && endMs != null) ? Math.max(1, endMs - originMs) : null;

  var doc = { mode:'', name:'', grain:null, span:null, calendar:null,
              fields:[], measures:[], shapes:[], events:[], limits:[],
              windows:[], opening:'', notes:[], ignored:[] };

  /* The dataset row declares the mode, and the mode declares the shape. A
     document that does not say which of the three it is cannot be checked
     against anything, so it is refused rather than assumed to match whatever
     the UI happens to have selected. */
  var ds = null, dsRow = 0;
  for(var i = 0; i < rows.length; i++){
    if(key(rows[i].kind) === 'dataset'){ ds = rows[i]; dsRow = i + 2; break; }
  }
  if(!ds) return { ok:false, reason:'no dataset row — the document does not say which mode it is',
                   hint:'Every Data Doc opens with a dataset row carrying its mode.' };
  var mode = key(ds.mode);
  if(!mode) return { ok:false, row:dsRow,
                     reason:'row ' + dsRow + ': the dataset row declares no mode',
                     hint:'A different mode is a different document — download the one you want.' };
  if(MODES.indexOf(mode) === -1)
    return { ok:false, row:dsRow,
             reason:'row ' + dsRow + ': "' + norm(ds.mode) + '" is not a mode',
             hint:'The modes are ' + MODES.join(', ') + '.' };

  doc.mode = mode;
  doc.name = norm(ds.name);
  var shape = SHAPE[mode];

  var gs = duration(ds.grain);
  if(norm(ds.grain) && gs == null)
    doc.notes.push('row ' + dsRow + ': the grain "' + norm(ds.grain) +
                   '" could not be read; the profiled grain is used instead');
  else if(gs != null) doc.grain = { label: norm(ds.grain), seconds: gs };

  var sp = duration(ds.span);
  if(norm(ds.span) && sp == null)
    doc.notes.push('row ' + dsRow + ': the span "' + norm(ds.span) +
                   '" could not be read; the profiled span is used instead');
  else if(sp != null) doc.span = { label: norm(ds.span), ms: sp * 1000 };

  /* The opening position rides in the dataset row's `starts` cell — a
     fraction, a ratio, a percentage, a clock time or the name of a window
     declared below. The clock already reads all five; this only carries it. */
  doc.opening = norm(ds.starts);

  /* ── the body ─────────────────────────────────────────────────────────── */
  var BUCKET = { field:'fields', measure:'measures', shape:'shapes',
                 event:'events', limit:'limits', window:'windows' };

  for(var r = 0; r < rows.length; r++){
    var row0 = rows[r], n = r + 2, k = key(row0.kind);
    if(!k) continue;                       /* a spacer line is not a mistake */
    if(k === 'dataset'){
      if(row0 !== ds)
        doc.ignored.push({ row:n, kind:k,
          why:'a second dataset row — a document declares its mode once' });
      continue;
    }
    if(KINDS.indexOf(k) === -1){
      doc.ignored.push({ row:n, kind:norm(row0.kind),
        why:'"' + norm(row0.kind) + '" is not a row kind MOMENTUM knows' });
      continue;
    }
    if(shape.kinds.indexOf(k) === -1){
      doc.ignored.push({ row:n, kind:k,
        why:'a ' + k + ' row has no meaning in ' + mode + ' mode' });
      continue;
    }
    if(k === 'calendar'){
      var cs = instant(row0.starts, originMs), ce = instant(row0.ends, originMs);
      doc.calendar = { name: norm(row0.name) || 'operating hours',
                       starts: norm(row0.starts), ends: norm(row0.ends),
                       startsMs: cs, endsMs: ce };
      continue;
    }
    if(k === 'window'){
      var wn = norm(row0.name);
      if(!wn){ continue; }               /* the template's own empty scaffold */
      var ws = instant(row0.starts, originMs), we = instant(row0.ends, originMs);
      /* Refuse, don't demote: an ambiguous cell is not placed at its first
         occurrence and then reported as fine. It is not placed at all. */
      if(clockOccurrences(row0.starts, originMs, endMs) > 1) ws = null;
      if(clockOccurrences(row0.ends, originMs, endMs) > 1) we = null;
      /* Phase 3C reads `ends`, so a range is checked as a range. ONE reason per
         row: a window with no data attached has one thing wrong with it, not
         two, and saying so twice is noise dressed as thoroughness. */
      var bad = whyBadRange(wn, row0, ws, we, originMs, endMs);
      if(bad) doc.ignored.push({ row:n, kind:k, why: bad });
      doc.windows.push({ name:wn, starts:norm(row0.starts), ends:norm(row0.ends),
                         startsMs:ws, endsMs:we, row:n });
      continue;
    }
    if(k === 'limit'){
      if(!norm(row0.field)) continue;    /* the template's own empty scaffold */
      doc.limits.push({ field:norm(row0.field), context:norm(row0.context),
        correctLow:norm(row0.correct_low), correctHigh:norm(row0.correct_high),
        outLow:norm(row0.out_low), outHigh:norm(row0.out_high),
        persistence:norm(row0.persistence), row:n });
      continue;
    }
    var name = norm(row0.name);
    if(!name) continue;                  /* the template's own empty scaffold */
    doc[BUCKET[k]].push({ name:name, type:norm(row0.type), unit:norm(row0.unit), row:n });
  }

  /* ── can this document do its job? ────────────────────────────────────── */
  var needed = BUCKET[shape.needs];
  if(!doc[needed].length){
    var anything = doc.fields.length + doc.measures.length + doc.shapes.length +
                   doc.events.length + doc.limits.length + doc.windows.length;
    /* The commonest beginner mistake is attaching a blank template unedited.
       It deserves the message that says so, not a general complaint about a
       missing row kind. */
    if(!anything)
      return { ok:false, reason:'this is a blank ' + mode +
               ' template — nothing has been filled in yet',
               hint:'Fill in the ' + shape.needs + ' rows, or download the ' +
                    'example to see what a completed one looks like.' };
    return { ok:false, reason:'a ' + mode + ' document needs at least one ' +
             shape.needs + ' row, and this one declares none',
             hint:'Download a ' + mode + ' Data Doc to see the rows it expects.' };
  }

  /* ── the declared span against the file that is actually here ─────────── */
  if(doc.span && profiledMs){
    var diff = Math.abs(doc.span.ms - profiledMs);
    var grainMs = (doc.grain ? doc.grain.seconds : 1) * 1000;
    if(diff <= grainMs){
      /* Agreement to within one step of the grain. "24 hours" for a file of
         86,399,000 ms is the same statement, and saying so would be noise. */
    } else if(diff / profiledMs <= SPAN_TOLERANCE){
      doc.notes.push('the document declares ' + doc.span.label +
                     '; the attached rows span ' + humanMs(profiledMs) +
                     '. Playing the rows.');
    } else {
      return { ok:false, row:dsRow,
               reason:'the document declares ' + doc.span.label +
                      ', but the attached rows span ' + humanMs(profiledMs) +
                      ' — this may be the wrong file',
               hint:'Attach the data this document describes, or download a ' +
                    'fresh Data Doc for the data that is attached.' };
    }
  }

  return { ok:true, doc:doc, summary:describe(doc) };
}

/* A REFUSAL IS ONLY HONEST IF ITS REASON IS. "15:00" with nothing attached is
   not a malformed time — it is a perfectly good time with no day to land on,
   and telling someone their clock time is invalid sends them to rewrite a cell
   that was already right. The two failures look identical in the code and are
   completely different to the person reading the message. */
function whyNoInstant(name, raw, originMs){
  var v = norm(raw);
  var clockish = /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
  if(clockish && originMs == null)
    return 'window "' + name + '" opens at ' + v + ', but no data is attached yet, ' +
           'so there is no day to place it on \u2014 attach the data and this resolves';
  return 'window "' + name + '" starts at "' + v + '", which is not a time';
}

/* A RANGE IS A RANGE. `starts` alone is still legal — an open window says when
   something begins and lets the day run out on its own, which is what every
   window authored before 3C does. What is checked here is only what an `ends`
   ADDS: that it is readable, that it comes after its start, and that it lands
   inside the data. Ordered so the first true thing is the one reported, and
   the start's own reason keeps precedence — a window with no day to place it
   on has one fault, and it is not the end cell. */
/* HOW MANY TIMES DOES THIS CLOCK TIME HAPPEN IN THE ATTACHED DATA?
   A clock time is placed on the origin's day and wrapped forward if it falls
   before the origin — which is what makes a night shift expressible at all,
   and which is exactly right for a span of about a day.

   On a longer span it stops being right without stopping being silent. On a
   90-day claims cycle "15:00" names ninety instants and the reader was
   quietly picking the first, so a window declared 15:00 to 18:00 became three
   hours on day one — almost certainly not what the author meant, and nothing
   said so.

   Rather than pick a threshold to call a span "long", this counts. A clock
   time is ambiguous when it occurs more than once inside the data, which is
   exact, needs no tolerance, and leaves the ragged mining day alone: 07:00 to
   06:59:59 contains each clock time exactly once, including 07:00 itself. */
function clockOccurrences(v, originMs, endMs){
  var s = norm(v);
  if(!s || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return 0;
  if(originMs == null || endMs == null) return 0;
  var first = instant(s, originMs);
  if(first == null) return 0;
  var n = 0;
  for(var t = first; t <= endMs; t += 86400000){ n++; if(n > 400) break; }
  return n;
}

/* Named, counted, and given the thing that would fix it. A refusal that says
   "ambiguous" without saying what to write instead is a complaint. */
function whyAmbiguousClock(name, cell, raw, originMs, endMs){
  var n = clockOccurrences(raw, originMs, endMs);
  var first = instant(norm(raw), originMs);
  return 'window "' + name + '" ' + cell + ' at ' + norm(raw) +
         ', which happens ' + n + ' times in the attached data \u2014 name the day ' +
         '(for example ' + new Date(first).toISOString().replace('.000', '') +
         ') so there is one instant to ' + (cell === 'opens' ? 'open' : 'close') + ' at';
}

function whyBadRange(name, row0, ws, we, originMs, endMs){
  /* AMBIGUITY IS CHECKED FIRST, because an ambiguous cell is not a bad time —
     it is a good time written where a good time is not enough. Every other
     reason below assumes the cells name single instants. */
  if(clockOccurrences(row0.starts, originMs, endMs) > 1)
    return whyAmbiguousClock(name, 'opens', row0.starts, originMs, endMs);
  if(clockOccurrences(row0.ends, originMs, endMs) > 1)
    return whyAmbiguousClock(name, 'ends', row0.ends, originMs, endMs);
  if(norm(row0.starts) && ws == null) return whyNoInstant(name, row0.starts, originMs);
  if(!norm(row0.ends)) return null;                 /* an open window is fine */
  if(we == null) return whyNoEnd(name, row0.ends, originMs);
  if(ws == null) return null;   /* no start to compare against; nothing to say */
  if(we === ws)
    return 'window "' + name + '" ends at the same instant it starts (' +
           norm(row0.ends) + ') \u2014 a window with no duration cannot be entered';
  if(we < ws)
    return 'window "' + name + '" ends at ' + norm(row0.ends) +
           ', which is before it starts at ' + norm(row0.starts) +
           ' \u2014 a window that crosses midnight needs the day named, not just the hour';
  /* Ragged spans are the rule, not the exception: the mining file is 86,399,000
     ms, one second short of a day. So this compares against the data's own end
     rather than against a round number it was never going to reach. */
  if(endMs != null && we > endMs)
    return 'window "' + name + '" ends at ' + norm(row0.ends) +
           ', which is past the end of the attached data (' + Clockish(endMs) + ')';
  return null;
}

/* The sibling of whyNoInstant for the end cell. Same distinction, same reason
   it exists: a good time with no day to land on is not a bad time. */
function whyNoEnd(name, raw, originMs){
  var v = norm(raw);
  var clockish = /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
  if(clockish && originMs == null)
    return 'window "' + name + '" ends at ' + v + ', but no data is attached yet, ' +
           'so there is no day to place it on \u2014 attach the data and this resolves';
  return 'window "' + name + '" ends at "' + v + '", which is not a time';
}

/* UTC on both sides. Session 6 fixed a local/UTC split that passed in the
   sandbox and would have failed at any client site outside UTC. */
function Clockish(ms){
  var d = new Date(ms);
  var p = function(x){ return (x < 10 ? '0' : '') + x; };
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

function humanMs(ms){
  var sec = Math.round(ms / 1000);
  if(sec < 5400)   return Math.max(1, Math.round(sec / 60)) + ' minutes';
  if(sec < 172800) return (Math.round(sec / 360) / 10) + ' hours';
  return (Math.round(sec / 8640) / 10) + ' days';
}

/** One line a person can check at a glance: what applied, and what did not. */
function describe(doc){
  var bits = [SHAPE[doc.mode] ? SHAPE[doc.mode].label.toLowerCase() : doc.mode];
  [['fields','field'],['measures','measure'],['shapes','shape'],
   ['events','event'],['limits','limit'],['windows','window']].forEach(function(p){
    var n = doc[p[0]].length;
    if(n) bits.push(n + ' ' + p[1] + (n === 1 ? '' : 's'));
  });
  if(doc.opening) bits.push('opens at ' + doc.opening);
  var line = bits.join(' \u00b7 ');
  if(doc.ignored.length)
    line += ' \u00b7 ' + doc.ignored.length + ' row' +
            (doc.ignored.length === 1 ? '' : 's') + ' ignored';
  return line;
}

/** Text of a delimited Data Doc. `#` opens a comment, exactly as it does in a
 *  Config Doc — one convention across every document MOMENTUM reads. */
function fromDelimited(text, sep){
  var lines = String(text).split(/\r?\n/)
    .filter(function(l){ return l.trim() && l.trim().charAt(0) !== '#'; });
  if(!lines.length) return [];
  var cut = function(line){
    var out = [], cur = '', q = false;
    for(var i = 0; i < line.length; i++){
      var c = line.charAt(i);
      if(c === '"'){ if(q && line.charAt(i + 1) === '"'){ cur += '"'; i++; } else q = !q; }
      else if(c === sep && !q){ out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  var head = cut(lines[0]).map(function(h){ return String(h || '').trim().toLowerCase(); });
  return lines.slice(1).map(function(l){
    var cells = cut(l), o = {};
    head.forEach(function(h, i){ if(h) o[h] = cells[i] == null ? '' : String(cells[i]).trim(); });
    return o;
  });
}

function parse(text, filename, opts){
  var ext = String(filename || '').toLowerCase().split('.').pop();
  if(ext !== 'csv' && ext !== 'tsv')
    return { ok:false, reason:'a Data Doc is .xlsx, .csv or .tsv, not .' + ext };
  var rows = fromDelimited(text, ext === 'tsv' ? '\t' : ',');
  if(!rows.length) return { ok:false, reason:'the document has no rows below its header' };
  return fromRows(rows, opts);
}

MOMENTUM.DataDoc = {
  version: 1, HEAD: HEAD, KINDS: KINDS, MODES: MODES, SHAPE: SHAPE,
  availability: availability, modes: modes,
  templateRows: templateRows, guide: guide,
  fromRows: fromRows, parse: parse, fromDelimited: fromDelimited,
  duration: duration, instant: instant, describe: describe,
  SPAN_TOLERANCE: SPAN_TOLERANCE
};

})();
