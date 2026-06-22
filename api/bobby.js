// api/bobby.js — MOMENTUM Claude proxy (Vercel serverless function)
//
// The front end calls `${window.MOMENTUM_API_BASE}/bobby` (i.e. /api/bobby in
// production). This function injects the Anthropic API key server-side and
// forwards the request, so the key is NEVER exposed in the browser.
//
// The app sends bodies shaped like:
//   { model, max_tokens, system?, messages, tools?, mcp_servers? }
// We pass that straight through to https://api.anthropic.com/v1/messages and
// return Anthropic's JSON verbatim.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 60000;

// Allowlist of models the proxy will forward. Keeps the public endpoint from
// being used as an open relay for arbitrary/expensive models.
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
]);

function setCors(res, origin) {
  // Same-origin in production; '*' is safe here because no cookies/credentials
  // are used and the key never leaves the server.
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: { type: 'method_not_allowed', message: 'Use POST.' } });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { type: 'config_error', message: 'ANTHROPIC_API_KEY is not set on the server.' } });
    return;
  }

  // Vercel parses JSON bodies automatically; guard for the raw-string case too.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { res.status(400).json({ error: { type: 'invalid_json', message: 'Request body is not valid JSON.' } }); return; }
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Body must include a messages array.' } });
    return;
  }
  if (body.model && !ALLOWED_MODELS.has(body.model)) {
    res.status(400).json({ error: { type: 'model_not_allowed', message: `Model ${body.model} is not permitted.` } });
    return;
  }

  // Forward only the fields the Messages API expects; ignore anything else.
  const forward = {
    model: body.model || 'claude-sonnet-4-6',
    max_tokens: body.max_tokens || 1024,
    messages: body.messages,
  };
  if (body.system) forward.system = body.system;
  if (body.tools) forward.tools = body.tools;
  if (body.mcp_servers) forward.mcp_servers = body.mcp_servers;
  if (typeof body.temperature === 'number') forward.temperature = body.temperature;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  // The MCP connector / beta tools require a beta header; pass it through if the
  // app ever sends mcp_servers so those Artifacts keep working in production.
  if (body.mcp_servers) headers['anthropic-beta'] = 'mcp-client-2025-04-04';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(forward),
      signal: controller.signal,
    });

    const text = await upstream.text();
    // Pass Anthropic's status and JSON straight back to the client.
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    res.status(aborted ? 504 : 502).json({
      error: {
        type: aborted ? 'timeout' : 'upstream_error',
        message: aborted ? 'Anthropic request timed out.' : 'Failed to reach Anthropic API.',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
