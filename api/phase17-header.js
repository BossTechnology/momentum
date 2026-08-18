/* ═══════════════════════════════════════════════════════════════════════════
   The header, globally — five bands, and badges that MOVE

   Two things were wrong with the first version.

   The badges counted CONFIGURATION. Alarms sat at 9 permanently because nine
   conditions existed, whether or not anything had happened — a number that
   never changes is one people stop seeing. They now count EVENTS from the risk
   log, so a badge rises when something breaks and falls when it recovers. The
   log has recorded both transitions since it was built; the badge was simply
   reading the wrong source.

   And the modal was one band where BOb has five: summary pills that filter,
   health, most urgent, pattern recognition, root cause. Every band renders even
   at zero — a section that appears only when populated is a section nobody
   knows exists.

   Anomalies span the JOURNEY as well as the results. Detection is local to
   wherever data flows, so stages carry it too; walking only KBRS meant half the
   product could not reach a counter that is supposed to be global.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function kbrs(){ try { return KBRS || []; } catch(e){ return []; } }
function stages(){ try { return journeyStages || []; } catch(e){ return []; } }
function log(){ return (window.MOMENTUM && MOMENTUM.RiskLog) || null; }
function fmt(v){
  if(v == null || !isFinite(v)) return '\u2014';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 10000) / 10000);
}
function clock(ms){
  var d = new Date(ms);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

/* ═══ 0b · what is bound, and over what stretch of time ════════════════════
   Both questions already have owners elsewhere and neither is re-answered
   here. Binding is MOMENTUM.Bind; the range is the ONE select in the header,
   read through the same rangeKey() the results read. This surface has no
   time control of its own and must not grow one — two dropdowns disagreeing
   about the period is worse than no period at all. */

function bound(){
  try { return !!(window.MOMENTUM && MOMENTUM.Bind && MOMENTUM.Bind.active()); }
  catch(e){ return false; }
}

/* Whether there is anything at all to describe.
   ────────────────────────────────────────────
   This used to be `!bound()` — greyed unless a workbook was attached. That
   read "nothing bound" too literally. A board with an industry applied has
   channels, conditions, touchpoints and declared rules, and its simulation
   is producing live events; greying all of that out because no spreadsheet
   was attached hid real activity behind em dashes and left every badge dark
   on a board that was plainly doing something.

   The empty state is for a board with nothing on it — no configuration and
   nothing happening. That is what teaches its own shape. Once there is
   either, the numbers are real and get shown. */
function emptyBoard(){
  if(configuredOf(null).length) return false;
  if(watchedRules().length) return false;
  if(liveEvents(null).length) return false;
  if(anomalies(false).length) return false;
  return true;
}
function rangeNow(){
  /* `rangeKey()` belongs to the Bind IIFE and is not visible from this one —
     testing `typeof rangeKey === 'function'` here returned false every time
     and this quietly reported "Now" no matter what the select said. Exactly
     the silent cross-scope failure the house rule warns about.

     `currentTimeRange` is a script-level `let`, so it is reachable by NAME
     across scripts even though it is not a window property. Read by name,
     in a try, which is what Bind's own rangeKey does. */
  var key = 'now';
  try { key = currentTimeRange || 'now'; } catch(e){}
  var mode = null;
  try { mode = (typeof RANGE_MODE !== 'undefined') && RANGE_MODE[key]; } catch(e){}
  return { key:key, label:(mode && mode.label) || 'Now', desc:(mode && mode.desc) || '' };
}

/** The period, spelled out. "Now · 17:24" reads differently from "This Week",
 *  and a reader who cannot see which one is on screen cannot judge the
 *  numbers beside it. */
function rangeCaption(){
  var r = rangeNow();
  if(r.key === 'now') return r.label + ' \u00b7 ' + clock(Date.now());
  var w = null;
  try { w = MOMENTUM.Bind && MOMENTUM.Bind.windowFor && MOMENTUM.Bind.windowFor(r.key); }
  catch(e){}
  if(!w) return r.label;
  var a = new Date(w.fromMs), b = new Date(w.toMs);
  var d = function(x){ return x.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun',
                        'Jul','Aug','Sep','Oct','Nov','Dec'][x.getMonth()]; };
  return r.label + ' \u00b7 ' + (r.key === 'today'
    ? d(a) + ', 00:00\u2013' + clock(w.toMs)
    : d(a) + '\u2013' + d(b));
}

