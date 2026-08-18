/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Channels — the communication registry, and what may be done with it

   Ported from BOb's Response Options, where the pattern is already complete:
   a channel is defined ONCE at the workspace and referenced by id from every
   response, everywhere. "On-Call Manager" is one record holding one phone
   number, and forty conditions may point at it. Change the number once.

   MOMENTUM's free-text `slack, email…` field could not do any of that — it
   could not be validated, reused, resolved to a recipient, or audited. This
   replaces it.

   Response vocabularies are NOT shared
   ───────────────────────────────────
   Responses live in every surface that can act on one, but the ACTIONS
   available differ by surface, because a Key Business Result, a Risk Meter
   and an Answer Engine are answering different questions. The registry is
   common; the verbs are not.

   That is also how the one-notifier law survives contact with this file.
   Only the Risk Meter's vocabulary contains a type whose `notifies` is true.
   An answer may carry a response — it may record, it may flag — but there is
   no notifying verb in its vocabulary to choose, so it cannot escalate even
   by misconfiguration. The law is enforced by what can be SAID, rather than
   by a check that something else must remember to run.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* ═══ 1 · channel types ════════════════════════════════════════════════════ */

var TYPES = {
  email:   { id:'email',   label:'Email',   placeholder:'Email addresses (comma-separated)',
             example:'ops@company.com, lead@company.com', input:'email',
             validate:function(v){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); },
             invalid:'that does not look like an email address' },
  sms:     { id:'sms',     label:'SMS',     placeholder:'Phone numbers (comma-separated)',
             example:'+1-555-0199, +1-555-0200', input:'tel',
             validate:function(v){ return /^[+()\d][\d\s\-().]{5,}$/.test(v); },
             invalid:'that does not look like a phone number' },
  call:    { id:'call',    label:'Call',    placeholder:'Phone numbers (comma-separated)',
             example:'+1-555-0199', input:'tel',
             validate:function(v){ return /^[+()\d][\d\s\-().]{5,}$/.test(v); },
             invalid:'that does not look like a phone number' },
  slack:   { id:'slack',   label:'Slack',   placeholder:'Slack webhook URL or channel',
             example:'https://hooks.slack.com/services/…', input:'text',
             validate:function(v){ return /^https?:\/\//.test(v) || /^#?[\w-]{2,}$/.test(v); },
             invalid:'expected a webhook URL or a #channel' },
  webhook: { id:'webhook', label:'Webhook', placeholder:'Endpoint URL',
             example:'https://api.example.com/webhook', input:'url',
             validate:function(v){ return /^https?:\/\/.+/.test(v); },
             invalid:'expected an http(s) URL' }
};
var TYPE_ORDER = ['email','sms','slack','call','webhook'];

/* ═══ 2 · the registry ═════════════════════════════════════════════════════ */

/* Workspace-level. Not per-KBR — re-entering the on-call manager for every
   result is exactly the failure this replaces. */
var registry = [];
var idCounter = 1;

function list(){ return registry.slice(); }
function get(id){
  for(var i = 0; i < registry.length; i++) if(registry[i].id === id) return registry[i];
  return null;
}
function add(type, label, values){
  if(!TYPES[type]) return { ok:false, reason:'unknown channel type: ' + type };
  var lab = String(label == null ? '' : label).trim();
  if(!lab) return { ok:false, reason:'a channel needs a name' };
  var vals = splitValues(values);
  if(!vals.length) return { ok:false, reason:'a channel needs at least one destination' };
  var bad = vals.filter(function(v){ return !TYPES[type].validate(v); });
  if(bad.length) return { ok:false, reason:TYPES[type].invalid + ': ' + bad[0] };
  var ch = { id:'nc' + (idCounter++), type:type, label:lab, values:vals };
  registry.push(ch);
  return { ok:true, channel:ch };
}
function update(id, label, values){
  var ch = get(id);
  if(!ch) return { ok:false, reason:'no such channel' };
  var lab = String(label == null ? '' : label).trim();
  var vals = splitValues(values);
  if(!lab) return { ok:false, reason:'a channel needs a name' };
  if(!vals.length) return { ok:false, reason:'a channel needs at least one destination' };
  var bad = vals.filter(function(v){ return !TYPES[ch.type].validate(v); });
  if(bad.length) return { ok:false, reason:TYPES[ch.type].invalid + ': ' + bad[0] };
  ch.label = lab; ch.values = vals;
  return { ok:true, channel:ch };
}
/** Removing a channel must not leave responses pointing at nothing, so the
 *  caller is told what references it before the removal is committed. */
function remove(id, referencesFn){
  var refs = typeof referencesFn === 'function' ? (referencesFn(id) || []) : [];
  registry = registry.filter(function(c){ return c.id !== id; });
  return { ok:true, orphaned:refs };
}
function splitValues(v){
  if(Array.isArray(v)) return v.map(trim).filter(Boolean);
  return String(v == null ? '' : v).split(',').map(trim).filter(Boolean);
}
function trim(s){ return String(s).trim(); }

/** Merge declarations from a Config Doc. Document wins on an id collision;
 *  channels the user created by hand are left untouched. */
function merge(declared){
  var added = 0, replaced = 0;
  (declared || []).forEach(function(d){
    if(!d || !TYPES[d.type] || !d.id) return;
    var existing = get(d.id);
    var rec = { id:d.id, type:d.type, label:String(d.label || d.id),
                values:splitValues(d.values), declared:true };
    if(existing){
      registry[registry.indexOf(existing)] = rec; replaced++;
    } else { registry.push(rec); added++; }
  });
  return { added:added, replaced:replaced, total:registry.length };
}
function reset(){ registry = []; idCounter = 1; }

