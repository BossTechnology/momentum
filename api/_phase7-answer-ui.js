/* ═══════════════════════════════════════════════════════════════════════════
   Phase 7 · Answer Engine surface                          (Build Spec §6, §7)

   The engine is MOMENTUM.Answer. This file is the surface: the Configuration
   tab the panel never had, the per-answer format that ends the KBR's claim on
   it, the flag that stays local, and the quiet link that hands escalation to
   the Risk Meter.

   Optionality is held here rather than asserted. `aeAnswer` is wrapped, not
   replaced: with no profile bound the wrapper returns the original object
   untouched, so an unbound board renders the values Simulation_19 rendered,
   character for character. The computed value only ever arrives when an
   answer carries a query AND that query resolves against a bound profile.

   Hash-seeded stability survives too. The seeded history is a SHAPE on a 0..1
   axis, not a scale, so anchoring the head of it to a real reading changes
   what the answer says without changing how it moves. An answer does not jump
   when it starts reading real data — it keeps its drift and gains a value.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

function A(){ return (window.MOMENTUM && MOMENTUM.Answer) || null; }
function boundProfile(){
  if(!window.MOMENTUM || !MOMENTUM.Bind || !MOMENTUM.Bind.active()) return null;
  return MOMENTUM.Bind.profile ? MOMENTUM.Bind.profile() : null;
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* ═══ 1 · resolve one answer against the bound profile ═════════════════════ */

/** The computed reading for an answer, or null when there is nothing to read.
 *  Null is the Optionality path and is the common case on an unbound board. */
function computed(kbr, tp){
  var ans = A(), P = boundProfile();
  if(!ans || !P || !tp || !tp.query) return null;
  var r = ans.resolve(P, tp.query);
  return (r && r.ok) ? r : null;
}
window.aeComputed = computed;

/* ═══ 2 · wrap aeAnswer — the pool closes, the drift stays ═════════════════ */

if(typeof window.aeAnswer === 'function' && !window.aeAnswer.__phase7){
  var original = window.aeAnswer;
  var wrapped = function(kbr, tp){
    var base = original(kbr, tp);
    var r = computed(kbr, tp);
    if(!r) return base;                       /* ← Optionality. Untouched.  */
    base.value    = r.display;
    base.kind     = r.kind;
    base.format   = r.format;
    base.computed = true;
    base.evidence = r.evidence;
    base.member   = r.member;
    base.magnitude = r.magnitude;
    return base;                              /* history/trend unchanged     */
  };
  wrapped.__phase7 = true;
  window.aeAnswer = wrapped;
}

/* ═══ 3 · the Configuration tab ════════════════════════════════════════════ */

/* switchAnswerTab predates this pane, so it is extended rather than edited. */
if(typeof window.switchAnswerTab === 'function' && !window.switchAnswerTab.__phase7){
  var prevSwitch = window.switchAnswerTab;
  var sw = function(tab){
    if(tab === 'config'){
      ['aePaneActivity','aePaneTouchpoints','aePaneBobby','aePaneConfig'].forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.classList.toggle('active', id === 'aePaneConfig');
      });
      ['aeTabActivity','aeTabTouchpoints','aeTabBobby','aeTabConfig'].forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.classList.toggle('active', id === 'aeTabConfig');
      });
      renderAnswerConfig();
      return;
    }
    var cfgPane = document.getElementById('aePaneConfig'),
        cfgTab  = document.getElementById('aeTabConfig');
    if(cfgPane) cfgPane.classList.remove('active');
    if(cfgTab)  cfgTab.classList.remove('active');
    return prevSwitch(tab);
  };
  sw.__phase7 = true;
  window.switchAnswerTab = sw;
}

function activeKbr(){
  try { return KBRS.find(function(k){ return k.id === activeAnswerId; }) || null; }
  catch(e){ return null; }
}

var FORMAT_LABELS = { currency:'Currency', count:'Count',
                      percentage:'Percentage', time:'Time' };