/* ═══ 0c · configuration, which is not an occurrence ═══════════════════════
   Configured and Routed are read from the condition registry, not counted
   from things that happened. A result with two alarms declared has two
   alarms whether or not either has ever fired, and saying so is the whole
   point of the pill — it tells a reader what SHOULD be watching them. */

function allConditions(){
  var RM = (window.MOMENTUM && MOMENTUM.RiskUI) || null;
  if(!RM || !RM.conditionsOf) return [];
  var out = [];
  kbrs().forEach(function(k){
    try { RM.conditionsOf(k).forEach(function(c){ out.push(c); }); } catch(e){}
  });
  return out;
}
function configuredOf(responseKind){
  return allConditions().filter(function(c){
    if(c.enabled === false) return false;
    return responseKind ? c.response === responseKind : true;
  });
}
/** A response that names a channel is one that can reach somebody. */
function routedOf(responseKind){
  return configuredOf(responseKind).filter(function(c){
    if((c.channels || []).length) return true;
    return (c.responses || []).some(function(r){ return (r.channels || []).length; });
  });
}
/** Declared Known Unknowns across every host. A watch, never an occurrence. */
function watchedRules(){
  var A = window.MOMENTUM && MOMENTUM.Anomalies;
  if(!A) return [];
  var out = [];
  stages().concat(kbrs()).forEach(function(h){
    try { A.knownRules(h).forEach(function(r){ out.push(r); }); } catch(e){}
  });
  return out;
}
/** Responses attached to ANOMALY configuration — the known rules' own
 *  responses plus the severity buckets. Counting every routed condition here
 *  would have reported threshold plumbing as an answer to an anomaly. */
function anomalyResponses(){
  var n = 0;
  watchedRules().forEach(function(k){
    n += ((k.rule && k.rule.responses) || []).filter(function(r){
      return (r.channels || []).length; }).length;
  });
  kbrs().forEach(function(k){
    var u = k.riskAnomalies;
    if(!u) return;
    Object.keys(u).forEach(function(sev){
      n += (u[sev] || []).filter(function(r){ return (r.channels || []).length; }).length;
    });
  });
  return n;
}

/* ═══ 1 · events, not configuration ════════════════════════════════════════ */

function events(){
  var L = log(); if(!L) return [];
  var out = [];
  kbrs().forEach(function(k){
    L.entriesFor(k.id).forEach(function(e){
      out.push({ kbr:k.name, kind:e.kind, label:e.label, at:e.at, value:e.value,
                 threshold:e.threshold, unit:e.unit, response:e.response,
                 channels:e.channels || [] });
    });
  });
  return out.sort(function(a,b){ return b.at - a.at; });
}

/** Fired and not since recovered. A recovered condition leaves the count. */
function liveEvents(responseKind){
  var seen = {}, live = [];
  events().slice().reverse().forEach(function(e){
    var key = e.kbr + '|' + e.label;
    if(e.kind === 'breach') seen[key] = e; else delete seen[key];
  });
  Object.keys(seen).forEach(function(k){
    var e = seen[k];
    if(!responseKind || e.response === responseKind) live.push(e);
  });
  return live.sort(function(a,b){ return b.at - a.at; });
}
function recoveries(){ return events().filter(function(e){ return e.kind === 'recovered'; }); }

/* ═══ 2 · anomalies span the journey too ═══════════════════════════════════ */

