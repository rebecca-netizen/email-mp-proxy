// api/send-mp-email.js
// Server-side MP email sender using SendGrid, with CORS

const sgMail = require("@sendgrid/mail");

const WEBHOOK = process.env.LOG_WEBHOOK_URL || "";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";

// Configure SendGrid once
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

module.exports = async function (req, res) {
  // CORS headers for all requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    // Preflight
    res.statusCode = 204;
    return res.end();
  }

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
      // required
      to,          // MP email
      subject,
      body,
      userEmail,

      // optional metadata
      userName,
      mpName,
      constituency,
      postcode,
      page,
    } = req.body || {};

    if (!to || !subject || !body || !userEmail) {
      res.statusCode = 400;
      return res.end("Missing required fields");
    }

    const msg = {
      to,
      from: FROM_EMAIL,      // your verified sender (mailer@emailyourmp.org.uk)
      subject,
      text: body,
      replyTo: userEmail,    // MP replies go to the constituent
    };

    await sgMail.send(msg);

    // Optional webhook logging with full final text
    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mp-email-sent",
            to,
            subject,
            body,
            userEmail,
            userName: userName || null,
            mpName: mpName || null,
            constituency: constituency || null,
            postcode: postcode || null,
            page: page || null,
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
