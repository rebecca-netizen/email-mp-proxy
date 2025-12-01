// api/send-mp-email.js
// Server-side MP email sender using SendGrid + webhook logging + CORS

const sgMail = require("@sendgrid/mail");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const WEBHOOK = process.env.LOG_WEBHOOK_URL || "";

// Configure SendGrid once
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else {
  console.warn("SENDGRID_API_KEY is not set – send-mp-email will fail to send mail.");
}

function setCors(res) {
  // If you want to lock this down, replace * with your site origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function (req, res) {
  setCors(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  try {
    const {
      // Routing
      to,          // MP email
      subject,
      body,

      // User + MP metadata
      userName,
      userEmail,
      mpName,
      constituency,
      postcode,
      page,

      // Optional: passed through from front end, but NOT validated here
      clientId,
      clientToken,

      // Campaign-level consent flag from front end ("yes"/"no")
      consent,

      // NEW: specific consent for Andrew Griffith MP ("yes"/"no")
      consent_ag,
    } = req.body || {};

    if (!FROM_EMAIL) {
      res.statusCode = 500;
      return res.end("Email service not configured (FROM_EMAIL missing)");
    }

    // Basic validation
    if (!to || !subject || !body || !userEmail) {
      res.statusCode = 400;
      return res.end("Missing required fields");
    }

    if (!SENDGRID_API_KEY) {
      res.statusCode = 500;
      return res.end("Email service not configured (API key missing)");
    }

    // Build and send email via SendGrid
    const msg = {
      to,
      from: FROM_EMAIL,    // your verified sender (mailer@emailyourmp.org.uk)
      subject,
      text: body,
      replyTo: userEmail,  // MP replies go to the constituent
    };

    await sgMail.send(msg);

    // Webhook logging – THIS is where you’ll see the body
    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mp-email-sent",
            clientId: clientId || null,
            clientToken: clientToken || null,
            page: page || null,

            userName: userName || null,
            userEmail: userEmail || null,

            mpName: mpName || null,
            mpEmail: to,
            constituency: constituency || null,
            postcode: postcode || null,

            subject,
            body, // full final email text

            // Campaign-level consent ("yes"/"no" from front end, or null)
            consent: consent || null,

            // NEW: Andrew Griffith–specific consent ("yes"/"no" from front end, or null)
            consent_ag: consent_ag || null,

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

    // Success response for the front end
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error("send-mp-email error", err);
    res.statusCode = 500;
    res.end("Error sending email");
  }
};