/* ═══ 3 · response vocabularies, one per surface ═══════════════════════════ */

/* `notifies` is the whole point of this table. Exactly one surface has a verb
   that carries it. */
var VOCAB = {
  risk: [
    { type:'alert',  label:'Alert',  notifies:false, acts:false, icon:'warning',
      fields:['channels','subject','message'],
      hint:'records the breach and routes it to the chosen channels' },
    { type:'alarm',  label:'Alarm',  notifies:true,  acts:false, icon:'bell',
      fields:['channels','subject','message'],
      hint:'escalates — the only response in the product that notifies' },
    { type:'action', label:'Action', notifies:true,  acts:true,  icon:'bolt',
      fields:['url','payload'],
      hint:'escalates and fires a webhook against an external system' }
  ],
  kbr: [
    { type:'note',   label:'Note',   notifies:false, acts:false, icon:'note',
      fields:['message'],
      hint:'annotates the result when the target is missed — pace reports facts' },
    { type:'report', label:'Report', notifies:false, acts:false, icon:'doc',
      fields:['channels','subject','message'],
      hint:'sends a periodic summary of attainment, not an escalation' }
  ],
  answer: [
    { type:'flag',   label:'Flag',   notifies:false, acts:false, icon:'flag',
      fields:[],
      hint:'marks the answer locally — concentration, margin leak, variance' },
    { type:'note',   label:'Note',   notifies:false, acts:false, icon:'note',
      fields:['message'],
      hint:'records why the answer was flagged, alongside it' }
  ]
};
function vocabulary(surface){ return (VOCAB[surface] || []).slice(); }
function responseType(surface, type){
  var v = VOCAB[surface] || [];
  for(var i = 0; i < v.length; i++) if(v[i].type === type) return v[i];
  return null;
}
/** The law, expressed as a question anything may ask. */
function canNotify(surface, type){
  var rt = responseType(surface, type);
  return !!(rt && rt.notifies);
}
function notifyingSurfaces(){
  return Object.keys(VOCAB).filter(function(s){
    return VOCAB[s].some(function(r){ return r.notifies; });
  });
}

/* ═══ 4 · responses ════════════════════════════════════════════════════════ */

function newResponse(surface, type){
  var rt = responseType(surface, type);
  if(!rt) return null;
  return { type:type, name:'', channels:[], subject:'', message:'',
           url:'', payload:'' };
}
/** Channel ids resolved to records, silently dropping any that have been
 *  removed — a dangling id must never render as a blank recipient. */
function resolve(response){
  return ((response && response.channels) || [])
    .map(get).filter(Boolean);
}
/** Substitute the template placeholders BOb uses. */
function fill(template, ctx){
  ctx = ctx || {};
  return String(template == null ? '' : template)
    .replace(/\{\{\s*(\w+)\s*\}\}/g, function(m, k){
      return ctx[k] != null ? String(ctx[k]) : m;
    });
}

/* ═══ 5 · workspace escalation settings ════════════════════════════════════
   Proximity is a VISUAL LANGUAGE, not a business rule: if one column pulses
   fast at 10% and another at 40%, a fast pulse stops meaning anything and the
   board stops being scannable. So it is editable once, here, and never per
   KBR. Cooldown is a default a KBR may override, because cadence genuinely
   differs between per-second telemetry and a monthly finance result.        */

var settings = {
  proxWarning: 0.20,      /* within 20% of threshold → slow pulse  · global   */
  proxUrgent:  0.10,      /* within 10% → fast pulse              · global   */
  sustainedTicks: 20,     /* held this long → critical, any size             */
  cooldownMs: 22500       /* default refire window · per-KBR overridable     */
};
function getSettings(){
  var o = {}; for(var k in settings) if(settings.hasOwnProperty(k)) o[k] = settings[k];
  return o;
}
function setSetting(key, value){
  if(!settings.hasOwnProperty(key)) return { ok:false, reason:'unknown setting' };
  var v = parseFloat(value);
  if(!isFinite(v)) return { ok:false, reason:'not a number' };
  if((key === 'proxWarning' || key === 'proxUrgent') && (v <= 0 || v > 1))
    return { ok:false, reason:'proximity is a fraction between 0 and 1' };
  if(v < 0) return { ok:false, reason:'cannot be negative' };
  settings[key] = v;
  return { ok:true, settings:getSettings() };
}
/** A KBR may override cooldown and nothing else. */
function cooldownFor(kbr){
  var o = kbr && kbr.risk && kbr.risk.cooldownMs;
  return (o != null && isFinite(o)) ? o : settings.cooldownMs;
}

MOMENTUM.Channels = {
  version: 1,
  TYPES: TYPES, TYPE_ORDER: TYPE_ORDER,
  list: list, get: get, add: add, update: update, remove: remove,
  merge: merge, reset: reset, splitValues: splitValues,
  VOCAB: VOCAB, vocabulary: vocabulary, responseType: responseType,
  canNotify: canNotify, notifyingSurfaces: notifyingSurfaces,
  newResponse: newResponse, resolve: resolve, fill: fill,
  getSettings: getSettings, setSetting: setSetting, cooldownFor: cooldownFor
};

})();
