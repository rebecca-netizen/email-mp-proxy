// api/log.js — copy logging to webhook (NO auth errors, CORS-friendly)

const WEBHOOK = process.env.LOG_WEBHOOK_URL || ""; // optional

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function (req, res) {
  try {
    if (req.method === "OPTIONS") {
      setCORS(res);
      res.statusCode = 200;
      return res.end();
    }

    if (req.method !== "POST") {
      setCORS(res);
      res.statusCode = 405;
      return res.end("Method not allowed");
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "copy_message",
            ts: new Date().toISOString(),
            ...data,
          }),
        });
      } catch (err) {
        console.error("WEBHOOK error in /api/log:", err);
      }
    }

    setCORS(res);
    res.statusCode = 204;
    return res.end();
  } catch (e) {
    console.error("Error in /api/log:", e);
    setCORS(res);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
