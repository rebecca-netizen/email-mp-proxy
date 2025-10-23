export default async function handler(req, res) {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      setCORS(res);
      return res.status(200).end();
    }

    const { postcode } = req.query;
    if (!postcode) return send(res, 400, { error: "postcode is required" });

    const KEY = process.env.TWFY_API_KEY;
    if (!KEY) return send(res, 500, { error: "API key not configured" });

    // 1) Primary lookup: getMP by postcode
    const mpUrl = `https://www.theyworkforyou.com/api/getMP?postcode=${encodeURIComponent(
      postcode
    )}&output=js&key=${encodeURIComponent(KEY)}`;

    const r = await fetch(mpUrl);
    if (!r.ok) return send(res, r.status, { error: `TWFY ${r.status}` });

    const mp = await r.json(); // may have name/email null
    let { name, party, email, constituency, person_id } = mp || {};

    // ---- Helper to normalize person/getMPs responses ----
   const normalizePerson = (raw) => {
  const p = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
  const n =
    p.name ||
    p.full_name ||
    [p.given_name, p.family_name].filter(Boolean).join(" ") ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    null;
  return {
    name: n || null,
    party: p.party || null,
    email: p.email || null,
    constituency: p.constituency || null,
    person_id: p.person_id || p.id || null,
  };
};


    // 2) Fallback A: if name/email missing but we have person_id → getPerson
    if ((name == null || email == null) && person_id) {
      const personUrl = `https://www.theyworkforyou.com/api/getPerson?id=${encodeURIComponent(
        person_id
      )}&output=js&key=${encodeURIComponent(KEY)}`;
      const pr = await fetch(personUrl);
      if (pr.ok) {
        const personRaw = await pr.json();
        const p = normalizePerson(personRaw);
        if (name == null) name = p.name;
        if (email == null) email = p.email;
        if (!party && p.party) party = p.party;
        if (!constituency && p.constituency) constituency = p.constituency;
      }
    }

    // 3) Fallback B: if we STILL don’t have a name, try getMPs (filters)
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

    const contact_url = person_id
      ? `https://www.theyworkforyou.com/mp/?p=${encodeURIComponent(person_id)}`
      : null;

    return send(res, 200, {
      name: name || null,
      party: party || null,
      email: email || null,
      constituency: constituency || null,
      person_id: person_id || null,
      contact_url,
    });
  } catch (e) {
    return send(res, 500, { error: e.message || "server error" });
  }
}

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, status, body) {
  setCORS(res);
  res.status(status).json(body);
}
