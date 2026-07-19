/**
 * Cloudflare Pages Function — Kontaktformular
 * Endpoint:  POST /api/contact
 *
 * Nimmt die Formulardaten als JSON entgegen, validiert sie serverseitig,
 * blockt Spam per Honeypot und versendet zwei E-Mails über die Brevo API:
 *   1) Benachrichtigung an info@alpenglanz-hausservice.at (mit allen Daten)
 *   2) automatische Bestätigung an den Kunden
 *
 * Der Brevo API-Key wird AUSSCHLIESSLICH aus env.BREVO_API_KEY gelesen
 * (Cloudflare Secret) — niemals aus dem Quellcode.
 *
 * Verwendet nur die Standard Cloudflare Worker / Fetch API. Keine Bibliotheken.
 */

/* ----------------------------- Konfiguration ----------------------------- */

const OWNER_EMAIL      = 'info@alpenglanz-hausservice.at';
const OWNER_NAME       = 'AlpenGlanz Hausservice';
const SUBJECT_OWNER    = 'Neue Kontaktanfrage über die Website';
const SUBJECT_CUSTOMER = 'Vielen Dank für Ihre Anfrage';
const BREVO_ENDPOINT   = 'https://api.brevo.com/v3/smtp/email';

// Erlaubte Origins für CORS (Live-Domain + lokale Test-Server).
const ALLOWED_ORIGINS = [
  'https://alpenglanz-hausservice.at',
  'https://www.alpenglanz-hausservice.at',
  'http://localhost:8126',
  'http://localhost:5500',
];

// Zentrale Erfolgs-/Fehlertexte (Deutsch, wie vom Formular erwartet).
const MSG_SUCCESS = 'Vielen Dank. Ihre Anfrage wurde erfolgreich versendet.';
const MSG_ERROR   = 'Beim Versenden ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.';

/* ------------------------------- Helfer ---------------------------------- */

/** Baut die CORS-Header. Spiegelt eine erlaubte Origin, sonst die Hauptdomain. */
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/** Erzeugt eine JSON-Antwort inklusive CORS-Header. */
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

/** Escaped HTML-Sonderzeichen, damit Nutzereingaben nicht als HTML wirken. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Einfache, robuste E-Mail-Prüfung. */
function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ------------------------------- Routen ---------------------------------- */

/** CORS-Preflight (Browser schickt OPTIONS vor dem eigentlichen POST). */
export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('Origin')),
  });
}

/** Nur POST ist erlaubt — GET u. Ä. bekommen einen sauberen 405. */
export async function onRequestGet({ request }) {
  return json({ ok: false, error: 'Method Not Allowed' }, 405, request.headers.get('Origin'));
}

/** Hauptlogik: POST /api/contact */
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');

  // 1) Body als JSON einlesen.
  let body;
  try {
    body = await request.json();
 } catch (err) {
    return json({ ok: false, error: MSG_ERROR }, 502, origin);
}

  // 2) Felder einlesen und normalisieren.
  const name     = String(body.name || '').trim();
  const email    = String(body.email || '').trim();
  const phone    = String(body.phone || '').trim();
  const service  = String(body.service || '').trim();
  const message  = String(body.message || '').trim();
  const honeypot = String(body.company || '').trim(); // verstecktes Honeypot-Feld

  // 3) Honeypot: ist das Feld gefüllt, war es ein Bot. Wir antworten "erfolgreich",
  //    versenden aber nichts (der Bot soll nicht merken, dass er geblockt wurde).
  if (honeypot) {
    return json({ ok: true, message: MSG_SUCCESS }, 200, origin);
  }

  // 4) Serverseitige Validierung mit sinnvollen Fehlermeldungen.
  if (!name) {
    return json({ ok: false, error: 'Bitte geben Sie Ihren Namen an.' }, 400, origin);
  }
  if (!email || !isValidEmail(email)) {
    return json({ ok: false, error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' }, 400, origin);
  }
  if (!message) {
    return json({ ok: false, error: 'Bitte geben Sie eine Nachricht ein.' }, 400, origin);
  }
  if (name.length > 100 || phone.length > 60 || service.length > 100 || message.length > 5000) {
    return json({ ok: false, error: 'Ihre Eingabe ist zu lang.' }, 400, origin);
  }

  // 5) API-Key prüfen (kommt ausschließlich aus dem Cloudflare Secret).
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) {
    // Kein Key konfiguriert → als Serverfehler behandeln, ohne Details preiszugeben.
    return json({ ok: false, error: MSG_ERROR }, 500, origin);
  }

  // 6) Metadaten: Datum, Uhrzeit (Zeitzone Europe/Vienna) und Besucher-IP.
  const now     = new Date();
  const datum   = now.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' });
  const uhrzeit = now.toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const ip      = request.headers.get('CF-Connecting-IP') || 'unbekannt';

  // 7) HTML-Mails bauen (alle Nutzereingaben werden escaped).
  const ownerHtml    = buildOwnerEmail({ name, email, phone, service, message, datum, uhrzeit, ip });
  const customerHtml = buildCustomerEmail();

  // 8) Versand über Brevo.
  //    Die Benachrichtigung an den Betrieb ist Pflicht; schlägt sie fehl → Fehler.
  try {
    await sendBrevoEmail(apiKey, {
      sender:  { name: OWNER_NAME, email: OWNER_EMAIL },
      to:      [{ email: OWNER_EMAIL, name: OWNER_NAME }],
      replyTo: { email, name },            // direkt an den Kunden antworten können
      subject: SUBJECT_OWNER,
      htmlContent: ownerHtml,
    });
  } catch (err) {
    return json({
        ok: false,
        error: err.message
    }, 502, origin);
}

  //    Automatische Bestätigung an den Kunden — "best effort":
  //    ein Fehler hier soll den Erfolg für den Nutzer nicht kippen.
  try {
    await sendBrevoEmail(apiKey, {
      sender:  { name: OWNER_NAME, email: OWNER_EMAIL },
      to:      [{ email, name: name || email }],
      subject: SUBJECT_CUSTOMER,
      htmlContent: customerHtml,
    });
  } catch (err) {
    // absichtlich ignoriert — die Anfrage ist beim Betrieb angekommen.
  }

  // 9) Erfolg.
  return json({ ok: true, message: MSG_SUCCESS }, 200, origin);
}

