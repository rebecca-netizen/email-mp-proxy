// api/track.js — tracking redirect with optional webhook logging (NO auth errors)

const WEBHOOK = process.env.LOG_WEBHOOK_URL || ""; // optional

module.exports = async function (req, res) {
  try {
    const q = req.query || {};

    const email        = (q.email || "").trim();
    const subject      = q.subject || "";
    const body         = q.body || "";
    const mp           = q.mp || "";
    const constituency = q.constituency || "";
    const postcode     = q.postcode || "";
    const page         = q.page || "";

    // These are just metadata now – **no auth check**
    const clientId    = q.client_id || "";
    const clientToken = q.client_token || "";

    const ua = req.headers["user-agent"] || "";
    const ip =
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "";

    if (!email) {
      res.statusCode = 400;
      return res.end("Missing email");
    }

    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;

    // Optional logging to your webhook
    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "send_email",
            ts: new Date().toISOString(),
            client_id: clientId || null,
            client_token: clientToken || null,
            email,
            subject,
            body,
            mp,
            constituency,
            postcode,
            page,
            ua,
            ip,
          }),
        });
      } catch (err) {
        console.error("WEBHOOK error in /api/track:", err);
        // We intentionally ignore webhook failures so the redirect still works
      }
    }

    // Redirect to the user's mail client
    res.statusCode = 302;
    res.setHeader("Location", mailto);
    return res.end();
  } catch (e) {
    console.error("Error in /api/track:", e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