function anomalies(withWatched){
  var A = window.MOMENTUM && MOMENTUM.Anomalies;
  if(!A) return [];
  var out = [], seen = {};
  kbrs().forEach(function(k){
    A.detections(k).forEach(function(d){
      var key = d.label + '|' + d.entity;
      if(seen[key]){ seen[key].scopes.push(k.name); return; }
      var it = { title:d.label, tone:d.severity, origin:'found', scopes:[k.name],
                 detail:d.entity + ' \u00b7 expected excess ' + (d.excess*100).toFixed(2) + '%' };
      seen[key] = it; out.push(it);
    });
  });
  out.forEach(function(it){
    it.scope = it.scopes.length > 1 ? 'all results' : it.scopes[0];
    delete it.scopes;
  });
  /* Declared rules are a WATCH, not an occurrence, and the two must not be
     added together. Counting them in the badge meant that writing a rule in
     the Risk Meter made the header report an anomaly the moment it was
     saved — nothing had happened, somebody had merely said what to look for.
     They still belong in the modal, under their own pill. */
  if(!withWatched) return out;
  var hosts = stages().map(function(s){ return { name:s.name || 'Stage', host:s }; })
            .concat(kbrs().map(function(k){ return { name:k.name, host:k }; }));
  hosts.forEach(function(h){
    A.knownRules(h.host).forEach(function(k){
      var r = k.rule;
      var how = r.condition === 'frequency'
          ? '"' + (r.keywords||'') + '" more than ' + (r.freqThresh||5) + ' times'
        : r.condition === 'pattern' ? (r.keywords || 'a described pattern')
        : 'contains ' + (r.keywords || '\u2014');
      out.push({ title:r.name || 'Untitled rule', detail:how + ' \u00b7 ' + k.tp,
                 tone:'warning', origin:'watched', scope:h.name });
    });
  });
  return out;
}

/* ═══ 3 · counters ═════════════════════════════════════════════════════════ */

var openKind = null, activeFilter = 'all';
var KINDS = ['anomalies','alerts','alarms','actions'];
/* ═══ 4c · the head ════════════════════════════════════════════════════════
   A tinted tile, a real title, and one line saying what the panel is for.
   The old head led with a 30px number and a small-caps label, which named
   the thing but never explained it — and the number is redundant beside the
   pills that follow, which carry it broken down.

   Tints are BOb's, because these four now read as a family across both
   products. The subtitles are NOT BOb's: they describe what MOMENTUM
   actually reports, which is conditions and touchpoints rather than
   aggregated threshold traffic.

   The period sits to the RIGHT of the title after a vertical rule. Worth
   noting because BOb has no period in its head at all — building this head
   from the reference alone would have quietly dropped it. */
var KIND = {
  anomalies:{ title:'Anomaly Intelligence',
              sub:'Known and unknown unknowns \u00b7 detection across every touchpoint',
              tint:'#F1DEC4', edge:'#C9A876' },
  alerts:   { title:'Alert Intelligence',
              sub:'Threshold conditions \u00b7 what crossed, by how much, and for how long',
              tint:'#F0D4D4', edge:'#D8564F' },
  alarms:   { title:'Alarm Intelligence',
              sub:'Broadcast conditions \u00b7 who was told, and through which channel',
              tint:'#FFF8DE', edge:'#C4A265' },
  actions:  { title:'Action Intelligence',
              sub:'Programmatic responses \u00b7 webhooks and API calls on breach',
              tint:'#E8F0FE', edge:'#4A6FA5' }
};
var GLYPH = {
  anomalies:'<img class="gm-ico-img" src="data:image/png;base64,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" alt="">',
  alerts:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  alarms:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>',
  actions:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
};

var CAP = { anomalies:'Anomalies', alerts:'Alerts', alarms:'Alarms', actions:'Actions' };

/** What the BADGE counts: occurrences, never declarations. */
function collect(kind){
  if(kind === 'anomalies') return anomalies(false);
  var live = liveEvents(kind === 'alerts' ? null : (kind === 'alarms' ? 'alarm' : 'action'));
  return live.map(function(e){
    return { title:e.label, scope:e.kbr, at:e.at, tone:'critical', origin:'fired',
             channels:e.channels,
             detail:'crossed ' + fmt(e.threshold) + (e.unit ? ' ' + e.unit : '') +
                    (e.value != null ? ' \u00b7 value ' + fmt(e.value) : '') };
  });
}
/** What the MODAL lists: occurrences plus the watches, which it can separate. */
function collectAll(kind){
  return kind === 'anomalies' ? anomalies(true) : collect(kind);
}

