const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

// Add parties for top MPs here (extend as needed)
const PARTY_LOOKUP = {
  "Lauren Edwards": "Labour",
  "Rachel Blake": "Labour",
  "Zoe Franklin": "Liberal Democrat",
  "Julian Smith": "Conservative"
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// CSV parser (handles commas inside quotes)
function parseCSV(text) {
  const rows = [];
  let current = '';
  let insideQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      row.push(current);
      current = '';
    } else if (char === '\n' && !insideQuotes) {
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  return rows;
}

module.exports = async function (req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const { subject } = req.query;

    const response = await fetch(SHEET_CSV_URL);
    const text = await response.text();

    const rows = parseCSV(text);
    const data = rows.slice(1);

    const mpCounts = {};

    data.forEach(row => {
      if (!row || row.length < 8) return;

      const subjectField = (row[4] || "").toLowerCase();

      // Reliable filter (use "licence" in frontend)
      if (subject && !subjectField.includes(subject.toLowerCase())) return;

      const mpName = (row[6] || "").trim();
      const constituency = (row[7] || "").trim();

      if (!mpName) return;

      const key = mpName + "|" + constituency;

      if (!mpCounts[key]) mpCounts[key] = 0;
      mpCounts[key]++;
    });

    const sorted = Object.entries(mpCounts)
      .map(([key, count]) => {
        const [name, constituency] = key.split("|");

        return {
          name,
          constituency,
          party: PARTY_LOOKUP[name] || "",
          count
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: sorted }));

  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed" }));
  }
};
