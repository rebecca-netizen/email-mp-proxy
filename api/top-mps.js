const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

// Your actual GitHub raw JSON (corrected)
const MP_JSON_URL = "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Robust CSV parser
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

// Find column by name (case insensitive)
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
    if (!SHEET_CSV_URL) {
      return res.status(500).json({ error: "Missing SHEET_CSV_URL" });
    }

    const subjectFilter = (req.query.subject || "").toLowerCase();

    // Fetch both sources
    const [csvRes, mpRes] = await Promise.all([
      fetch(SHEET_CSV_URL),
      fetch(MP_JSON_URL)
    ]);

    const csvText = await csvRes.text();
    const mpList = await mpRes.json();

    const rows = parseCSV(csvText);

    if (!rows.length) {
      return res.json([]);
    }

    const headers = rows[0];

    const mpCol = findColumn(headers, ["mp"]);
    const emailCol = findColumn(headers, ["email"]);
    const subjectCol = findColumn(headers, ["subject"]);

    if (mpCol === undefined || emailCol === undefined) {
      return res.status(500).json({
        error: "Required columns not found (need MP and Email)"
      });
    }

    // STEP 1: count emails per MP (by email = stable key)
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

    // STEP 2: build lookup from GitHub MP list (by email)
    const mpLookup = {};
    mpList.forEach(mp => {
      if (mp.email) {
        mpLookup[mp.email.toLowerCase()] = mp;
      }
    });

    // STEP 3: merge data
    const result = Object.values(counts).map(item => {
      const match = mpLookup[item.email] || {};

      return {
        mp: match.name || item.mp || "",
        constituency: match.constituency || "",
        party: match.party || "",
        count: item.count
      };
    });

    // STEP 4: sort + limit
    const sorted = result
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json(sorted);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