/* THE LOG MUST BE DRIVEN, not waited on.

   `LOG.evaluate` was called in exactly one place — when the Alerts tab
   rendered. So unless somebody opened that tab, no transition was ever
   recorded, and a header reading the log had nothing to read. The badge could
   still show a number (anomalies are computed live, not logged), which is why
   clicking one opened a modal with a count in its title and nothing beneath
   it: two surfaces reading two different sources.

   The header is the surface people glance at without clicking, so it drives
   the evaluation itself, every refresh, for every result. */
function driveLog(){
  var L = log(), RM = (window.MOMENTUM && MOMENTUM.RiskUI) || null;
  if(!L || !RM || !RM.conditionsOf) return;
  kbrs().forEach(function(k){
    try { L.evaluate(k, RM.ensureConditionIds(RM.conditionsOf(k))); } catch(e){}
  });
}

function refreshHeaderCounts(){
  driveLog();
  /* An open modal must follow the counts rather than freeze at open time. */
  if(openKind) render();
  KINDS.forEach(function(kind){
    var el = document.getElementById('hdr' + CAP[kind] + 'Badge');
    if(!el) return;
    /* No cap. A count of 1,240 is reported as 1,240 — a "99+" tells a reader
       that something is wrong without telling them how wrong, which is the
       one thing a counter exists to do. The badge grows sideways out of the
       corner (see .hdr-icon-badge) so four digits do not bury the glyph the
       way BOb's fixed-width badge does.

       Unbound, the icons stay dark. There are no occurrences to report and a
       zero drawn in red is still a red mark in the corner of the eye. */
    var n = emptyBoard() ? 0 : collect(kind).length;
    el.textContent = n > 0 ? String(n) : '';
    el.classList.toggle('show', n > 0);
    el.classList.toggle('gm-badge-wide', n > 99);
    var btn = document.getElementById('hdr' + CAP[kind] + 'Btn');
    if(btn) btn.setAttribute('title', n > 0
      ? n + ' ' + (n === 1 ? CAP[kind].replace(/s$/,'') : CAP[kind])
      : 'No ' + CAP[kind].toLowerCase());
  });
}
window.refreshHeaderCounts = refreshHeaderCounts;

/* ═══ 4 · the five bands ═══════════════════════════════════════════════════ */



function band(title, body){
  return '<div class="gm-band"><div class="gm-band-t">' + esc(title) + '</div>' + body + '</div>';
}

/* ═══ 4b · the summary, one vocabulary per kind ════════════════════════════
   One generic triple used to serve three of the four kinds — Live, Recovered,
   Routed — which said the same thing about an alarm as about an action, and
   the two are not the same thing at all. BOb names a LIFECYCLE instead, and
   the lifecycle differs by kind: an alarm is configured and then triggers, an
   action is configured and then executes, an anomaly is active and then
   resolves. That is what makes its modals read as organised.

   Adopted here with MOMENTUM's own arithmetic, which differs on one point
   worth stating. BOb's figures are session odometers: 3,150 warnings and
   1,718 recovered only ever climb, so a reader cannot tell whether anything
   is getting better. MOMENTUM's live count is already state-folded — a
   recovery removes the open breach rather than adding to a tally — so it
   falls when something is fixed. The vocabulary is BOb's; the counting is
   not, and deliberately so.

   Configured and Routed come from the condition registry rather than from
   the log, so they are true before anything has ever fired. That is what
   makes the unbound board legible: every pill present, every label readable,
   nothing invented. */

var PILLS = {
  alerts: function(){
    var live = liveEvents(null);
    var crit = live.filter(function(e){ return sev(e) === 'critical'; });
    return [['critical',  crit.length,               'Critical'],
            ['warning',   live.length - crit.length, 'Warning'],
            ['recovered', recoveries().length,       'Recovered'],
            ['responses', routedOf(null).length,     'Responses']];
  },
  alarms: function(){
    return [['configured', configuredOf('alarm').length,      'Configured'],
            ['all',        liveEvents('alarm').length,        'Triggered'],
            ['responses',  routedOf('alarm').length,          'Responses']];
  },
  actions: function(){
    return [['configured', configuredOf('action').length,     'Configured'],
            ['all',        liveEvents('action').length,       'Executed'],
            ['responses',  routedOf('action').length,         'Responses']];
  },
  anomalies: function(){
    var found = anomalies(false);
    return [['all',       found.length,            'Active'],
            ['watched',   watchedRules().length,   'Watched for'],
            ['recovered', 0,                       'Resolved'],
            ['responses', anomalyResponses(),      'Responses']];
  }
};

