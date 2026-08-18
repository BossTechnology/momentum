/* ═══════════════════════════════════════════════════════════════════════════
   Anomalies — an occurrence, so it belongs in every panel

   An anomaly is not a response and not a configuration. It is a fact about
   data, and data flows through stages, results and answers alike — so the tab
   sits with the content icons on the left, before BOBee, in all four panels.

   Detection is local. Escalation is not.
   ─────────────────────────────────────
   Each panel surfaces what was detected on ITS data. None of them notifies.
   A detection becomes a notification only by way of a Risk Meter condition,
   which is the same law that governs answer flags: produce the fact, hand it
   over, let one owner decide whether a human hears about it.

   The two families come from BOb and are genuinely different questions.
   KNOWN unknowns are named in advance — a keyword, a frequency, a shape — and
   are declared per touchpoint, because only whoever configured that touchpoint
   knows what is worth watching for. UNKNOWN unknowns cannot be enumerated by
   definition; they are found statistically and answered by severity.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* ── what a panel has to look at ─────────────────────────────────────────── */

/** Every touchpoint reachable from this host, whatever kind of panel it is. */
function touchpointsOf(host){
  if(!host) return [];
  var out = [];
  if(Array.isArray(host.touchpoints)) out = out.concat(host.touchpoints);
  if(Array.isArray(host.answers))     out = out.concat(host.answers);
  if(Array.isArray(host.riskTouchpoints)) out = out.concat(host.riskTouchpoints);
  return out;
}

/** Rules declared across those touchpoints — the KNOWN side. */
function knownRules(host){
  var out = [];
  touchpointsOf(host).forEach(function(tp){
    var rs = (tp && tp.anomRules && tp.anomRules.known) || [];
    rs.forEach(function(r){
      if(!r || (!r.name && !r.keywords)) return;      /* an empty draft is not a rule */
      out.push({ tp: tp.name || 'Untitled touchpoint', rule: r });
    });
  });
  return out;
}

/** Detections found in the bound data. Statistical, so nothing declares them.
 *  With no profile bound this is empty and the panel says so — it does not
 *  invent an anomaly to fill the space. */
function detections(host){
  var out = [];
  try {
    if(!MOMENTUM.Bind || !MOMENTUM.Bind.active()) return out;
    var prof = MOMENTUM.Bind.profile && MOMENTUM.Bind.profile();
    var cases = prof && prof.incidentScript && prof.incidentScript.cases;
    if(!cases) return out;
    cases.forEach(function(c){
      /* Expected excess of zero is the decoy: localised in context, carrying
         no excess. It is context, not a fault, and surfacing it as an anomaly
         is precisely the mistake the Context Exception exists to avoid. */
      if(!c.expectedExcess) return;
      out.push({
        entity: c.entity, label: c.label,
        excess: c.expectedExcess,
        severity: c.expectedExcess >= 0.06 ? 'critical' : 'warning',
        rows: c.rowsAffected || 0,
        startISO: c.startISO
      });
    });
  } catch(e){}
  return out.sort(function(a, b){ return b.excess - a.excess; });
}

/* ── render ──────────────────────────────────────────────────────────────── */

