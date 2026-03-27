const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";
const MP_JSON_URL = "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

function findColumn(headers, options) {
  const lower = headers.map(h => h.toLowerCase());
  return options
    .map(opt => lower.indexOf(opt.toLowerCase()))
    .find(i => i !== -1);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const subjectFilter = (req.query.subject || "").toLowerCase();

    const [csvRes, mpRes] = await Promise.all([
      fetch(SHEET_CSV_URL),
      fetch(MP_JSON_URL)
    ]);

    const csvText = await csvRes.text();
    const mpRaw = await mpRes.json();

    const rows = parseCSV(csvText);
    if (!rows.length) return res.json([]);

    const headers = rows[0];

    const mpCol = findColumn(headers, ["mp"]);
    const emailCol = findColumn(headers, ["email"]);
    const subjectCol = findColumn(headers, ["subject"]);

    if (mpCol === undefined || emailCol === undefined) {
      return res.status(500).json({ error: "Missing MP or Email column" });
    }

    // STEP 1: count emails
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

    // STEP 2: normalise GitHub data (handles object OR array)
    const mpLookup = {};

    if (Array.isArray(mpRaw)) {
      mpRaw.forEach(mp => {
        if (mp.email) {
          mpLookup[mp.email.toLowerCase()] = mp;
        }
      });
    } else {
      // object map case (THIS is likely your structure)
      Object.entries(mpRaw).forEach(([email, mp]) => {
        mpLookup[email.toLowerCase()] = mp;
      });
    }

    // STEP 3: merge
    const result = Object.values(counts).map(item => {
      const match = mpLookup[item.email] || {};

      return {
        mp: match.name || item.mp || "",
        constituency: match.constituency || "",
        party: match.party || "",
        count: item.count
      };
    });

    const sorted = result
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json(sorted);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