/** Severity of a live breach, through the engine rather than a second rule. */
function sev(e){
  var R = window.MOMENTUM && MOMENTUM.Risk;
  if(e && e.severity) return e.severity;
  if(R && R.deriveSeverity && e && e.ticks != null){
    try { return R.deriveSeverity(e.ticks, e.value, e.threshold); } catch(x){}
  }
  return e && e.response === 'alarm' ? 'critical' : 'warning';
}

/* The header carries the selected period, which raises a question the counts
   cannot yet answer: are they FOR that period? Not yet. The log is a rolling
   in-memory buffer that begins at page load, so a week's history is not in
   it and cannot be counted from it. Deriving those figures across the window
   from the Generator is the next piece of work.

   Until then this says so, in one line, rather than letting a label reading
   "This Week" imply a week of counting. A number that quietly means
   something other than what it is captioned is worse than no number. */
function scopeNote(){
  if(emptyBoard())
    return '<div class="gm-scope">Nothing configured and nothing happening \u2014 the shape of the ' +
           'answer, with nothing behind it yet. Choose an industry, or attach a Config Doc.</div>';
  var src = bound() ? '' :
    ' Figures are from the running simulation; attach a Data Doc to read them from real data.';
  var r = rangeNow();
  if(r.key === 'now')
    return '<div class="gm-scope">Open right now. Falls as conditions recover.' + src + '</div>';
  return '<div class="gm-scope">Counting what is open right now \u2014 not yet the whole of ' +
         esc(r.label.toLowerCase()) + '.' + src + '</div>';
}

/* Tone, not decoration. A recovered count and a critical count are different
   kinds of news and reading them in the same black made the row flat — the
   eye had to parse four labels before learning anything. BOb's scheme:
   critical red, warning amber, recovered green, everything configured or
   routed in the accent blue. */
var TONE = {
  critical:  { edge:'#D8564F', num:'#D8564F' },
  warning:   { edge:'#C4A265', num:'#A68B52' },
  recovered: { edge:'#3E9E6B', num:'#3E9E6B' },
  responses: { edge:'#4A6FA5', num:'#4A6FA5' },
  configured:{ edge:'#4A6FA5', num:'#141414' },
  watched:   { edge:'#C9A876', num:'#141414' },
  all:       { edge:'#141414', num:'#141414' }
};

function summaryPills(kind){
  var rows = (PILLS[kind] || PILLS.alerts)();
  var off = emptyBoard();
  return '<div class="gm-pills' + (off ? ' gm-pills-off' : '') + '">' +
    rows.map(function(p){
      /* Unbound, every pill still renders — labelled, greyed, with an em dash
         where the number will be. A reader learns the shape of the answer
         before there is data to fill it, which is the only useful thing an
         empty board can do. */
      var n = off ? '\u2014' : p[1];
      var t = TONE[p[0]] || TONE.all;
      return '<button class="gm-pill' + (activeFilter===p[0]?' on':'') + '"' +
        (off ? ' disabled' : ' style="border-color:' + t.edge + '"') +
        ' data-filter="' + p[0] + '">' +
        '<span class="gm-pill-n"' + (off ? '' : ' style="color:' + t.num + '"') + '>' + n + '</span>' +
        '<span class="gm-pill-l">' + esc(p[2]) + '</span></button>';
    }).join('') + '</div>';
}

/* Per-KBR health, plus any stage that actually contributed — all nineteen
   stages would bury the results they sit beside. */
