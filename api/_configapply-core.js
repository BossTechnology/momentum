/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.ConfigApply — turning a parsed document into a live board

   The parser produced a canonical object. This puts it to work: channels into
   the workspace registry, answers onto their results as real queries, risk
   touchpoints and conditions onto the Risk Meter with their routing intact.

   Precedence — decided before the parser existed, and honoured here
   ────────────────────────────────────────────────────────────────
       Declared is the floor. Edited is the truth. Re-binding re-declares.

   Applying a document sets initial state. Anything the user then edits wins.
   Attaching the document again re-applies it — deliberately, because that is
   the only way to recover from an edit someone regrets. Every object the
   document created is marked `declared:true`, so the surface can say where a
   condition came from rather than leaving someone to guess.

   Names are bound by MEANING through the profile dictionary, so a document may
   say "turno" where the workbook says "Shift ID". Anything that fails to bind
   is reported by name — an answer that silently resolves to nothing is worse
   than one that says which column it could not find.

   Nothing here notifies, and nothing is required. With no document the board
   is exactly what it was.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* Reserved readings the answer core understands directly — they name a way of
   reading the rollups rather than a column, so they must not be sent through
   the dictionary. */
var RESERVED = { __gallons:1, __tons:1, __cycles:1, __deviation:1, __value:1,
                 __baseline:1, __excess:1, __frequency:1, __rows:1 };
var BUILTIN_DIMS = { unit:1, roster:1, incident:1 };

