// api/mp.js — CommonJS + robust fallbacks + curated email override + CLIENT AUTH via ENV

const { lookup: emergencyLookup } = require('../lib/postcode-fallback');

// Bound upstream waits, including response-body reads. No upstream URL/error logging.
async function readJSON(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  } finally {
    clearTimeout(timer);
  }
}

function emergencyResponse(postcode, res) {
  try {
    const mp = emergencyLookup(postcode);
    if (mp) {
      console.info('MP lookup: emergency success');
      return send(res, 200, mp);
    }
    console.warn('MP lookup: emergency unavailable');
  } catch (_) {
    console.warn('MP lookup: emergency data error');
  }
  return send(res, 503, { error: "We couldn't look up your MP just now. Please try again shortly." });
}

// ----- Build client allow-list from environment variables -----
function buildClientsFromEnv() {
  const result = {};

  const c1Id = process.env.CLIENT_1_ID;
  const c1Token = process.env.CLIENT_1_TOKEN;
  if (c1Id && c1Token) {
    result[c1Id] = {
      token: c1Token,
      active: true,
    };
  }

  const c2Id = process.env.CLIENT_2_ID;
  const c2Token = process.env.CLIENT_2_TOKEN;
  if (c2Id && c2Token) {
    result[c2Id] = {
      token: c2Token,
      active: true,
    };
  }

  return result;
}

const CLIENTS = buildClientsFromEnv();

// ----- Your curated email list (RAW GitHub URL) -----
const EMAIL_SOURCE_URL =
  "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";
// Make sure the URL above loads JSON in your browser (no 404)

// ----- Lightweight in-memory cache for the email list -----
let EMAILS_CACHE = null;
let EMAILS_CACHE_AT = 0;

async function loadEmails() {
  const now = Date.now();
  // refresh every 10 minutes
  if (EMAILS_CACHE && now - EMAILS_CACHE_AT < 10 * 60 * 1000) return EMAILS_CACHE;

  const r = await readJSON(EMAIL_SOURCE_URL, 2000);
  if (!r.ok) throw new Error(`Failed to load emails.json (${r.status})`);
  const list = r.body;

  // Build lookups (case-insensitive)
  const byCon = Object.create(null);
  const byName = Object.create(null);
  for (const row of list) {
    if (!row) continue;
    if (row.constituency) byCon[row.constituency.toLowerCase()] = row.email ?? null;
    if (row.mp_name) byName[row.mp_name.toLowerCase()] = row.email ?? null;
  }

  EMAILS_CACHE = { byCon, byName };
  EMAILS_CACHE_AT = now;
  return EMAILS_CACHE;
}

// ----- Helpers -----
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Client-Id, X-Client-Token"
  );
}

function send(res, status, body) {
  setCORS(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// Normalize a TWFY person/MP object or single-item array to a consistent shape
function normalizePerson(raw) {
  const p = Array.isArray(raw) ? raw[0] || {} : raw || {};
  const name =
    p.name ||
    p.full_name ||
    [p.given_name, p.family_name].filter(Boolean).join(" ") ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    null;

  return {
    name: name || null,
    party: p.party || null,
    email: p.email || null,
    constituency: p.constituency || null,
    person_id: p.person_id || p.id || null,
  };
}

// ----- Serverless function (CommonJS export) -----
module.exports = async function (req, res) {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      setCORS(res);
      res.statusCode = 200;
      return res.end();
    }

    // ===== CLIENT AUTH via env-driven CLIENTS map =====
    const clientId = req.headers["x-client-id"] || req.query.client_id || null;
    const clientToken = req.headers["x-client-token"] || req.query.token || null;

    if (!clientId || !clientToken) {
      return send(res, 401, { error: "Missing client credentials" });
    }

    const client = CLIENTS[clientId];
    if (!client || !client.active || client.token !== clientToken) {
      return send(res, 403, { error: "Invalid or inactive client" });
    }
    // ===== END CLIENT AUTH =====

    const { postcode } = req.query || {};
    if (!postcode) return send(res, 400, { error: "postcode is required" });

    const KEY = process.env.TWFY_API_KEY;
    if (!KEY) return send(res, 500, { error: "API key not configured" });

    // 1) Primary lookup — getMP by postcode
    const mpUrl = `https://www.theyworkforyou.com/api/getMP?postcode=${encodeURIComponent(
      postcode
    )}&output=js&key=${encodeURIComponent(KEY)}`;
    let r;
    try {
      r = await readJSON(mpUrl);
    } catch (_) {
      return emergencyResponse(postcode, res);
    }
    if (!r.ok) {
      if (r.status >= 500 || r.status === 429) return emergencyResponse(postcode, res);
      return send(res, r.status, { error: `TWFY ${r.status}` });
    }
    let { name, party, email, constituency, person_id } = normalizePerson(r.body);

    // 2) Fallback A — getPerson if MP data was incomplete
    if ((name == null || email == null) && person_id) {
      const personUrl = `https://www.theyworkforyou.com/api/getPerson?id=${encodeURIComponent(
        person_id
      )}&output=js&key=${encodeURIComponent(KEY)}`;
      const pr = await readJSON(personUrl).catch(() => ({ ok: false }));
      if (pr.ok) {
        const personRaw = pr.body;
        const p = normalizePerson(personRaw);
        if (name == null && p.name) name = p.name;
        if (email == null && p.email) email = p.email;
        if (!party && p.party) party = p.party;
        if (!constituency && p.constituency) constituency = p.constituency;
      }
    }

    // 3) Fallback B — getMPs by constituency if still missing
    if (name == null && constituency) {
      const mpsUrl = `https://www.theyworkforyou.com/api/getMPs?output=js&key=${encodeURIComponent(
        KEY
      )}&constituency=${encodeURIComponent(constituency)}`;
      const mr = await readJSON(mpsUrl).catch(() => ({ ok: false }));
      if (mr.ok) {
        const listRaw = mr.body; // often an array
        const p = normalizePerson(listRaw);
        if (!name && p.name) name = p.name;
        if (!party && p.party) party = p.party;
        if (!email && p.email) email = p.email;
        if (!person_id && p.person_id) person_id = p.person_id;
      }
    }

    if (!name || !constituency) return emergencyResponse(postcode, res);

    // 4) Override email from curated list
    try {
      const emails = await loadEmails();
      if (constituency) {
        const byCon = emails.byCon[constituency.toLowerCase()];
        if (byCon && String(byCon).trim()) email = byCon;
        if (byCon === null) email = null;
      }
      if (!email && name) {
        const byName = emails.byName[name.toLowerCase()];
        if (byName && String(byName).trim()) email = byName;
        if (byName === null) email = null;
      }
    } catch (e) {
      console.warn("MP lookup: curated email refresh failed");
    }

    // 5) Contact page URL
    const contact_url = person_id
      ? `https://www.theyworkforyou.com/mp/?p=${encodeURIComponent(person_id)}`
      : null;

    // 6) Respond
    return send(res, 200, {
      name: name || null,
      party: party || null,
      email: email || null,
      constituency: constituency || null,
      person_id: person_id || null,
      contact_url,
    });
  } catch (e) {
    console.error("MP lookup: handler error");
    return send(res, 500, { error: "server error" });
  }
};
