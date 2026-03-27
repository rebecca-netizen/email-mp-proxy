const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

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

    const headers = rows[0].map(h => h.trim().toLowerCase());
    const data = rows.slice(1);

    // 🎯 Find correct columns dynamically
    const subjectIndex = headers.findIndex(h => h.includes("subject"));
    const mpIndex = headers.findIndex(h => h === "mp");
    const constituencyIndex = headers.findIndex(h => h.includes("constitu"));

    const mpCounts = {};

    data.forEach(row => {
      if (!row) return;

      const subjectField = (row[subjectIndex] || "").toLowerCase();

      // robust filter
      if (subject && !subjectField.includes(subject.toLowerCase())) return;

      const mpName = (row[mpIndex] || "").trim();
      const constituency = (row[constituencyIndex] || "").trim();

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