function apply(doc, kbrs, profile, opts){
  opts = opts || {};
  var CD = MOMENTUM.ConfigDoc, CH = MOMENTUM.Channels;
  /* Reached through MOMENTUM, not by bare name: `R` is module-scoped in
     the risk core and a bare reference here throws at the first rule. */
  var R = MOMENTUM.Risk;
  var report = { channels:0, kbrs:0, answers:0, risk:0, conditions:0, anomRules:0,
                 skipped:0, unresolved:[], unmatched:[] };
  if(!doc || !CD) return report;

  /* ── channels first: a condition cannot route to one that does not exist ── */
  if(CH && doc.channels && doc.channels.length){
    var merged = CH.merge(doc.channels);
    report.channels = merged.added + merged.replaced;
  }

  var byPos = positionalMap(kbrs, doc.kbrs);
  report.boundByPosition = [];

  (doc.kbrs || []).forEach(function(dk){
    var kbr = matchKbr(kbrs, dk.name);
    if(!kbr && byPos && byPos[dk.name]){
      kbr = byPos[dk.name];
      report.boundByPosition.push(dk.name + ' \u2192 ' + kbr.name);
    }
    if(!kbr){
      /* Do not invent a result. A document naming something the journey does
         not have is a mismatch worth reporting, not a licence to fabricate a
         KBR nobody asked for. */
      report.unmatched.push(dk.name);
      return;
    }
    report.kbrs++;

    if(dk.unit)      kbr.unit = dk.unit;
    if(dk.format)    kbr.format = dk.format;
    if(dk.target != null && isFinite(dk.target)){
      kbr.goal = {
        format: dk.format || kbr.format || 'count',
        unit: dk.unit || kbr.unit || '',
        target: dk.target,
        direction: dk.direction || 'up',
        timeframe: 'day', progressAs: 'average',
        /* A provisional target is external and unverified. It is carried as a
           target and never allowed to bend a denominator. */
        provisional: !!dk.targetProvisional
      };
    }

    /* ── answers ─────────────────────────────────────────────────────────── */
    if(dk.answers && dk.answers.length){
      if(!Array.isArray(kbr.answers)) kbr.answers = [];

      /* A DOCUMENT THAT DECLARES ANSWERS REPLACES THE SCAFFOLDING.

         `seedKbrAnswers` fills every result with five generic answers so a
         fresh board is never empty. This then pushed the declared ones in
         alongside, matching only on name — and the names never matched,
         because the seeds are English archetypes and the declarations are the
         client's own vocabulary. Mining showed ten answers per result:
         'Top Contributor', 'Headline Value' and 'Best Performer' sitting
         ABOVE 'Mayor Desviación por Unidad', in a board that had a document
         telling it exactly what to ask.

         Applying is replacing, at every level — the same rule already applied
         to riskTouchpoints and to declared riskConditions. Only `seeded`
         scaffolding goes: an answer someone added by hand carries no flag and
         is theirs to keep. */
      kbr.answers = kbr.answers.filter(function(a){ return !a.seeded; });

      dk.answers.forEach(function(da){
        var q = buildQuery(da, profile, report);
        var existing = kbr.answers.filter(function(a){ return a.name === da.name; })[0];
        var tp = existing || (typeof newTouchpoint === 'function'
                              ? newTouchpoint() : { tid:'da' + Math.random().toString(36).slice(2, 8), sources:[] });
        tp.name     = da.name;
        tp.format   = da.format || null;
        tp.unit     = da.unit || '';
        tp.query    = q;
        tp.declared = true;
        if(MOMENTUM.Answer && MOMENTUM.Answer.migrate) MOMENTUM.Answer.migrate(tp, kbr);
        if(!existing) kbr.answers.push(tp);
        report.answers++;
      });
    }

    /* ── risk touchpoints ────────────────────────────────────────────────── */
    if(dk.riskTouchpoints && dk.riskTouchpoints.length){
      if(!Array.isArray(kbr.riskTouchpoints)) kbr.riskTouchpoints = [];
      dk.riskTouchpoints.forEach(function(dt){
        var ex = kbr.riskTouchpoints.filter(function(t){ return t.name === dt.name; })[0];
        var tp = ex || (typeof newTouchpoint === 'function'
                        ? newTouchpoint() : { tid:'dr' + Math.random().toString(36).slice(2, 8), sources:[] });
        tp.name = dt.name; tp.dna = dt.dna; tp.weight = dt.weight;
        tp.rollup = dt.rollup;
        if(dt.signatureSec) tp.signatureSec = dt.signatureSec;
        tp.status = tp.status || 'gray';
        tp.declared = true;
        if(!ex) kbr.riskTouchpoints.push(tp);
        report.risk++;
      });
    }

    /* ── Known Unknowns, onto the touchpoint that would see them ─────────── */
    if(dk.anomRules && dk.anomRules.length){
      dk.anomRules.forEach(function(ar){
        var tp = (kbr.riskTouchpoints || []).filter(function(t){
          return t.name === ar.touchpoint; })[0];
        /* A rule naming a touchpoint nobody declared is dropped, not made to
           conjure one. Silently inventing a touchpoint would put a watch on
           something the document never said exists. */
        if(!tp){ report.skipped = (report.skipped || 0) + 1; return; }
        if(!tp.anomRules) tp.anomRules = R ? R.newAnomalyRules()
                                           : { family:'known', known:[], unknown:{critical:[],warning:[]} };
        if(!Array.isArray(tp.anomRules.known)) tp.anomRules.known = [];
        if(tp.anomRules.known.some(function(x){ return x.name === ar.name; })) return;
        tp.anomRules.known.push({
          name: ar.name, keywords: ar.keywords, condition: ar.condition,
          freqThresh: ar.freqThresh,
          responses: ar.response
            ? [{ type:ar.response, name:'', channels:resolveChannels(ar.channels),
                 subject:'', message:'', url:'', payload:'' }]
            : []
        });
        report.anomRules = (report.anomRules || 0) + 1;
      });
    }

    /* ── conditions, with their routing ──────────────────────────────────── */
    if(dk.conditions && dk.conditions.length){
      if(!Array.isArray(kbr.riskConditions)) kbr.riskConditions = [];
      dk.conditions.forEach(function(dc){
        var id = 'doc_' + slug(dc.label);
        var ex = kbr.riskConditions.filter(function(c){ return c.id === id; })[0];
        var c = ex || {};
        c.id = id;
        c.label = dc.label;
        c.op = dc.op;
        c.value = dc.value;
        c.persistenceSec = dc.persistenceSec;
        c.enabled = true;
        c.origin = 'declared';
        c.declared = true;
        /* Scope the condition to the result. Omitting it made every consumer
           that reads `c.scope.kind` throw — the alarms list did, immediately. */
        c.scope = c.scope || { kind:'kbr', ref:kbr.id };
        c.response = (dc.responses && dc.responses[0] && dc.responses[0].type) || 'alert';
        c.responses = (dc.responses || []).map(function(r){
          return { type:r.type, name:r.name || '',
                   channels:resolveChannels(r.channels),
                   subject:r.subject || '', message:r.message || '',
                   url:r.url || '', payload:r.payload || '' };
        });
        if(!ex) kbr.riskConditions.push(c);
        report.conditions++;
      });
    }
  });
  return report;
}

/* A document names a channel by its label; the registry addresses it by id.
   An unmatched label is dropped rather than stored, because a dangling id
   renders as a blank recipient and reads as configured. */
function resolveChannels(names){
  var CH = MOMENTUM.Channels;
  if(!CH) return [];
  var list = CH.list();
  return (names || []).map(function(n){
    var want = String(n).trim().toLowerCase();
    if(!want) return null;
    for(var i = 0; i < list.length; i++){
      if(list[i].id === n) return list[i].id;
      if(String(list[i].label).toLowerCase() === want) return list[i].id;
    }
    return null;
  }).filter(Boolean);
}

