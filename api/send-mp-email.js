// api/send-mp-email.js
// Simplified: no client allow-list, just sends the email + logs it

const sgMail = require("@sendgrid/mail");

const WEBHOOK = process.env.LOG_WEBHOOK_URL || "";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";

// Configure SendGrid once
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  if (!SENDGRID_API_KEY || !FROM_EMAIL) {
    res.statusCode = 500;
    return res.end("Email service not configured");
  }

  try {
    const {
      // routing fields
      to,          // MP email
      subject,
      body,

      // metadata for logging only
      userName,
      userEmail,
      mpName,
      constituency,
      postcode,
      page,
      clientId,     // optional: just logged for your info
    } = req.body || {};

    // Basic validation
    if (!to || !subject || !body || !userEmail) {
      res.statusCode = 400;
      return res.end("Missing required fields");
    }

    // Build and send email via SendGrid
    const msg = {
      to,
      from: FROM_EMAIL,     // your verified sender
      subject,
      text: body,
      replyTo: userEmail,   // MP replies go straight to the constituent
    };

    await sgMail.send(msg);

    // Optional logging to webhook (for client to see exact final text)
    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mp-email-sent",
            clientId,
            page,
            userName,
            userEmail,
            mpName,
            mpEmail: to,
            constituency,
            postcode,
            subject,
            body,
            ua: req.headers["user-agent"] || "",
            ip:
              req.headers["x-forwarded-for"] ||
              req.socket?.remoteAddress ||
              "",
            ts: new Date().toISOString(),
          }),
        });
      } catch (err) {
        console.error("Webhook log failed", err);
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error("send-mp-email error", err);
    res.statusCode = 500;
    res.end("Error sending email");
  }
};