function renderAnswerConfig(){
  var box = document.getElementById('aeCfgContainer'); if(!box) return;
  var kbr = activeKbr(), ans = A();
  if(!kbr || !ans){ box.innerHTML = ''; return; }
  var list = (typeof kbrAnswers === 'function') ? kbrAnswers(kbr)
                                                : (kbr.answers || []);
  ans.migrateAll(kbr);                               /* S3 · auto-wrap      */

  if(!list.length){
    box.innerHTML = '<div class="ae-empty"><p>No answers configured yet</p>' +
      '<p class="sub">Add an answer in the Touchpoints tab, then set its format, ' +
      'its flag and its route to the Risk Meter here.</p></div>';
    return;
  }

  var P = boundProfile();

  /* Answers that READ DATA lead. The list was in creation order, so a board
     carrying five declared mining answers opened on three unbound retail
     placeholders and buried the ones doing the work below the fold. Order is
     display only — the underlying array is untouched, so nothing that
     addresses an answer by position is disturbed. */
  var order = list.map(function(tp, i){ return { tp:tp, i:i }; });
  order.sort(function(a, b){
    var ra = computed(kbr, a.tp) ? 0 : (a.tp.query ? 1 : 2);
    var rb = computed(kbr, b.tp) ? 0 : (b.tp.query ? 1 : 2);
    return (ra - rb) || (a.i - b.i);
  });
  list = order.map(function(o){ return o.tp; });

  var rows = list.map(function(tp, i){
    var r    = computed(kbr, tp);
    var fmt  = ans.formatOf(tp, kbr);
    var flagState = ans.flag(r || { ok:false }, tp.flag || {});
    var cond = scopedConditionFor(kbr, tp);

    var opts = Object.keys(FORMAT_LABELS).map(function(f){
      return '<option value="' + f + '"' + (f === fmt ? ' selected' : '') + '>' +
             FORMAT_LABELS[f] + '</option>';
    }).join('');

    var readingLine = r
      ? '<div class="ae-cfg-reading"><b>' + esc(r.display) + '</b>' +
        '<span class="ae-cfg-prov"> · ' + esc(r.evidence.aggregation) + ' of ' +
        esc(r.evidence.measure) + ' over ' + esc(r.evidence.dimensionLabel || r.evidence.dimension) +
        ' · ' + r.evidence.members + ' members · feeds: ' +
        esc(r.evidence.feeds.join(', ')) + '</span></div>'
      : '<div class="ae-cfg-reading ae-cfg-unbound">Not reading data \u2014 ' +
        (P ? 'no query configured' : 'no profile bound') + '</div>';

    /* The flag is a local red mark. It says so, in the surface, every time. */
    var flagRow =
      '<div class="ae-cfg-row">' +
        '<label class="ae-cfg-lbl">Flag threshold</label>' +
        '<select class="ae-cfg-in ae-cfg-op" data-i="' + i + '" data-k="op">' +
          ['gt','gte','lt','lte'].map(function(o){
            return '<option value="' + o + '"' +
                   ((tp.flag && tp.flag.op) === o ? ' selected' : '') + '>' +
                   ({ gt:'above', gte:'at or above', lt:'below',
                      lte:'at or below' })[o] + '</option>'; }).join('') +
        '</select>' +
        '<input class="ae-cfg-in ae-cfg-num" type="number" step="any" data-i="' + i +
          '" data-k="value" value="' +
          (tp.flag && tp.flag.value != null ? tp.flag.value : '') +
          '" placeholder="none">' +
        '<label class="ae-cfg-chk"><input type="checkbox" data-i="' + i +
          '" data-k="enabled"' + (tp.flag && tp.flag.enabled ? ' checked' : '') +
          '> enabled</label>' +
        (flagState.flagged ? '<span class="ae-cfg-flagged">flagged</span>' : '') +
      '</div>' +
      '<div class="ae-cfg-note">A flag is local to this answer. It never notifies \u2014 ' +
      'only the Risk Meter escalates.</div>';

    /* One owner, two windows. Either the link, or the read-only line. */
    var riskRow = cond
      ? '<div class="ae-cfg-row ae-cfg-locked">' +
          '<label class="ae-cfg-lbl">Risk Meter</label>' +
          '<span class="ae-cfg-ro">Scoped condition exists \u2014 ' +
          esc(conditionSummary(cond)) +
          '. Edit it in the Risk Meter.</span></div>'
      : '<div class="ae-cfg-row">' +
          '<label class="ae-cfg-lbl">Risk Meter</label>' +
          '<a class="ae-cfg-link" href="#" data-i="' + i + '" data-k="torisk">' +
          'Add to Risk Meter \u2192</a>' +
          '<span class="ae-cfg-hint">pre-fills a condition scoped to this answer, ' +
          'with its own threshold and persistence</span></div>';

    return '<div class="ae-cfg-card">' +
      '<div class="ae-cfg-head"><span class="ae-cfg-kind">' +
        esc(r ? r.kind : (tp.query ? 'unresolved' : 'unbound')) + '</span>' +
        '<span class="ae-cfg-name">' + esc(tp.name || 'Untitled answer') +
        '</span></div>' +
      readingLine +
      '<div class="ae-cfg-row"><label class="ae-cfg-lbl">Format</label>' +
        '<select class="ae-cfg-in" data-i="' + i + '" data-k="format">' + opts +
        '</select>' +
        '<span class="ae-cfg-hint">this answer\u2019s own format, independent of ' +
        esc(kbr.name || 'the result') + '</span></div>' +
      flagRow + riskRow +
    '</div>';
  }).join('');

  var suggestions = renderSuggestions(kbr);
  box.innerHTML = '<div class="ae-cfg-wrap">' + rows + suggestions + '</div>';
  wireConfig(box, kbr, list);
}
window.renderAnswerConfig = renderAnswerConfig;

