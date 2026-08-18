/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.ConfigDoc — declarations, out of the product and into a document

   Everything a client's simulation needs that is not data and not a journey:
   the answers each result produces, the risk touchpoints that watch it, the
   conditions that fire, and where those conditions route.

   Why this exists
   ───────────────
   All of it used to live in product code — a MINING table in the answer core,
   a MINING_RISK_TPS array in the risk UI, a target of 0.420 written into a
   template. That is precooking: the simulation could only ever be as good as
   what someone had already hardcoded for one client, and a second client meant
   a second array.

   One canonical shape, N thin importers
   ─────────────────────────────────────
   The contract is JSON. Every other format is an adapter that produces the
   same object, so there is one resolver rather than one per format. The
   alternative — a parser per format — is how an .xlsx ends up behaving subtly
   differently from a .docx with nobody able to say why.

   Binding is by MEANING, not by exact column name
   ───────────────────────────────────────────────
   A document may say "segment" where the workbook says
   "Pit Position". The profile carries a dictionary built from the client's own
   technical manual — 21 entries covering all 14 measures and all 6 context
   columns, each with a key, a unit, a role and a Spanish description — and
   that is the bridge. Exact names still win; the dictionary is the fallback,
   and an unresolved name degrades to a named warning rather than a silent
   nothing.

   Nothing here notifies, and nothing here is required. A simulation with no
   Config Doc behaves exactly as it did before one existed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

var SCHEMA = 1;

/* ═══ 1 · the canonical shape ══════════════════════════════════════════════

   {
     schema: 1,
     channels: [ { id, type, label, values[] } ],
     kbrs: [ {
       name, unit, format, direction, target, targetProvisional,
       answers:          [ { name, format, unit, dimension, measure,
                             aggregation, rank, denominator } ],
       riskTouchpoints:  [ { name, dna, weight, rollup, signatureSec } ],
       anomRules:        [ { touchpoint, name, condition, keywords, freqThresh } ],
       conditions:       [ { label, op, value, persistenceSec,
                             responses: [ { type, name, channels[],
                                            subject, message, url, payload } ] } ]
     } ]
   }                                                                        */

function blank(){
  return { schema: SCHEMA, channels: [], kbrs: [] };
}

/* ═══ 2 · importers ════════════════════════════════════════════════════════ */

function parse(text, filename){
  var ext = String(filename || '').toLowerCase().split('.').pop();
  try {
    if(ext === 'json') return fromJson(text);
    if(ext === 'yaml' || ext === 'yml') return fromYaml(text);
    if(ext === 'csv' || ext === 'tsv') return fromDelimited(text, ext === 'tsv' ? '\t' : ',');
    return { ok:false, reason:'unsupported format: .' + ext,
             hint:'Use .json, .yaml, .csv, .xlsx or .docx.' };
  } catch(e){
    return { ok:false, reason:'could not read the document', detail:String(e && e.message) };
  }
}

function fromJson(text){
  var raw = JSON.parse(text);
  return normalise(raw);
}

/* A deliberately small YAML reader: two levels of nesting, lists of maps, and
   scalars. Anything more and the document should be JSON — pretending to
   support all of YAML with a regex is how a config silently loads wrong. */
