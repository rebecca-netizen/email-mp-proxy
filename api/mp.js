// api/mp.js — CommonJS + curated email override + CLIENT AUTH via env vars

// ----- Load client allow-list from environment variables -----
function loadClients() {
  const map = {};

  const c1Id = process.env.CLIENT_1_ID;
  const c1Token = process.env.CLIENT_1_TOKEN;
  if (c1Id && c1Token) {
    map[c1Id] = { token: c1Token, active: true };
  }

  const c2Id = process.env.CLIENT_2_ID;
  const c2Token = process.env.CLIENT_2_TOKEN;
  if (c2Id && c2Token) {
    map[c2Id] = { token: c2Token, active: true };
  }

  return map;
}

const CLIENTS = loadClients();

// ----- Your curated email list (RAW GitHub URL) -----
const EMAIL_SOURCE_URL =
  "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";
// Make sure this URL loads JSON in your browser (no 404)

// ----- Lightweight in-memory cache for the email list -----
let EMAILS_CACHE = null;
let EMAILS_CACHE_AT = 0;

async function loadEmails() {
  const now = Date.now();
  // refresh every 10 minutes
  if (EMAILS_CACHE && now - EMAILS_CACHE_AT < 10 * 60 * 1000) {
    return EMAILS_CACHE;
  }

  const r = await fetch(EMAIL_SOURCE_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load emails.json (${r.status})`);
  const list = await r.json();

  const byCon = Object.create(null);
  const byName = Object.create(null);

  for (const row of list) {
    if (!row) continue;
    if (row.constituency) {
      byCon[row.constituency.toLowerCase()] = row.email ?? null;
    }
    if (row.mp_name) {
      byName[row.mp_name.toLowerCase()] = row.email ?? null;
    }
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
  res.status(status).json(body);
}

// Normalize a TWFY person/MP object or single-item array to a consistent shape
function normalizePerson(raw) {
  const p = Array.isArray(raw) ? (raw[0] || {}) : raw || {};
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

    // Sanity check: do we actually have any clients configured?
    if (!CLIENTS || Object.keys(CLIENTS).length === 0) {
      return send(res, 500, {
        error: "No clients configured on server (check CLIENT_* env vars)",
      });
    }

    // ===== CLIENT AUTH =====
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
    if (!KEY) {
      return send(res, 500, { error: "API key not configured (TWFY_API_KEY)" });
    }

    // 1) Primary lookup — getMP by postcode
    const mpUrl =
      `https://www.theyworkforyou.com/api/getMP` +
      `?postcode=${encodeURIComponent(postcode)}` +
      `&output=js&key=${encodeURIComponent(KEY)}`;

    const r = await fetch(mpUrl);
    if (!r.ok) {
      return send(res, r.status, { error: `TWFY ${r.status}` });
    }

    const mp = await r.json();
    let { name, party, email, constituency, person_id } = mp || {};

    // 2) Fallback A — getPerson if MP data was incomplete
    if ((name == null || email == null) && person_id) {
      const personUrl =
        `https://www.theyworkforyou.com/api/getPerson` +
        `?id=${encodeURIComponent(person_id)}` +
        `&output=js&key=${encodeURIComponent(KEY)}`;

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
      const mpsUrl =
        `https://www.theyworkforyou.com/api/getMPs` +
        `?output=js&key=${encodeURIComponent(KEY)}` +
        `&constituency=${encodeURIComponent(constituency)}`;

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
        const override = emails.byCon[constituency.toLowerCase()];
        if (override && String(override).trim()) email = override;
        if (override === null) email = null; // explicit "no email" override
      }
      if (!email && name) {
        const override = emails.byName[name.toLowerCase()];
        if (override && String(override).trim()) email = override;
        if (override === null) email = null;
      }
    } catch (e) {
      console.warn("emails.json load failed:", e.message);
      // don't crash if emails.json is missing/broken
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
    console.error("mp.js error:", e);
    return send(res, 500, { error: e.message || "server error" });
  }
};
