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

    const mp = await r.json(); // may have name=null or email=null
    let { name, party, email, constituency, person_id } = mp || {};

    // 2) Fallback: if name or email missing but we have person_id, call getPerson
    if ((name == null || email == null) && person_id) {
      const personUrl = `https://www.theyworkforyou.com/api/getPerson?id=${encodeURIComponent(
        person_id
      )}&output=js&key=${encodeURIComponent(KEY)}`;
      const pr = await fetch(personUrl);
      if (pr.ok) {
        const person = await pr.json();
        // TheyWorkForYou fields vary; prefer 'name' then 'full_name' then 'given_name' + 'family_name'
        if (name == null) {
          name =
            person.name ||
            person.full_name ||
            [person.given_name, person.family_name].filter(Boolean).join(" ") ||
            null;
        }
        if (email == null && person.email) {
          email = person.email || null;
        }
        // party/constituency might also be available on person; keep originals if present
        party = party || person.party || null;
        constituency = constituency || person.constituency || null;
      }
    }

    // 3) Build a contact/profile URL for cases with no email
    const contact_url = person_id
      ? `https://www.theyworkforyou.com/mp/?p=${encodeURIComponent(person_id)}`
      : null;

    return send(res, 200, {
      name: name || null,
      party: party || null,
      email: email || null,
      constituency: constituency || null,
      person_id: person_id || null,
      contact_url
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