function healthBand(items){
  var cards = kbrs().map(function(k){
    var n = liveEvents(null).filter(function(e){ return e.kbr === k.name; }).length;
    return { name:k.name, n:n, tone:n===0?'ok':(n>2?'crit':'warn') };
  });
  var contributing = {};
  items.forEach(function(i){ if(i.origin==='watched') contributing[i.scope] = 1; });
  stages().forEach(function(s){
    if(contributing[s.name]) cards.push({ name:s.name, n:0, tone:'ok', sub:'journey' });
  });
  return band('Result health', cards.length
    ? '<div class="gm-cards">' + cards.map(function(c){
        return '<div class="gm-card gm-' + c.tone + '"><div class="gm-card-n">' +
          (c.n===0?'clear':c.n) + '</div><div class="gm-card-l">' + esc(c.name) + '</div>' +
          (c.sub?'<div class="gm-card-s">' + esc(c.sub) + '</div>':'') + '</div>';
      }).join('') + '</div>'
    : '<div class="gm-none">No results configured.</div>');
}

function urgentBand(items){
  var top = items.slice(0,5);
  return band('Most urgent', top.length
    ? top.map(function(it){
        return '<div class="gm-row"><span class="gm-tag gm-' + esc(it.tone) + '">' +
          esc(it.tone) + '</span><div class="gm-main"><div class="gm-title">' + esc(it.title) +
          '</div><div class="gm-detail">' + esc(it.detail||'') + '</div></div>' +
          '<div class="gm-kbr">' + esc(it.scope||'') + '</div>' +
          (it.at?'<div class="gm-when">' + clock(it.at) + '</div>':'') + '</div>';
      }).join('')
    : '<div class="gm-none">Nothing is firing.</div>');
}

/* Findings the list itself cannot show: repetition, concentration, flapping. */
function patternBand(kind, items){
  var out = [], byName = {};
  items.forEach(function(i){ byName[i.title] = (byName[i.title]||0) + 1; });
  var top = Object.keys(byName).sort(function(a,b){ return byName[b]-byName[a]; })[0];
  if(top && byName[top] > 1)
    out.push(['Repeating', esc(top) + ' appears ' + byName[top] +
      ' times \u2014 a repeated finding is usually one cause, not several.', 'frequency']);
  var crit = items.filter(function(i){ return i.tone==='critical'; }).length;
  if(crit > 2)
    out.push(['Several critical', crit + ' critical findings are open at once. Peak-time ' +
      'suppression may be worth enabling if these cluster in known busy windows.', 'severity']);
  var rec = recoveries().length;
  if(kind !== 'anomalies' && rec > 4 && rec > items.length * 2)
    out.push(['Flapping', rec + ' recoveries against ' + items.length + ' live \u2014 conditions are ' +
      'firing and clearing repeatedly rather than staying broken.', 'stability']);
  return band('Pattern recognition', out.length
    ? out.map(function(p){
        return '<div class="gm-pat"><div class="gm-pat-t">' + esc(p[0]) + '</div>' +
          '<div class="gm-pat-d">' + p[1] + '</div><span class="gm-chip">' + esc(p[2]) + '</span></div>';
      }).join('')
    : '<div class="gm-none">No patterns yet.</div>');
}

/* Bound, the incident script names real causes with measured excess — far
   better evidence than co-occurrence. Unbound, fall back to what BOb does. */
