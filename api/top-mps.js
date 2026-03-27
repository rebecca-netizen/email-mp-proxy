const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";
const MP_JSON_URL = "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"' && text[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (current || row.length) {
        row.push(current);
        rows.push(row);
        row = [];
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function findColumn(headers, name) {
  return headers.findIndex(h => h.toLowerCase().includes(name));
}

export default async function handler(req, res) {
  setCors(res);

  try {
    if (!SHEET_CSV_URL) {
      return res.status(500).json({ error: "Missing SHEET_CSV_URL env var" });
    }

    const subjectFilter = (req.query.subject || "").toLowerCase();

    // FETCH CSV
    const csvRes = await fetch(SHEET_CSV_URL);
    if (!csvRes.ok) {
      return res.status(500).json({
        error: "CSV fetch failed",
        status: csvRes.status
      });
    }

    const csvText = await csvRes.text();
    const rows = parseCSV(csvText);

    if (!rows.length) {
      return res.json({ error: "CSV empty" });
    }

    const headers = rows[0];

    // DEBUG: return headers if columns not found
    const mpCol = headers.findIndex(h => h.trim().toLowerCase() === "mp");
    const emailCol = headers.findIndex(h => h.trim().toLowerCase().includes("email"));
    const subjectCol = headers.findIndex(h => h.trim().toLowerCase() === "subject");

    if (mpCol === -1 || emailCol === -1) {
      return res.json({
        error: "Column mismatch",
        headers: headers
      });
    }

    // FETCH MP JSON
    const mpRes = await fetch(MP_JSON_URL);
    const mpRaw = await mpRes.json();

    // NORMALISE MP DATA
    const mpLookup = {};

    if (Array.isArray(mpRaw)) {
      mpRaw.forEach(mp => {
        if (mp.email) {
          mpLookup[mp.email.toLowerCase()] = mp;
        }
      });
    } else {
      Object.entries(mpRaw).forEach(([email, mp]) => {
        mpLookup[email.toLowerCase()] = mp;
      });
    }

    // COUNT
    const counts = {};

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      const subject = (row[subjectCol] || "").toLowerCase();
      if (subjectFilter && !subject.includes(subjectFilter)) continue;

      const email = (row[emailCol] || "").toLowerCase();
      if (!email) continue;

      if (!counts[email]) {
        counts[email] = {
          email,
          mp: row[mpCol],
          count: 0
        };
      }

      counts[email].count++;
    }

    const result = Object.values(counts).map(item => {
  const match = mpLookup[item.email] || {};

  return {
    mp: match.mp_name || match.name || item.mp || "",
    constituency: match.constituency || "",
    party: match.party || "",
    count: item.count
  };
});

    return res.json(result.sort((a, b) => b.count - a.count).slice(0, 20));

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
