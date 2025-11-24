// api/mp.js — CommonJS + robust fallbacks + curated email override + CLIENT AUTH via ENV

// ----- Client allow-list built from ENV (with sane defaults) -----

// These give you both:
// - ENV-based configuration on Vercel, and
// - Working defaults for local/dev if env vars aren't set.
const CLIENTS = (() => {
  const clients = {};

  const c1Id    = process.env.CLIENT_1_ID    || "client_1";
  const c1Token = process.env.CLIENT_1_TOKEN || "client1_2473981238514b15b59889f0c16163f1";

  const c2Id    = process.env.CLIENT_2_ID    || "client_2";
  const c2Token = process.env.CLIENT_2_TOKEN || "client2_3aa211db5a4048ffa1bd6521e984b719";

  if (c1Id && c1Token) {
    clients[c1Id] = { token: c1Token, active: true };
  }
  if (c2Id && c2Token) {
    clients[c2Id] = { token: c2Token, active: true };
  }

  return clients;
})();

// ----- Your curated email list (RAW GitHub URL) -----
// You can also move this into an env var if you want:
const EMAIL_SOURCE_URL =
  process.env.EMAIL_SOURCE_URL ||
  "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";
// Make sure the URL above loads JSON in your browser (no 404)

// ----- Lightweight in-memory cache for the email list -----
let EMAILS_CACHE = null;
let EMAILS_CACHE_AT = 0;

async function loadEmails() {
  const now = Date.now();
  // refresh every 10 minutes
  if (EMAILS_CACHE && (now - EMAILS_CACHE_AT) < 10 * 60 * 1000) return EMAILS_CACHE;

  const r = await fetch(EMAIL_SOURCE_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load emails.json (${r.status})`);
  const list = await r.json();

  // Build lookups (case-insensitive)
  const byCon = Object.create(null);
  const byName = Object.create(null);
  for (const row of list) {
    if (!row) continue;
    if (row.constituency) byCon[row.constituency.toLowerCase()] = row.email ?? null;
    if (row.mp_name)     byName[row.mp_name.toLowerCase()]       = row.email ?? null;
  }

  EMAILS_CACHE = { byCon, byName };
  EMAILS_CACHE_AT = now;
  return EMAILS_CACHE;
}

// ----- Helpers -----
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-Client-Token");
}
function send(res, status, body) {
  setCORS(res);
  res.status(status).json(body);
}

// Normalize a TWFY person/MP object or single-item array to a consistent shape
function normalizePerson(raw) {
  const p = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
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
      return res.status(200).end();
    }

    // ===== CLIENT AUTH (must match env or defaults above) =====
    const clientId =
      req.headers["x-client-id"] ||
      req.query.client_id ||
      null;

    const clientToken =
      req.headers["x-client-token"] ||
      req.query.token ||
      null;

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
    const r = await fetch(mpUrl);
    if (!r.ok) return send(res, r.status, { error: `TWFY ${r.status}` });

    const mp = await r.json();
    let { name, party, email, constituency, person_id, error: twfyError } = mp || {};

    // If TWFY explicitly says "No data", treat as not found
    if (twfyError || (!name && !person_id)) {
      return send(res, 404, { error: "No MP found for that postcode" });
    }

    // 2) Fallback A — getPerson if MP data was incomplete
    if ((name == null || email == null) && person_id) {
      const personUrl = `https://www.theyworkforyou.com/api/getPerson?id=${encodeURIComponent(
        person_id
      )}&output=js&key=${encodeURIComponent(KEY)}`;
      const pr = await fetch(personUrl);
      if (pr.ok) {
        const personRaw = await pr.json();
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
      const mr = await fetch(mpsUrl);
      if (mr.ok) {
        const listRaw = await mr.json(); // often an array
        const p = normalizePerson(listRaw);
        if (!name && p.name) name = p.name;
        if (!party && p.party) party = p.party;
        if (!email && p.email) email = p.email;
        if (!person_id && p.person_id) person_id = p.person_id;
      }
    }

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
      console.warn("emails.json load failed:", e.message);
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
    return send(res, 500, { error: e.message || "