function render(containerId, host, opts){
  var box = document.getElementById(containerId);
  if(!box) return;
  opts = opts || {};
  var known = knownRules(host);
  var found = detections(host);
  var bound = !!(MOMENTUM.Bind && MOMENTUM.Bind.active());

  /* No preamble. The explanatory paragraph told the reader what anomalies are,
     which they know by the time they have opened the tab, and it pushed the
     content it described below the fold.

     No suggestion either, outside the Risk Meter. A suggestion is only worth
     printing when the reason nothing is showing is something the reader can
     change — which, here, it is not: these panels have no tolerance dial. */
  var head = '';

  var unknownBody = found.map(function(d){
    return '<div class="an-card an-' + d.severity + '">' +
      '<div class="an-hd"><span class="an-dot"></span>' +
        '<span class="an-title">' + esc(d.label) + '</span>' +
        '<span class="an-sev">' + esc(d.severity) + '</span></div>' +
      '<div class="an-body">' + esc(d.entity) + ' \u00b7 expected excess ' +
        (d.excess * 100).toFixed(2) + '%' +
        (d.rows ? ' across ' + d.rows.toLocaleString() + ' rows' : '') + '</div>' +
    '</div>';
  }).join('');

  var knownBody = known.map(function(k){
    var r = k.rule;
    var how = r.condition === 'frequency'
        ? '"' + esc(r.keywords || '') + '" more than ' + esc(r.freqThresh || 5) + ' times'
      : r.condition === 'pattern'
        ? esc(r.keywords || 'a described pattern')
        : 'contains ' + esc(r.keywords || '\u2014');
    return '<div class="an-rule"><span class="an-rule-nm">' +
      esc(r.name || 'Untitled rule') + '</span>' +
      '<span class="an-rule-how">' + how + '</span>' +
      '<span class="an-rule-tp">' + esc(k.tp) + '</span></div>';
  }).join('');

  /* Nothing at all found and nothing declared: one status line, no headings.
     The Known/Unknown grouping survives — but only when there is something to
     group, otherwise it is two labels over two blanks. */
  /* Same shape as the Risk Meter: a count, a label, and a grey box saying why
     it is zero. These panels previously showed a bare sentence with no header,
     which is what made them look unlike every other tab. */
  var n = found.length;
  var head = '<div class="rm-act-hero"><div class="v">' + n + '</div>' +
             '<div class="lbl">' + (n === 1 ? 'Anomaly' : 'Anomalies') + '</div></div>';
  if(!n && !known.length){
    box.innerHTML = head + '<div class="rm-act-why">None surfaced.</div>';
    return;
  }
  box.innerHTML = head +
    (n ? unknownBody : '') +
    (known.length
      ? '<div class="an-sec-hd"' + (n ? ' style="margin-top:18px"' : '') +
        '>Known unknowns <span class="an-sec-sub">declared per touchpoint</span></div>' + knownBody
      : '');
}

MOMENTUM.Anomalies = {
  version: 1,
  touchpointsOf: touchpointsOf, knownRules: knownRules,
  detections: detections, render: render
};

})();





/* Each tab switcher predates this pane, so each is extended rather than
   edited. The anomalies pane is activated here and the original is left to
   handle everything it already knew about. */
(function(){
  var WIRE = [
    { fn:'switchStageTab',  panes:['stagePaneActivity','stagePaneTouchpoints','stagePaneBobby','stagePaneAnomalies'],
      tabs:['stageTabActivity','stageTabTouchpoints','stageTabBobby','stageTabAnomalies'],
      pane:'stagePaneAnomalies', tab:'stageTabAnomalies', box:'stageAnomContent',
      host:function(){ return (typeof currentStage === 'function') ? currentStage() : null; } },
    { fn:'switchKbrTab',    panes:['kbrPaneActivity','kbrPaneTouchpoints','kbrPaneBobby','kbrPaneConfig','kbrPaneAnomalies'],
      tabs:['kbrTabActivity','kbrTabTouchpoints','kbrTabBobby','kbrTabConfig','kbrTabAnomalies'],
      pane:'kbrPaneAnomalies', tab:'kbrTabAnomalies', box:'kbrAnomContent',
      host:function(){ try { return KBRS.find(function(k){ return k.id === activeKbrId; }); } catch(e){ return null; } } },
    { fn:'switchAnswerTab', panes:['aePaneActivity','aePaneTouchpoints','aePaneBobby','aePaneConfig','aePaneAnomalies'],
      tabs:['aeTabActivity','aeTabTouchpoints','aeTabBobby','aeTabConfig','aeTabAnomalies'],
      pane:'aePaneAnomalies', tab:'aeTabAnomalies', box:'aeAnomContent',
      host:function(){ try { return KBRS.find(function(k){ return k.id === activeAnswerId; }); } catch(e){ return null; } } }
  ];
  WIRE.forEach(function(w){
    var orig = window[w.fn];
    if(typeof orig !== 'function' || orig.__anom) return;
    var wrapped = function(tab){
      if(tab === 'anomalies'){
        w.panes.forEach(function(id){
          var el = document.getElementById(id);
          if(el) el.classList.toggle('active', id === w.pane);
        });
        w.tabs.forEach(function(id){
          var el = document.getElementById(id);
          if(el) el.classList.toggle('active', id === w.tab);
        });
        if(window.MOMENTUM && MOMENTUM.Anomalies)
          MOMENTUM.Anomalies.render(w.box, w.host());
        return;
      }
      var p = document.getElementById(w.pane), t = document.getElementById(w.tab);
      if(p) p.classList.remove('active');
      if(t) t.classList.remove('active');
      return orig.apply(this, arguments);
    };
    wrapped.__anom = true;
    window[w.fn] = wrapped;
  });
})();