/* ------------------------------- Versand --------------------------------- */

/** Sendet eine Transaktions-Mail über die Brevo API. Wirft bei Fehler. */
async function sendBrevoEmail(apiKey, payload) {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('Brevo ' + res.status + ': ' + detail);
  }
  return res;
}

/* --------------------------- E-Mail-Vorlagen ----------------------------- */

/** Professionelle HTML-Mail an den Betrieb mit allen Anfragedaten. */
function buildOwnerEmail(d) {
  const row = (label, value) =>
    `<tr>
       <td style="padding:10px 14px;background:#faf8f3;border:1px solid #ece6d8;font-weight:600;color:#4a4636;width:180px;vertical-align:top;">${esc(label)}</td>
       <td style="padding:10px 14px;border:1px solid #ece6d8;color:#1a1d21;vertical-align:top;">${value}</td>
     </tr>`;

  const dash        = '<span style="color:#9b978a;">—</span>';
  const serviceVal  = d.service ? esc(d.service) : dash;
  const phoneVal    = d.phone ? `<a href="tel:${esc(d.phone)}" style="color:#8a6a2f;text-decoration:none;">${esc(d.phone)}</a>` : dash;
  const emailVal    = `<a href="mailto:${esc(d.email)}" style="color:#8a6a2f;text-decoration:none;">${esc(d.email)}</a>`;
  const messageHtml = esc(d.message).replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:0;background:#f3f1ec;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="background:#16181b;border-radius:14px 14px 0 0;padding:22px 26px;">
      <div style="color:#d9b876;font-size:13px;letter-spacing:.14em;text-transform:uppercase;">AlpenGlanz Hausservice</div>
      <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:4px;">Neue Kontaktanfrage über die Website</div>
    </div>
    <div style="background:#ffffff;border:1px solid #ece6d8;border-top:none;border-radius:0 0 14px 14px;padding:26px;">
      <p style="margin:0 0 18px;color:#4a4636;font-size:15px;">Es ist eine neue Anfrage über das Kontaktformular eingegangen:</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
        ${row('Name', esc(d.name))}
        ${row('E-Mail', emailVal)}
        ${row('Telefon', phoneVal)}
        ${row('Gewünschte Leistung', serviceVal)}
        ${row('Nachricht', messageHtml)}
      </table>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:12px;margin-top:16px;">
        ${row('Datum', esc(d.datum))}
        ${row('Uhrzeit', esc(d.uhrzeit))}
        ${row('IP-Adresse', esc(d.ip))}
      </table>
      <p style="margin:22px 0 0;color:#8a8778;font-size:12px;">Sie können direkt auf diese E-Mail antworten, um dem Kunden zu schreiben.</p>
    </div>
  </div>
</body>
</html>`;
}

/** Automatische Bestätigungsmail an den Kunden. */
function buildCustomerEmail() {
  return `<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:0;background:#f3f1ec;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="background:#16181b;border-radius:14px 14px 0 0;padding:24px 26px;text-align:center;">
      <div style="color:#d9b876;font-size:22px;font-weight:700;letter-spacing:.02em;">AlpenGlanz Hausservice</div>
    </div>
    <div style="background:#ffffff;border:1px solid #ece6d8;border-top:none;border-radius:0 0 14px 14px;padding:30px 28px;color:#1a1d21;font-size:15px;line-height:1.65;">
      <p style="margin:0 0 16px;">Vielen Dank für Ihre Anfrage bei AlpenGlanz Hausservice.</p>
      <p style="margin:0 0 16px;">Wir haben Ihre Nachricht erhalten und melden uns schnellstmöglich persönlich bei Ihnen.</p>
      <p style="margin:24px 0 0;">Mit freundlichen Grüßen<br><strong>AlpenGlanz Hausservice</strong></p>
    </div>
    <p style="text-align:center;color:#8a8778;font-size:12px;margin:16px 0 0;line-height:1.6;">
      AlpenGlanz Hausservice OG · Langegasse 472, 8970 Schladming, Österreich<br>
      +43 699 12316660 · info@alpenglanz-hausservice.at
    </p>
  </div>
</body>
</html>`;
}