/* ── question suggestion from the profile ────────────────────────────────── */

function renderSuggestions(kbr){
  var ans = A(), P = boundProfile();
  if(!ans || !P) return '';
  var list = (kbr.answers || []).map(function(a){ return a.name; });
  var picks = ans.shortlist(P, list, 4);
  var c = ans.candidates(P);
  if(!picks.length) return '';
  return '<div class="ae-cfg-sugg"><div class="ae-cfg-sugg-head">' +
    'Suggested questions <span class="ae-cfg-hint">' + c.usable +
    ' usable candidates of ' + c.nominal + ' nominal (' + c.contextColumns +
    ' context columns \u00d7 ' + c.measures + ' measures' +
    (c.degenerate.length ? ', less ' + c.degenerate.length +
      ' with a single distinct value' : '') +
    '), ranked by variance</span></div>' +
    picks.map(function(q){
      return '<div class="ae-cfg-sugg-row"><span class="ae-cfg-sugg-q">' +
        esc(q.question) + '</span><span class="ae-cfg-hint">' + q.members +
        ' members \u00b7 spread ' + q.variance.toFixed(2) + '</span></div>';
    }).join('') + '</div>';
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

function wireConfig(box, kbr, list){
  box.querySelectorAll('[data-k]').forEach(function(el){
    var i = parseInt(el.getAttribute('data-i'), 10), k = el.getAttribute('data-k');
    var tp = list[i]; if(!tp) return;
    if(k === 'torisk'){
      el.addEventListener('click', function(ev){
        ev.preventDefault(); addAnswerToRiskMeter(kbr, tp);
      });
      return;
    }
    var ev = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
    el.addEventListener(ev, function(){
      if(k === 'format'){ tp.format = el.value; }
      else {
        if(!tp.flag) tp.flag = A().newFlag();
        if(k === 'enabled')     tp.flag.enabled = el.checked;
        else if(k === 'value')  tp.flag.value = el.value === '' ? null : parseFloat(el.value);
        else                    tp.flag.op = el.value;
      }
      if(typeof refreshAnswerPanelHeader === 'function') refreshAnswerPanelHeader(kbr);
      renderAnswerConfig();
    });
  });
}

/* ═══ 4 · the quiet link into the Risk Meter ═══════════════════════════════ */

function riskConditions(kbr){
  if(!kbr) return [];
  if(Array.isArray(kbr.riskConditions)) return kbr.riskConditions;
  if(kbr.risk && Array.isArray(kbr.risk.conditions)) return kbr.risk.conditions;
  return [];
}
function scopedConditionFor(kbr, tp){
  var ans = A(); if(!ans) return null;
  return ans.scopedCondition(riskConditions(kbr), kbr.id, tp.tid);
}
function conditionSummary(c){
  /* The threshold is written in the answer's own format. A raw float here
     reads as machine spill — 0.1755988741790889 is the same number as
     0.1756 gal/ton and only one of them is a sentence. */
  var ans = A();
  var t = '\u2014';
  if(c && c.threshold != null){
    t = (ans && ans.magnitudeText)
      ? ans.magnitudeText(c.threshold, c.format || 'count', c.unit || '')
      : String(c.threshold);
  }
  var p = (c && c.persistenceSec) ? (' for ' + Math.round(c.persistenceSec / 60) + ' min') : '';
  return (c && c.direction === 'down' ? 'below ' : 'above ') + t + p;
}

/** Pre-fill and hand over. This does not escalate and does not decide — it
 *  gives the Risk Meter a draft carrying the answer's scope and its current
 *  reading, and the Risk Meter owns it from there. */
function addAnswerToRiskMeter(kbr, tp){
  var ans = A(); if(!ans) return;
  var r = computed(kbr, tp);
  var draft = ans.riskDraft(kbr, tp, r);
  if(!Array.isArray(kbr.riskConditions)) kbr.riskConditions = [];
  var base = (window.MOMENTUM && MOMENTUM.Risk && MOMENTUM.Risk.newCondition)
           ? MOMENTUM.Risk.newCondition() : {};
  var cond = Object.assign({}, base, draft, { id:'ac_' + Math.random().toString(36).slice(2, 9) });
  kbr.riskConditions.push(cond);
  renderAnswerConfig();
  if(typeof refreshAnswerPanelHeader === 'function') refreshAnswerPanelHeader(kbr);
}
window.addAnswerToRiskMeter = addAnswerToRiskMeter;

/* ═══ 5 · the shipped mining configuration ═════════════════════════════════ */

/** Land the three KBRs of §7 with their five answers each. Called when the
 *  mining profile is bound; a no-op for every other domain, and a no-op when
 *  the KBR already carries queries so it never overwrites a hand edit. */
function seedMiningAnswers(force){
  var ans = A(); if(!ans) return 0;
  var seeded = 0;
  try {
    KBRS.forEach(function(kbr){
      var defs = ans.miningAnswers(kbr.name);
      if(!defs) return;
      if(!Array.isArray(kbr.answers)) kbr.answers = [];
      defs.forEach(function(d){
        var existing = kbr.answers.filter(function(a){ return a.name === d.name; })[0];
        if(existing && !force && existing.query) return;
        var tp = existing || (typeof newTouchpoint === 'function' ? newTouchpoint() : { sources:[] });
        tp.name   = d.name;
        tp.query  = d.query;
        tp.format = d.format;
        tp.unit   = d.unit;
        if(d.target != null){ tp.target = d.target; tp.targetProvisional = !!d.targetProvisional; }
        if(!tp.flag) tp.flag = ans.newFlag();
        ans.migrate(tp, kbr);
        if(!existing) kbr.answers.push(tp);
        seeded++;
      });
    });
  } catch(e){ return 0; }
  return seeded;
}
window.seedMiningAnswers = seedMiningAnswers;

})();
