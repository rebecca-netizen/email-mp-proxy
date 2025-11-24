// api/track.js — CommonJS tracking redirect + per-client auth

const WEBHOOK = process.env.LOG_WEBHOOK_URL || ""; 

// ----- Per-client token config -----
const CLIENTS = {
  client1: process.env.CLIENT1_TOKEN || "",
  client2: process.env.CLIENT2_TOKEN || "",
  // add more clients here later (client3, client4, etc)
};

function isAuthorised(client_id, client_token) {
  if (!client_id || !client_token) return false;
  const expected = CLIENTS[client_id];
  if (!expected) return false;
  return expected === client_token;
}

module.exports = async function (req, res) {
  try {
    const q = req.query || {};

    // ----- NEW: client auth gate -----
    const client_id = (q.client_id || "").toString();
    const client_token = (q.client_token || "").toString();

    if (!isAuthorised(client_id, client_token)) {
      res.statusCode = 403;
      return res.end("unauthorised client");
    }
    // ----- END auth gate -----

    const email = (q.email || "").trim();
    const subject = q.subject || "";
    const body = q.body || "";
    const mp = q.mp || "";
    const constituency = q.constituency || "";
    const postcode = q.postcode || "";
    const page = q.page || "";
    const ua = req.headers["user-agent"] || "";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";

    if (!email) {
      res.statusCode = 400;
      return res.end("Missing email");
    }

    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            email,
            subject,
            bodyLength: body.length,
            mp,
            constituency,
            postcode,
            page,
            ua,
            ip,
            client_id
          })
        });
      } catch (e) {
        console.warn("Track webhook failed:", e.message);
      }
    }

    res.statusCode = 302;
    res.setHeader("Location", mailto);
    return res.end();

  } catch (e) {
    res.statusCode = 500;
    res.end("Tracking error");
  }
};