/** Build the answer core's query from a declaration, binding names by meaning. */
function buildQuery(da, profile, report){
  var CD = MOMENTUM.ConfigDoc;
  var dim = String(da.dimension || '').trim();
  var q = { aggregation: da.aggregation || 'mean', rank: da.rank || 'max',
            format: da.format || null, unit: da.unit || '' };

  if(BUILTIN_DIMS[dim]) q.dimension = dim;
  else {
    var col = CD.bindName(profile, dim, 'context');
    if(!col){ report.unresolved.push(da.name + ' \u2192 dimension "' + dim + '"'); return null; }
    q.dimension = 'context:' + col;
  }

  var m = String(da.measure || '').trim();
  var d = String(da.denominator || '').trim();
  if(d){
    q.measure = { numerator: bindMeasure(m, profile, da, report),
                  denominator: bindMeasure(d, profile, da, report) };
    if(!q.measure.numerator || !q.measure.denominator) return null;
  } else {
    q.measure = bindMeasure(m, profile, da, report);
    if(!q.measure) return null;
  }
  if(da.aggregation === 'ratio') q.aggregation = 'ratio';
  return q;
}
function bindMeasure(name, profile, da, report){
  if(!name) return null;
  if(RESERVED[name]) return name;
  var CD = MOMENTUM.ConfigDoc;
  var col = CD.bindName(profile, name, 'measure');
  if(!col) report.unresolved.push(da.name + ' \u2192 measure "' + name + '"');
  return col;
}

/** Match a declared result to a live one — exact first, then case-insensitive,
 *  then accent-insensitive, so "Horas en Ralenti" reaches "Horas en Ralentí". */
function matchKbr(kbrs, name){
  var want = String(name || '').trim();
  if(!want || !kbrs) return null;
  for(var i = 0; i < kbrs.length; i++) if(kbrs[i].name === want) return kbrs[i];
  var lw = want.toLowerCase();
  for(i = 0; i < kbrs.length; i++)
    if(String(kbrs[i].name).toLowerCase() === lw) return kbrs[i];
  var nw = deaccent(want);
  for(i = 0; i < kbrs.length; i++)
    if(deaccent(kbrs[i].name) === nw) return kbrs[i];
  /* Punctuation and spacing are not meaning: "On-Time Delivery",
     "On Time Delivery" and "on_time delivery" are one result written three
     ways, and refusing all but one of them is pedantry, not safety. */
  var sw = squash(want);
  for(i = 0; i < kbrs.length; i++)
    if(squash(kbrs[i].name) === sw) return kbrs[i];
  return null;
}
function squash(s){ return deaccent(s).replace(/[^a-z0-9]+/g, ''); }

/* POSITIONAL FALLBACK — deliberately narrow.

   A different client in the same industry writes their own document, and calls
   the first result "Consumo por Tonelada" where ours says "Combustible por
   Tonelada". Nothing matches, and every declaration in their document lands in
   `unmatched` — the board stays on demo content while their file appears to
   have been accepted.

   Binding by position fixes that, and binding by position is also how you
   silently attach the wrong target to the wrong result. So it applies only
   when the evidence is unambiguous:

     · NOT ONE name matched — a partial match means the names are meaningful
       and the misses are real misses, not a different vocabulary
     · the document declares EXACTLY as many results as the board has
     · the board has results at all

   And it is always reported. `report.boundByPosition` names each pairing so a
   caller can show "your 'Consumo por Tonelada' was applied to 'Combustible por
   Tonelada'" rather than leaving someone to discover it. Silence would be the
   failure here, not the guess. */
function positionalMap(kbrs, docKbrs){
  if(!kbrs || !kbrs.length || !docKbrs || !docKbrs.length) return null;
  if(docKbrs.length !== kbrs.length) return null;
  for(var i = 0; i < docKbrs.length; i++)
    if(matchKbr(kbrs, docKbrs[i].name)) return null;   /* something matched — trust names */
  var map = {};
  for(i = 0; i < docKbrs.length; i++) map[docKbrs[i].name] = kbrs[i];
  return map;
}
function deaccent(s){
  var t = String(s == null ? '' : s).toLowerCase();
  return t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t;
}
function slug(s){
  return String(s || 'cond').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cond';
}

MOMENTUM.ConfigApply = {
  version: 1, apply: apply, buildQuery: buildQuery,
  matchKbr: matchKbr, resolveChannels: resolveChannels
};

})();