function rootCauseBand(items){
  var body = '';
  try {
    if(window.MOMENTUM && MOMENTUM.Bind && MOMENTUM.Bind.active()){
      var prof = MOMENTUM.Bind.profile();
      var cases = (prof && prof.incidentScript && prof.incidentScript.cases) || [];
      var fam = {};
      cases.forEach(function(c){
        if(!c.expectedExcess) return;              /* the decoy carries none */
        var f = /filtro(s)? (de aire|#1 y #3)/i.test(c.label)
              ? 'Saturaci\u00f3n de filtro de aire' : c.label;
        fam[f] = fam[f] || { n:0, ex:0, units:[] };
        fam[f].n++; fam[f].ex += c.expectedExcess; fam[f].units.push(c.entity);
      });
      var ranked = Object.keys(fam).sort(function(a,b){ return fam[b].ex - fam[a].ex; });
      if(ranked.length){
        var t = fam[ranked[0]];
        body = '<div class="gm-pat"><div class="gm-pat-t">' + esc(ranked[0]) + '</div>' +
          '<div class="gm-pat-d">Leads on summed expected excess at ' + (t.ex*100).toFixed(2) + '%' +
          (t.n > 1 ? ', and is the only cause appearing on more than one unit (' +
                     esc(t.units.join(', ')) + ')' : ' on ' + esc(t.units[0])) +
          '.</div><span class="gm-chip">from the bound data</span></div>';
      }
    }
  } catch(e){}
  if(!body){
    var byScope = {};
    items.forEach(function(i){ if(i.scope) byScope[i.scope] = (byScope[i.scope]||0) + 1; });
    var worst = Object.keys(byScope).sort(function(a,b){ return byScope[b]-byScope[a]; })[0];
    body = (worst && byScope[worst] > 1)
      ? '<div class="gm-pat"><div class="gm-pat-t">' + esc(worst) + '</div><div class="gm-pat-d">' +
        'Accounts for ' + byScope[worst] + ' of ' + items.length + ' findings. Co-occurrence points ' +
        'at a shared upstream cause rather than isolated faults.</div>' +
        '<span class="gm-chip">co-occurrence</span></div>'
      : '<div class="gm-none">Not enough signal to attribute a cause. Attach a data document ' +
        'and this reads the incident evidence directly.</div>';
  }
  return band('Root cause analysis', body);
}

/* ═══ 5 · the modal ════════════════════════════════════════════════════════ */

function openGlobal(kind){ openKind = kind; activeFilter = 'all'; render(); }

function render(){
  var kind = openKind, all = collectAll(kind), items = all;
  if(activeFilter === 'found')     items = all.filter(function(i){ return i.origin==='found'; });
  if(activeFilter === 'watched')   items = all.filter(function(i){ return i.origin==='watched'; });
  if(activeFilter === 'configured')items = [];
  if(activeFilter === 'responses') items = all.filter(function(i){ return (i.channels||[]).length; });
  if(activeFilter === 'recovered') items = recoveries().map(function(e){
    return { title:e.label, scope:e.kbr, at:e.at, tone:'ok', detail:'returned within threshold' };
  });

  var bg = document.getElementById('globalModalBg');
  if(!bg){
    bg = document.createElement('div');
    bg.id = 'globalModalBg'; bg.className = 'gm-bg';
    bg.addEventListener('click', function(e){ if(e.target === bg) closeGlobal(); });
    document.body.appendChild(bg);
  }
  var K = KIND[kind] || KIND.alerts;
  bg.innerHTML =
    '<div class="gm-panel" role="dialog" aria-label="' + esc(K.title) + '">' +
      '<div class="gm-head">' +
        '<div class="gm-ico" style="background:' + K.tint + ';color:' + K.edge + '">' +
          GLYPH[kind] + '</div>' +
        '<div class="gm-info">' +
          '<h3>' + esc(K.title) +
            '<span class="gm-range">' + esc(rangeCaption()) + '</span></h3>' +
          '<p>' + esc(K.sub) + '</p>' +
        '</div>' +
        '<button class="gm-x" id="gmClose" aria-label="Close">&#x2715;</button></div>' +
      '<div class="gm-body">' +
        band('Summary', summaryPills(kind) + scopeNote()) +
        healthBand(all) + urgentBand(items) +
        patternBand(kind, all) + rootCauseBand(all) +
      '</div></div>';
  bg.querySelector('#gmClose').addEventListener('click', closeGlobal);
  bg.querySelectorAll('[data-filter]').forEach(function(el){
    el.addEventListener('click', function(){
      activeFilter = el.getAttribute('data-filter'); render();
    });
  });
  bg.classList.add('open');
}
function closeGlobal(){
  var bg = document.getElementById('globalModalBg');
  if(bg) bg.classList.remove('open');
  openKind = null;
}
window.openGlobal = openGlobal;
window.closeGlobal = closeGlobal;
window.headerLiveEvents = liveEvents;

document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeGlobal(); });
document.addEventListener('DOMContentLoaded', function(){
  refreshHeaderCounts();
  setInterval(refreshHeaderCounts, 4000);
});

})();