function fromYaml(text){
  var lines = String(text).split(/\r?\n/).filter(function(l){
    return l.trim() && l.trim().charAt(0) !== '#';
  });
  var out = {}, stack = [{ indent:-1, node:out }];
  lines.forEach(function(line){
    var indent = line.match(/^\s*/)[0].length;
    var body = line.trim();
    while(stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    var parent = stack[stack.length - 1].node;
    if(body.charAt(0) === '-'){
      var item = body.slice(1).trim();
      if(!Array.isArray(parent.__list)) parent.__list = [];
      if(item.indexOf(':') > 0){
        var obj = {};
        applyPair(obj, item);
        parent.__list.push(obj);
        stack.push({ indent: indent, node: obj });
      } else {
        parent.__list.push(scalar(item));
      }
      return;
    }
    var ci = body.indexOf(':');
    if(ci < 0) return;
    var key = body.slice(0, ci).trim(), val = body.slice(ci + 1).trim();
    if(val === ''){
      var child = {};
      parent[key] = child;
      stack.push({ indent: indent, node: child });
    } else {
      parent[key] = scalar(val);
    }
  });
  return normalise(delist(out));
}
function applyPair(obj, s){
  var i = s.indexOf(':');
  if(i < 0) return;
  obj[s.slice(0, i).trim()] = scalar(s.slice(i + 1).trim());
}
function delist(node){
  if(node && typeof node === 'object'){
    if(Array.isArray(node.__list)){
      var l = node.__list.map(delist);
      return l;
    }
    Object.keys(node).forEach(function(k){ node[k] = delist(node[k]); });
  }
  return node;
}
function scalar(v){
  var s = String(v).replace(/^["']|["']$/g, '');
  if(s === 'true') return true;
  if(s === 'false') return false;
  if(s === 'null' || s === '') return null;
  if(/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return s;
}

/* One row per declaration, with a `kind` column saying what it declares. Flat,
   because a spreadsheet is flat, and pretending otherwise produces documents
   nobody can edit without breaking. This is also the shape .xlsx and .docx
   tables are converted into before they reach here. */
function fromDelimited(text, sep){
  var rows = splitRows(String(text), sep || ',');
  if(!rows.length) return { ok:false, reason:'the document is empty' };
  var head = rows[0].map(function(h){ return String(h || '').trim().toLowerCase(); });
  return fromRows(rows.slice(1).map(function(r){
    var o = {};
    head.forEach(function(h, i){ if(h) o[h] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  }));
}
function splitRows(text, sep){
  /* `#` opens a comment. The generated template ends with a reference block
     listing every column in the data, and without this those lines were split
     on their commas and read as declarations — producing phantom results named
     "nothing to compare", "__tons" and "roster", each reported as unmatched.
     Guidance in a document must never be mistaken for content. */
  return text.split(/\r?\n/)
    .filter(function(l){ return l.trim() && l.trim().charAt(0) !== '#'; })
    .map(function(line){
      var out = [], cur = '', q = false;
      for(var i = 0; i < line.length; i++){
        var c = line.charAt(i);
        if(c === '"'){ if(q && line.charAt(i + 1) === '"'){ cur += '"'; i++; } else q = !q; }
        else if(c === sep && !q){ out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    });
}

/** Rows → canonical. Shared by csv, tsv, xlsx and docx tables. */
function fromRows(rows){
  var doc = blank();
  var byKbr = {};
  function kbrFor(name){
    var key = String(name || '').trim();
    if(!key) return null;
    if(!byKbr[key]){
      byKbr[key] = { name:key, answers:[], riskTouchpoints:[], conditions:[], anomRules:[] };
      doc.kbrs.push(byKbr[key]);
    }
    return byKbr[key];
  }
  (rows || []).forEach(function(r){
    var kind = String(r.kind || r.type || '').toLowerCase();
    if(kind === 'channel'){
      /* The destinations may arrive under `values`, or under `channels` in a
         sheet that reuses one column for every kind of row. Reading only the
         first silently produced a channel with no recipients — which looks
         configured and reaches nobody. */
      doc.channels.push({ id:r.id || r.name, type:r.channeltype || r.medium || r.dna || 'email',
                          label:r.label || r.name,
                          values:String(r.values || r.channels || r.destinations || '')
                                   .split(/[;,]/).map(trim).filter(Boolean) });
      return;
    }
    var k = kbrFor(r.kbr || r.result);
    if(!k) return;
    if(kind === 'kbr'){
      if(r.unit) k.unit = r.unit;
      if(r.format) k.format = r.format;
      if(r.direction) k.direction = r.direction;
      if(r.target !== '' && r.target != null && isFinite(parseFloat(r.target))){
        k.target = parseFloat(r.target);
        k.targetProvisional = /prov/i.test(String(r.notes || r.provisional || ''));
      }
    } else if(kind === 'answer'){
      k.answers.push({ name:r.name, format:r.format || null, unit:r.unit || '',
                       dimension:r.dimension || '', measure:r.measure || '',
                       denominator:r.denominator || '',
                       aggregation:r.aggregation || 'mean', rank:r.rank || 'max' });
    } else if(kind === 'risktouchpoint' || kind === 'risk'){
      k.riskTouchpoints.push({ name:r.name, dna:r.dna || 'Analog', weight:r.weight || 'MED',
                               rollup:r.rollup || 'weighted',
                               signatureSec:r.signaturesec ? parseInt(r.signaturesec, 10) : null });
    } else if(kind === 'anomrule' || kind === 'knownunknown'){
      /* A Known Unknown is a WATCH, not a threshold: it names a pattern
         someone expects to see rather than a number to cross. It lands on a
         risk touchpoint, because that is where MOMENTUM.Anomalies reads them
         from and where every panel renders them.

         `dimension` carries the touchpoint name, since it is the column this
         sheet already uses for "which thing does this row attach to". The
         touchpoint row must appear BEFORE its rules; normalise() does not
         reorder, so a rule naming a touchpoint that has not been declared is
         dropped rather than silently creating an empty one. */
      k.anomRules.push({ touchpoint:r.dimension || r.touchpoint || '',
                         name:r.name || r.label || '',
                         condition:r.aggregation || r.condition || 'contains',
                         keywords:r.measure || r.keywords || '',
                         freqThresh:r.value === '' || r.value == null
                                      ? null : parseInt(r.value, 10),
                         response:r.response || '',
                         channels:String(r.channels || '').split(/[;,]/)
                                    .map(trim).filter(Boolean) });
    } else if(kind === 'condition'){
      k.conditions.push({ label:r.name || r.label, op:r.op || 'lt',
                          value:r.value === '' ? null : parseFloat(r.value),
                          persistenceSec:r.persistencesec ? parseFloat(r.persistencesec) : null,
                          responses: r.response
                            ? [{ type:r.response, name:r.responsename || '',
                                 channels:String(r.channels || '').split(/[;,]/)
                                            .map(trim).filter(Boolean),
                                 subject:r.subject || '', message:r.message || '',
                                 url:r.url || '', payload:r.payload || '' }]
                            : [] });
    }
  });
  return normalise(doc);
}
function trim(s){ return String(s).trim(); }

/* ═══ 3 · normalisation ════════════════════════════════════════════════════
   Whatever the importer produced, this is what the resolver may assume. It
   never throws on a malformed document — it reports what it could not read. */

function normalise(raw){
  if(!raw || typeof raw !== 'object')
    return { ok:false, reason:'the document did not contain a configuration' };
  var doc = blank();
  doc.schema = raw.schema || SCHEMA;
  var warnings = [];

  (raw.channels || []).forEach(function(c, i){
    if(!c || !c.label && !c.id){ warnings.push('channel ' + (i + 1) + ' has no name'); return; }
    doc.channels.push({
      id: c.id || ('doc_ch' + (i + 1)),
      type: c.type || 'email',
      label: c.label || c.id,
      values: Array.isArray(c.values) ? c.values.map(trim).filter(Boolean)
            : String(c.values || '').split(/[;,]/).map(trim).filter(Boolean)
    });
  });

  (raw.kbrs || []).forEach(function(k, i){
    if(!k || !k.name){ warnings.push('result ' + (i + 1) + ' has no name'); return; }
    doc.kbrs.push({
      name: String(k.name).trim(),
      unit: k.unit || '', format: k.format || null,
      direction: k.direction || null,
      target: (k.target == null || k.target === '') ? null : parseFloat(k.target),
      targetProvisional: !!k.targetProvisional,
      answers: (k.answers || []).filter(Boolean).map(function(a){
        return { name:a.name || 'Untitled answer', format:a.format || null,
                 unit:a.unit || '', dimension:a.dimension || '',
                 measure:a.measure || '', denominator:a.denominator || '',
                 aggregation:a.aggregation || 'mean', rank:a.rank || 'max' };
      }),
      riskTouchpoints: (k.riskTouchpoints || []).filter(Boolean).map(function(t){
        return { name:t.name || 'Untitled indicator', dna:t.dna || 'Analog',
                 weight:t.weight || 'MED', rollup:t.rollup || 'weighted',
                 signatureSec:t.signatureSec || null };
      }),
      conditions: (k.conditions || []).filter(Boolean).map(function(c){
        return { label:c.label || 'Untitled condition', op:c.op || 'lt',
                 value:(c.value == null || c.value === '') ? null : parseFloat(c.value),
                 persistenceSec:c.persistenceSec == null ? null : parseFloat(c.persistenceSec),
                 responses:(c.responses || []).filter(Boolean).map(function(r){
                   return { type:r.type || 'alert', name:r.name || '',
                            channels:Array.isArray(r.channels) ? r.channels
                                   : String(r.channels || '').split(/[;,]/).map(trim).filter(Boolean),
                            subject:r.subject || '', message:r.message || '',
                            url:r.url || '', payload:r.payload || '' };
                 }) };
      }),
      anomRules: (k.anomRules || []).filter(function(a){ return a && a.touchpoint && a.name; })
        .map(function(a){
          return { touchpoint:String(a.touchpoint).trim(), name:a.name,
                   condition:['contains','frequency','pattern'].indexOf(a.condition) >= 0
                               ? a.condition : 'contains',
                   keywords:a.keywords || '',
                   freqThresh:isFinite(a.freqThresh) && a.freqThresh > 0 ? a.freqThresh : null,
                   response:a.response || '',
                   channels:Array.isArray(a.channels) ? a.channels
                          : String(a.channels || '').split(/[;,]/).map(trim).filter(Boolean) };
        })
    });
  });

  if(!doc.kbrs.length && !doc.channels.length)
    return { ok:false, reason:'nothing was declared in the document', warnings:warnings };
  return { ok:true, doc:doc, warnings:warnings };
}

/* ═══ 4 · binding by meaning ═══════════════════════════════════════════════
   Exact column names win. Where a document names something in business terms
   the profile dictionary bridges it, and where nothing matches the answer
   degrades to a warning naming exactly what did not bind. */

/* `kind` narrows the pool to context columns or measures. "payload" matches
   BOTH `OHT Truck Payload State` (a context column) and `Truck Payload`
   (a measure) — genuinely ambiguous, and resolvable only by knowing whether
   the document meant a dimension or a thing being measured. The caller knows;
   this cannot guess, and guessing silently is how a config binds to the wrong
   column and nobody finds out. */
function bindName(profile, spoken, kind){
  var want = String(spoken || '').trim();
  if(!want) return null;
  var cols = columnsOf(profile, kind);

  for(var i = 0; i < cols.length; i++)
    if(cols[i].toLowerCase() === want.toLowerCase()) return cols[i];
  for(i = 0; i < cols.length; i++)
    if(cols[i].toLowerCase().indexOf(want.toLowerCase()) === 0) return cols[i];

  /* The dictionary carries a key, a unit, a role and a Spanish description for
     every bound column — so "segment", "segmento" or "ubicación" can all reach
     Pit Position without the document naming it. */
  var dict = (profile && profile.dictionary) || [];
  var w = norm(want);

  /* `group` and `role` are SHARED CATEGORIES — "5. Operador y turno" is the
     group of both Shift ID and Operator ID, and "Variable explicativa" is the
     role of seventeen entries. Matching on them cannot discriminate, and doing
     so resolved "operador" to Shift ID because Shift ID happened to come
     first. They are excluded, and the remaining fields are searched in order
     of how specifically they identify a column: the variable itself, then its
     key, then its description. */
  var TIERS = [
    function(d){ return d.variable; },
    function(d){ return d.variableKey; },
    function(d){ return d.description; }
  ];
  for(var t = 0; t < TIERS.length; t++){
    for(i = 0; i < dict.length; i++){
      var d = dict[i];
      if(norm(TIERS[t](d)).indexOf(w) < 0) continue;
      var hit = matchColumn(cols, d.variable || d.variableKey);
      if(hit) return hit;
    }
  }
  for(i = 0; i < cols.length; i++)
    if(norm(cols[i]).indexOf(w) >= 0) return cols[i];

  /* Last resort: token overlap. Accents are stripped, so "condicion de via"
     and "Condición de la vía" normalise to token sets that differ only by the
     article — a plain substring test misses it, which is not a real failure to
     understand. Every token of the query must appear; extra tokens in the
     column are fine, the reverse is not. */
  var wt = w.split(' ').filter(Boolean);
  if(wt.length > 1){
    var best = null, bestExtra = Infinity;
    var pool = cols.concat(((profile && profile.dictionary) || []).map(function(d){
      return d.description; }));
    for(i = 0; i < cols.length; i++){
      var ct = norm(cols[i]).split(' ').filter(Boolean);
      var all = wt.every(function(t){ return ct.indexOf(t) >= 0; });
      if(all && ct.length - wt.length < bestExtra){ best = cols[i]; bestExtra = ct.length - wt.length; }
    }
    if(best) return best;
    var dict2 = (profile && profile.dictionary) || [];
    for(i = 0; i < dict2.length; i++){
      var dt = norm(dict2[i].description).split(' ').filter(Boolean);
      if(wt.every(function(t){ return dt.indexOf(t) >= 0; })){
        var h2 = matchColumn(cols, dict2[i].variable || dict2[i].variableKey);
        if(h2) return h2;
      }
    }
  }
  return null;
}
function columnsOf(profile, kind){
  var out = [];
  if(kind !== 'measure')
    ((profile && profile.context) || []).forEach(function(c){ out.push(c.name); });
  if(kind !== 'context')
    ((profile && profile.measures) || []).forEach(function(m){ out.push(m.name); });
  return out;
}
function matchColumn(cols, name){
  var n = norm(name);
  for(var i = 0; i < cols.length; i++)
    if(norm(cols[i]) === n || norm(cols[i]).indexOf(n) === 0) return cols[i];
  return null;
}
function norm(s){
  return String(s == null ? '' : s).toLowerCase()
    .normalize ? String(s == null ? '' : s).toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
      : String(s || '').toLowerCase();
}

MOMENTUM.ConfigDoc = {
  version: 1, SCHEMA: SCHEMA,
  blank: blank, parse: parse, fromRows: fromRows, fromJson: fromJson,
  fromYaml: fromYaml, fromDelimited: fromDelimited, normalise: normalise,
  bindName: bindName, columnsOf: columnsOf
};

})();
