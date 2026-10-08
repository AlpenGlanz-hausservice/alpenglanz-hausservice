/**
 * LumioWeb Mini-CMS für Cloudflare Pages
 * Endpoints: /admin, /admin/login, /admin/edit, /admin/save, ...
 *
 * Ersetzt das PHP-CMS aus admin/, das auf Cloudflare Pages nicht laufen kann
 * (Pages führt kein PHP aus). Gleicher Funktionsumfang, andere Technik:
 *
 *   - Die .html-Dateien bleiben unverändert. Sie sind der Ausgangsstand.
 *   - Änderungen liegen im KV, je Seite ein Eintrag ("page:index.html").
 *   - functions/_middleware.js setzt sie beim Ausliefern per HTMLRewriter ein.
 *   - Bilder liegen ebenfalls im KV und werden über /cms-media/ ausgeliefert.
 *
 * Voraussetzung: eine KV-Bindung namens CMS am Pages-Projekt.
 * Ohne sie meldet sich die Verwaltung mit einem klaren Hinweis und die
 * Website selbst läuft unverändert weiter.
 *
 * Alles in einer Datei, weil Pages jede Datei unter functions/ zu einer Route
 * macht — ein ausgelagertes Hilfsmodul würde einen kaputten Pfad erzeugen.
 *
 * (c) LumioWeb – www.lumioweb.at
 */

/* =========================== Konfiguration =============================== */

const KV_BINDING = 'CMS';
const SITE_NAME = 'AlpenGlanz Hausservice';

/** Reihenfolge und Beschriftung der Seiten in der Verwaltung. */
const PAGES = {
  'index.html': 'Startseite',
  'leistungen.html': 'Leistungen',
  'ueber-uns.html': 'Über uns',
  'kontakt.html': 'Kontakt',
  'impressum.html': 'Impressum',
  'datenschutz.html': 'Datenschutz',
  'en/index.html': 'Startseite (Englisch)',
  'en/services.html': 'Leistungen (Englisch)',
  'en/about.html': 'Über uns (Englisch)',
  'en/contact.html': 'Kontakt (Englisch)',
};

const MIN_PASSWORD_LENGTH = 10;
const MAX_LOGIN_FAILS = 5;
const LOCKOUT_MINUTES = 15;
const SESSION_HOURS = 8;
const HISTORY_KEEP = 15;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB, nach Verkleinerung im Browser
const PBKDF2_ITERATIONS = 210000;

/* ============================== Helfer =================================== */

const enc = new TextEncoder();

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bytesToBase64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Vergleicht zwei Strings ohne verräterische Laufzeitunterschiede. */
function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

/* ============================== Krypto =================================== */

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return bytesToBase64url(bits);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { salt: bytesToBase64url(salt), hash, iterations: PBKDF2_ITERATIONS, v: 1 };
}

async function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const computed = await pbkdf2(password, base64urlToBytes(record.salt), record.iterations || PBKDF2_ITERATIONS);
  return timingSafeEqual(computed, record.hash);
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', base64urlToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToBase64url(sig);
}

/* ========================= KV-Zugriff / Zustand ========================== */

async function getAuth(kv) {
  return (await kv.get('auth:user', { type: 'json' })) || null;
}

/**
 * Der Signaturschlüssel für Sitzungen. Wird bei der Ersteinrichtung erzeugt
 * und liegt im KV, damit am Pages-Projekt nur die KV-Bindung nötig ist und
 * kein zusätzliches Secret von Hand gesetzt werden muss.
 */
async function getSecret(kv) {
  let secret = await kv.get('auth:secret');
  if (!secret) {
    secret = bytesToBase64url(randomBytes(32));
    await kv.put('auth:secret', secret);
  }
  return secret;
}

async function getLock(kv) {
  return (await kv.get('auth:lock', { type: 'json' })) || { fails: 0, until: 0 };
}

async function registerFail(kv) {
  const lock = await getLock(kv);
  lock.fails = (lock.fails || 0) + 1;
  if (lock.fails >= MAX_LOGIN_FAILS) {
    lock.until = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    lock.fails = 0;
  }
  await kv.put('auth:lock', JSON.stringify(lock));
}

async function resetLock(kv) {
  await kv.put('auth:lock', JSON.stringify({ fails: 0, until: 0 }));
}

/** Verbleibende Sperrzeit in Sekunden, 0 wenn nicht gesperrt. */
async function lockRemaining(kv) {
  const lock = await getLock(kv);
  const rest = (lock.until || 0) - Date.now();
  return rest > 0 ? Math.ceil(rest / 1000) : 0;
}

async function getPageData(kv, page) {
  return (await kv.get('page:' + page, { type: 'json' })) || { texts: {}, images: {}, meta: {} };
}

async function savePageData(kv, page, data) {
  await kv.put('page:' + page, JSON.stringify(data));
}

async function getHistory(kv, page) {
  return (await kv.get('hist:' + page, { type: 'json' })) || [];
}

/** Legt den aktuellen Stand als Sicherung ab, bevor gespeichert wird. */
async function pushHistory(kv, page, data) {
  const hist = await getHistory(kv, page);
  hist.unshift({ ts: Date.now(), data });
  await kv.put('hist:' + page, JSON.stringify(hist.slice(0, HISTORY_KEEP)));
}

/* ============================== Sitzung ================================== */

function cookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function makeSession(kv, secret) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const nonce = bytesToBase64url(randomBytes(12));
  const payload = `${exp}.${nonce}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

async function readSession(request, secret) {
  const token = cookies(request)['cms_session'];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [exp, nonce, sig] = parts;
  const expected = await hmac(secret, `${exp}.${nonce}`);
  if (!timingSafeEqual(sig, expected)) return null;
  if (Number(exp) < Date.now()) return null;
  return { exp: Number(exp), nonce, token };
}

function sessionCookie(value, maxAgeSeconds) {
  return (
    `cms_session=${value}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`
  );
}

/** CSRF-Token, an die laufende Sitzung gebunden. */
async function csrfFor(session, secret) {
  return await hmac(secret, 'csrf.' + session.nonce);
}

async function csrfOk(form, session, secret) {
  const expected = await csrfFor(session, secret);
  return timingSafeEqual(String(form.get('csrf') || ''), expected);
}

/* ========================= HTML-Bereinigung ============================== */

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/|#|[a-z0-9._~-]+(\/|$))/i;

/**
 * Zeichen, die in den Feldern tatsächlich als Entity vorkommen (&amp; und
 * &nbsp;), plus die übrigen Standardfälle. Sie werden fürs Bearbeiten in echte
 * Zeichen zurückverwandelt und beim Speichern wieder korrekt kodiert.
 * Ohne diesen Schritt würde aus &nbsp; beim ersten Speichern der sichtbare
 * Text "&nbsp;" werden.
 */
const ENTITIES = {
  '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'", '&shy;': '­',
};

function decodeEntities(s) {
  return String(s).replace(/&(?:amp|nbsp|lt|gt|quot|#39|apos|shy);/gi, (m) => ENTITIES[m.toLowerCase()] || m);
}

// Bewusst ohne \s: das würde auch das geschützte Leerzeichen (U+00A0)
// erfassen und beim Bearbeiten in ein normales Leerzeichen verwandeln.
const SPACE = '[ \\t\\f\\v]';

/**
 * Bereinigt Kundeneingaben. Erlaubt sind nur <strong>, <em>, <a href> und <br>.
 * Vorgehen: erst alles unschädlich machen, danach gezielt die erlaubten Tags
 * zurückholen. Dadurch kann kein anderes Tag und kein Attribut überleben,
 * ganz gleich wie die Eingabe aussieht.
 */
/**
 * Sammelt die Inline-Tags, die im Ausgangstext eines Feldes bereits vorkommen,
 * als exakte Zeichenketten. Nur genau diese dürfen beim Speichern stehen
 * bleiben. Dadurch behalten Stellen wie
 *   <span style="color:var(--color-gold-deep);">*</span>
 * ihre Formatierung, ohne dass der Kunde beliebige Tags einschleusen könnte:
 * erfinden lässt sich nichts, was nicht ohnehin schon auf der Seite steht.
 */
function allowedTagsFrom(original) {
  const set = new Set();
  const normalized = String(original == null ? '' : original).replace(/[\r\n\t\f\v ]+/g, ' ');
  for (const m of normalized.matchAll(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^<>]*>/g)) set.add(m[0]);
  return set;
}

/**
 * Bereinigt Kundeneingaben. Stehen bleiben nur <strong>, <em>, <br>, sichere
 * Links und die Tags, die im Ausgangstext dieses Feldes schon vorhanden waren.
 * Alles andere wird entfernt.
 *
 * Vorgehen: erst alles neutralisieren, dann Tag für Tag prüfen und nur die
 * erlaubten zurückholen. Ein unbekanntes Tag wird gelöscht und nicht als
 * sichtbarer Text stehen gelassen, denn sichtbarer Quelltext auf der
 * Kundenseite wäre der schlimmere Fehler.
 */
function sanitizeInline(input, multiline, allowed) {
  const allow = allowed instanceof Set ? allowed : new Set();
  let s = String(input == null ? '' : input).replace(/\r\n?/g, '\n');

  // 1) Alles neutralisieren.
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 2) Jede tag-artige Stelle einzeln bewerten. Das Muster läuft vom &lt; bis
  //    zum nächsten &gt; und muss dabei über &quot; und &amp; hinweggehen,
  //    die in Attributwerten stecken.
  s = s.replace(/&lt;(?:(?!&lt;|&gt;)[\s\S])*&gt;/g, (match) => {
    const tag = match
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

    // Kein wohlgeformtes Tag: als normalen Text stehen lassen.
    if (!/^<\/?[a-zA-Z][a-zA-Z0-9]*\b[^<>]*>$/.test(tag)) return match;

    const isClose = tag.charAt(1) === '/';
    const name = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)[1].toLowerCase();

    // Immer erlaubt, unabhängig vom Ausgangstext.
    if (/^<\/?(strong|b)\s*>$/i.test(tag)) return isClose ? '</strong>' : '<strong>';
    if (/^<\/?(em|i)\s*>$/i.test(tag)) return isClose ? '</em>' : '<em>';
    if (/^<br\s*\/?>$/i.test(tag)) return '<br>';
    if (isClose && (name === 'a' || name === 'span')) return '</' + name + '>';

    // Unverändert aus dem Ausgangstext übernommen.
    if (allow.has(tag)) return tag;

    // Ein neu gesetzter Link ist erlaubt, aber nur mit unbedenklicher Adresse
    // und ohne weitere Attribute.
    if (name === 'a' && !isClose) {
      const href = /^<a\s+href="([^"]*)"\s*>$/i.exec(tag);
      if (href && SAFE_URL.test(href[1])) {
        return '<a href="' + href[1].replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">';
      }
    }

    return '';
  });

  // 3) Zeilenumbrüche.
  s = s.replace(
    new RegExp(SPACE + '*\\n+' + SPACE + '*', 'g'),
    multiline ? '<br>' : ' '
  );

  return s.trim();
}

/**
 * Wandelt gespeichertes Inner-HTML zurück in editierbaren Text: <br> wird zum
 * Zeilenumbruch, Entities werden zu echten Zeichen, die erlaubten Inline-Tags
 * bleiben als Text sichtbar, damit der Kunde sie bewusst setzen kann.
 */
// Steuerzeichen als Platzhalter, kommt in HTML-Inhalten nicht vor.
const BR_MARK = String.fromCharCode(1);
const NEWLINE = String.fromCharCode(10);

function toEditable(inner) {
  let s = String(inner == null ? '' : inner);
  // Erst als Platzhalter merken: das anschließende Glätten würde einen echten
  // Zeilenumbruch sonst gleich wieder zu einem Leerzeichen machen.
  s = s.replace(/<br[^>]*>/gi, BR_MARK);
  // Einrückung und Quell-Umbrüche aus der HTML-Datei zu einfachen Leerzeichen.
  // U+00A0 steht bewusst nicht in der Klasse und bleibt damit erhalten.
  s = s.replace(/[\r\n\t\f\v ]+/g, ' ');
  s = s.replace(new RegExp(String.fromCharCode(32) + "?" + BR_MARK + String.fromCharCode(32) + "?", "g"), NEWLINE);
  return decodeEntities(s).trim();
}

function sanitizePlain(input, maxLength) {
  return String(input == null ? '' : input)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/* ====================== Seiten einlesen und scannen ====================== */

/** Wandelt "en/contact.html" in den öffentlichen Pfad "/en/contact". */
function pathForPage(page) {
  if (page === 'index.html') return '/';
  if (page.endsWith('/index.html')) return '/' + page.slice(0, -10);
  return '/' + page.replace(/\.html$/, '');
}

/** Holt das unveränderte HTML einer Seite aus den statischen Dateien. */
async function loadPageHtml(env, origin, page) {
  const url = new URL(pathForPage(page), origin);
  let res = await env.ASSETS.fetch(new Request(url.toString(), { headers: { Accept: 'text/html' } }));
  // Pages leitet .html auf die saubere URL um; einmal folgen genügt.
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('Location');
    if (loc) res = await env.ASSETS.fetch(new Request(new URL(loc, origin).toString()));
  }
  if (!res.ok) throw new Error('Seite nicht gefunden: ' + page);
  return await res.text();
}

/** Findet das schließende Tag zu einer Position, verschachtelungssicher. */
function findCloseTag(source, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(source))) {
    if (m[1]) {
      depth--;
      if (depth === 0) return m.index;
    } else {
      depth++;
    }
  }
  return -1;
}

/** Alle Textfelder einer Seite in Dokument-Reihenfolge. */
function scanFields(source) {
  const fields = [];
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\sdata-cms="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(source))) {
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    const end = findCloseTag(source, tag, start);
    if (end < 0) continue;
    fields.push({ key: m[3], tag, original: source.slice(start, end) });
  }
  return fields;
}

/** Alle austauschbaren Bilder einer Seite. */
function scanImages(source) {
  const images = [];
  const re = /<img\b[^>]*\sdata-cms-img="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(source))) {
    const tagHtml = m[0];
    const attr = (name) => {
      const a = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tagHtml);
      return a ? a[1] : '';
    };
    images.push({ key: m[1], src: attr('src'), alt: attr('alt') });
  }
  return images;
}

/** Titel und Meta-Description der Seite. */
function scanMeta(source) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const desc = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(source);
  return {
    title: title ? title[1].trim() : '',
    description: desc ? desc[1].trim() : '',
  };
}

/* ============================== Oberfläche =============================== */

const STYLES = `
:root{--ink:#1a1d21;--muted:#6f6b5e;--line:#e2dccd;--bg:#f7f5f0;--panel:#fff;
--dark:#16181b;--gold:#8a6a2f;--warn:#8c2f2f;--ok:#2f6b3d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{background:var(--dark);color:#fff;padding:18px 0}
header .in{display:flex;align-items:baseline;justify-content:space-between;gap:20px}
header .brand{color:var(--gold);font-size:12px;letter-spacing:.16em;text-transform:uppercase}
header h1{margin:2px 0 0;font-size:20px;font-weight:600;color:#fff}
header a{color:#cfcabb;font-size:14px;text-decoration:none;border-bottom:1px solid #4a4a44}
header a:hover{color:#fff}
.in{max-width:840px;margin:0 auto;padding:0 22px}
main{padding:34px 0 70px}
h2{font-size:17px;font-weight:600;margin:34px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--line)}
h2:first-child{margin-top:0}
p.lead{color:var(--muted);margin:0 0 24px}
.panel{background:var(--panel);border:1px solid var(--line);padding:24px}
table{width:100%;border-collapse:collapse}
td,th{text-align:left;padding:11px 4px;border-bottom:1px solid var(--line);vertical-align:baseline}
th{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:none}
a{color:var(--gold)}
label{display:block;font-size:13px;color:var(--muted);margin:0 0 5px}
label .tag{font-size:11px;color:#a39d8c;text-transform:uppercase;letter-spacing:.06em;margin-left:7px}
input[type=text],input[type=password],textarea{width:100%;padding:9px 11px;font:inherit;
color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:2px}
textarea{resize:vertical;min-height:76px;line-height:1.55}
input:focus,textarea:focus{outline:2px solid var(--gold);outline-offset:-1px;border-color:var(--gold)}
.field{margin:0 0 19px}
.btn{display:inline-block;padding:10px 20px;font:inherit;font-weight:600;cursor:pointer;
background:var(--dark);color:#fff;border:1px solid var(--dark);border-radius:2px;text-decoration:none}
.btn:hover{background:#000}
.btn.sec{background:#fff;color:var(--ink);border-color:var(--line);font-weight:400}
.btn.sec:hover{background:#f0ede4}
.msg{padding:12px 15px;margin:0 0 22px;border-left:3px solid}
.msg.err{background:#fbf1f1;border-color:var(--warn);color:#6d2525}
.msg.ok{background:#f0f6f1;border-color:var(--ok);color:#255330}
.msg.info{background:#f6f3ea;border-color:var(--gold);color:#5c4718}
.bar{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);
padding:15px 0;margin-top:30px;display:flex;gap:12px;align-items:center}
.bar .note{color:var(--muted);font-size:13px}
.imgrow{display:flex;gap:18px;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--line)}
.imgrow:last-child{border-bottom:none}
.imgrow img{width:118px;height:auto;border:1px solid var(--line);background:#fff}
.imgrow .meta{flex:1;min-width:0}
.imgrow .name{font-size:13px;color:var(--muted);word-break:break-all;margin:0 0 9px}
small.hint{display:block;color:var(--muted);font-size:12.5px;margin-top:5px}
.count{color:var(--muted);font-size:13px;font-weight:400}
`;

function layout(title, body, opts = {}) {
  const nav = opts.loggedIn
    ? `<form method="post" action="/admin/logout" style="margin:0">
         <input type="hidden" name="csrf" value="${esc(opts.csrf)}">
         <button class="btn sec" style="padding:6px 13px;font-size:13px">Abmelden</button>
       </form>`
    : '';
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — Verwaltung ${esc(SITE_NAME)}</title>
<style>${STYLES}</style>
</head>
<body>
<header><div class="in">
  <div>
    <div class="brand">${esc(SITE_NAME)}</div>
    <h1>${esc(title)}</h1>
  </div>
  ${nav}
</div></header>
<main><div class="in">${body}</div></main>
</body>
</html>`;
}

function message(kind, text) {
  return text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
}

/* ============================== Ansichten ================================ */

function viewSetup(error) {
  return layout(
    'Passwort festlegen',
    `${message('err', error)}
     <div class="panel">
       <p class="lead">Legen Sie das Passwort für die Verwaltung fest. Es gibt kein
       voreingestelltes Passwort. Wählen Sie am besten einen ganzen Satz, den Sie
       sich merken können, mindestens ${MIN_PASSWORD_LENGTH} Zeichen.</p>
       <form method="post" action="/admin/setup">
         <div class="field">
           <label for="p1">Passwort</label>
           <input type="password" id="p1" name="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
         </div>
         <div class="field">
           <label for="p2">Passwort wiederholen</label>
           <input type="password" id="p2" name="password2" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
         </div>
         <button class="btn" type="submit">Passwort speichern</button>
       </form>
     </div>`
  );
}

function viewLogin(error, info) {
  return layout(
    'Anmelden',
    `${message('err', error)}${message('info', info)}
     <div class="panel">
       <form method="post" action="/admin/login">
         <div class="field">
           <label for="pw">Passwort</label>
           <input type="password" id="pw" name="password" autocomplete="current-password" required autofocus>
         </div>
         <button class="btn" type="submit">Anmelden</button>
       </form>
     </div>`
  );
}

function viewList(csrf, changedPages, notice, error) {
  const rows = Object.entries(PAGES)
    .map(([page, label]) => {
      const n = changedPages[page] || 0;
      return `<tr>
        <td><strong>${esc(label)}</strong><br>
            <span class="count">${n > 0 ? `${n} Änderung${n === 1 ? '' : 'en'} gespeichert` : 'unverändert'}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <a class="btn sec" style="padding:6px 13px;font-size:13px" href="/admin/edit?page=${encodeURIComponent(page)}">Bearbeiten</a>
          <a class="btn sec" style="padding:6px 13px;font-size:13px" href="/admin/history?page=${encodeURIComponent(page)}">Verlauf</a>
        </td>
      </tr>`;
    })
    .join('');

  return layout(
    'Ihre Website bearbeiten',
    `${message('ok', notice)}${message('err', error)}
     <p class="lead">Wählen Sie die Seite, die Sie ändern möchten. Das Design bleibt
     dabei erhalten, Sie können nichts kaputt machen.</p>
     <div class="panel"><table><tbody>${rows}</tbody></table></div>
     <h2>Passwort</h2>
     <div class="panel">
       <form method="post" action="/admin/password">
         <input type="hidden" name="csrf" value="${esc(csrf)}">
         <div class="field">
           <label for="cur">Aktuelles Passwort</label>
           <input type="password" id="cur" name="current" autocomplete="current-password" required>
         </div>
         <div class="field">
           <label for="new">Neues Passwort</label>
           <input type="password" id="new" name="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
         </div>
         <button class="btn sec" type="submit">Passwort ändern</button>
       </form>
     </div>`,
    { loggedIn: true, csrf }
  );
}

function viewEdit(page, csrf, fields, images, meta, notice, error) {
  const label = PAGES[page] || page;

  const textFields = fields
    .map((f) => {
      const value = toEditable(f.current);
      const long = value.length > 90 || /\n/.test(value);
      const input = long
        ? `<textarea name="t:${esc(f.key)}" rows="${Math.min(9, Math.max(3, Math.ceil(value.length / 82) + value.split('\n').length))}">${esc(value)}</textarea>`
        : `<input type="text" name="t:${esc(f.key)}" value="${esc(value)}">`;
      return `<div class="field">
        <label for="">${esc(f.label)}<span class="tag">${esc(f.tag)}</span></label>
        ${input}
      </div>`;
    })
    .join('');

  const imageRows = images.length
    ? images
        .map(
          (img) => `<div class="imgrow">
        <img src="${esc(img.current)}" alt="">
        <div class="meta">
          <p class="name">${esc(img.current)}</p>
          <input type="file" name="i:${esc(img.key)}" accept="image/jpeg,image/png,image/webp" data-cms-upload>
          <small class="hint">JPG, PNG oder WebP. Große Fotos werden vor dem Hochladen
          automatisch auf 1920 Pixel Breite verkleinert.</small>
        </div>
      </div>`
        )
        .join('')
    : '<p class="lead" style="margin:0">Auf dieser Seite gibt es keine austauschbaren Bilder.</p>';

  return layout(
    label + ' bearbeiten',
    `${message('ok', notice)}${message('err', error)}
     <p class="lead"><a href="/admin">Zurück zur Übersicht</a> &nbsp;·&nbsp;
     <a href="${esc(pathForPage(page))}" target="_blank" rel="noopener">Seite ansehen</a></p>

     <form method="post" action="/admin/save" enctype="multipart/form-data" id="cmsform">
       <input type="hidden" name="csrf" value="${esc(csrf)}">
       <input type="hidden" name="page" value="${esc(page)}">

       <h2>Texte <span class="count">${fields.length} Felder</span></h2>
       <div class="panel">
         <p class="lead" style="margin:0 0 20px">Sie dürfen <strong>&lt;strong&gt;</strong> für
         fett und <strong>&lt;em&gt;</strong> für kursiv verwenden. Alles andere wird beim
         Speichern automatisch entfernt.</p>
         ${textFields}
       </div>

       <h2>Bilder</h2>
       <div class="panel">${imageRows}</div>

       <h2>Google-Vorschau</h2>
       <div class="panel">
         <p class="lead" style="margin:0 0 20px">Diese Texte erscheinen in den
         Google-Suchergebnissen. Im Zweifel einfach so lassen.</p>
         <div class="field">
           <label for="mt">Seitentitel</label>
           <input type="text" id="mt" name="meta_title" value="${esc(meta.title)}" maxlength="120">
         </div>
         <div class="field">
           <label for="md">Beschreibung</label>
           <textarea id="md" name="meta_description" rows="3" maxlength="320">${esc(meta.description)}</textarea>
         </div>
       </div>

       <div class="bar">
         <button class="btn" type="submit">Änderungen speichern</button>
         <a class="btn sec" href="/admin">Abbrechen</a>
         <span class="note">Vor dem Speichern wird automatisch eine Sicherung angelegt.</span>
       </div>
     </form>
     <script>${UPLOAD_SCRIPT}</script>`,
    { loggedIn: true, csrf }
  );
}

/**
 * Verkleinert gewählte Bilder schon im Browser auf 1920 px Breite.
 * Ohne JavaScript wird die Datei unverändert hochgeladen, dann greift die
 * Größenbegrenzung auf dem Server.
 */
const UPLOAD_SCRIPT = `
(function(){
  var MAX=1920, form=document.getElementById('cmsform');
  if(!form||!window.FileReader||!document.createElement('canvas').getContext) return;
  form.querySelectorAll('input[data-cms-upload]').forEach(function(input){
    input.addEventListener('change', function(){
      var file=input.files&&input.files[0];
      if(!file||!/^image\\/(jpeg|png|webp)$/.test(file.type)) return;
      var img=new Image(), url=URL.createObjectURL(file);
      img.onload=function(){
        URL.revokeObjectURL(url);
        if(img.width<=MAX&&file.size<2*1024*1024) return;
        var scale=Math.min(1,MAX/img.width);
        var c=document.createElement('canvas');
        c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        c.toBlob(function(blob){
          if(!blob) return;
          var dt=new DataTransfer();
          dt.items.add(new File([blob], file.name.replace(/\\.[^.]+$/,'')+'.jpg', {type:'image/jpeg'}));
          input.files=dt.files;
        },'image/jpeg',0.86);
      };
      img.onerror=function(){ URL.revokeObjectURL(url); };
      img.src=url;
    });
  });
})();
`;

function viewHistory(page, csrf, entries, notice) {
  const label = PAGES[page] || page;
  const rows = entries.length
    ? entries
        .map((e, i) => {
          const d = new Date(e.ts);
          const when = d.toLocaleString('de-AT', {
            timeZone: 'Europe/Vienna',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
          return `<tr>
            <td>${esc(when)} Uhr</td>
            <td style="text-align:right">
              <form method="post" action="/admin/restore" style="margin:0">
                <input type="hidden" name="csrf" value="${esc(csrf)}">
                <input type="hidden" name="page" value="${esc(page)}">
                <input type="hidden" name="index" value="${i}">
                <button class="btn sec" style="padding:6px 13px;font-size:13px">Diesen Stand wiederherstellen</button>
              </form>
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="2" class="count">Noch keine Sicherungen. Es wurde bisher nichts geändert.</td></tr>';

  return layout(
    'Verlauf: ' + label,
    `${message('ok', notice)}
     <p class="lead"><a href="/admin">Zurück zur Übersicht</a> &nbsp;·&nbsp;
     <a href="/admin/edit?page=${encodeURIComponent(page)}">Seite bearbeiten</a></p>
     <p class="lead">Vor jedem Speichern wird der vorherige Stand gesichert. Die letzten
     ${HISTORY_KEEP} Stände bleiben erhalten.</p>
     <div class="panel"><table>
       <thead><tr><th>Gesichert am</th><th></th></tr></thead>
       <tbody>${rows}</tbody>
     </table></div>`,
    { loggedIn: true, csrf }
  );
}

function viewNoKv() {
  return html(
    layout(
      'Verwaltung noch nicht eingerichtet',
      `<div class="msg err">Die KV-Bindung <strong>${KV_BINDING}</strong> fehlt am Pages-Projekt.</div>
       <div class="panel">
         <p class="lead" style="margin:0">Im Cloudflare-Dashboard unter
         <strong>Workers &amp; Pages → das Projekt → Settings → Bindings</strong>
         eine KV-Namespace-Bindung mit dem Variablennamen <strong>${KV_BINDING}</strong>
         anlegen und danach neu deployen. Die Website selbst läuft davon unberührt weiter.</p>
       </div>`
    ),
    503
  );
}

/* ============================ Zusammenführen ============================= */

/** Verbindet den Ausgangsstand aus der HTML-Datei mit den Änderungen im KV. */
function mergeFields(source, data) {
  const overrides = data.texts || {};
  return scanFields(source).map((f, i) => ({
    key: f.key,
    tag: f.tag,
    label: 'Feld ' + (i + 1),
    current: Object.prototype.hasOwnProperty.call(overrides, f.key) ? overrides[f.key] : f.original,
    original: f.original,
  }));
}

function mergeImages(source, data) {
  const overrides = data.images || {};
  return scanImages(source).map((img) => ({
    key: img.key,
    original: img.src,
    current: overrides[img.key] && overrides[img.key].src ? overrides[img.key].src : img.src,
  }));
}

function mergeMeta(source, data) {
  const base = scanMeta(source);
  const o = data.meta || {};
  return {
    title: o.title || base.title,
    description: o.description || base.description,
  };
}

/**
 * Gibt Feldern eine sprechende Beschriftung: die ersten Wörter des aktuellen
 * Textes. Das ist für den Kunden weit brauchbarer als "Feld 37".
 */
function labelFields(fields) {
  return fields.map((f, i) => {
    const plain = toEditable(f.original).replace(/<[^>]+>/g, '').trim();
    const short = plain.length > 46 ? plain.slice(0, 46).replace(/\s\S*$/, '') + '…' : plain;
    return { ...f, label: short || 'Feld ' + (i + 1) };
  });
}

/* =============================== Router ================================== */

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const segments = (Array.isArray(params.route) ? params.route : [params.route])
    .filter((s) => s !== undefined && s !== null && s !== '');
  const route = segments.join('/');

  const kv = env[KV_BINDING];
  if (!kv) return viewNoKv();

  try {
    return await handle({ request, env, url, route, kv });
  } catch (err) {
    return html(
      layout(
        'Fehler',
        `<div class="msg err">Es ist ein Fehler aufgetreten: ${esc(err && err.message)}</div>
         <p class="lead"><a href="/admin">Zurück zur Übersicht</a></p>`
      ),
      500
    );
  }
}

async function handle({ request, env, url, route, kv }) {
  const secret = await getSecret(kv);
  const auth = await getAuth(kv);
  const method = request.method;

  /* --- Ersteinrichtung: solange kein Passwort gesetzt ist --------------- */
  if (!auth) {
    if (route === 'setup' && method === 'POST') {
      const form = await request.formData();
      const p1 = String(form.get('password') || '');
      const p2 = String(form.get('password2') || '');
      if (p1.length < MIN_PASSWORD_LENGTH) {
        return html(viewSetup(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`), 400);
      }
      if (p1 !== p2) return html(viewSetup('Die beiden Passwörter stimmen nicht überein.'), 400);

      await kv.put('auth:user', JSON.stringify(await hashPassword(p1)));
      await resetLock(kv);
      const token = await makeSession(kv, secret);
      return redirect('/admin', { 'Set-Cookie': sessionCookie(token, SESSION_HOURS * 3600) });
    }
    return html(viewSetup(''));
  }

  /* --- Anmeldung -------------------------------------------------------- */
  if (route === 'login' && method === 'POST') {
    const remaining = await lockRemaining(kv);
    if (remaining > 0) {
      return html(viewLogin(`Zu viele Fehlversuche. Bitte in ${Math.ceil(remaining / 60)} Minuten erneut versuchen.`, ''), 429);
    }
    const form = await request.formData();
    const ok = await verifyPassword(String(form.get('password') || ''), auth);
    if (!ok) {
      await registerFail(kv);
      return html(viewLogin('Das Passwort stimmt nicht.', ''), 401);
    }
    await resetLock(kv);
    const token = await makeSession(kv, secret);
    return redirect('/admin', { 'Set-Cookie': sessionCookie(token, SESSION_HOURS * 3600) });
  }

  const session = await readSession(request, secret);
  if (!session) {
    if (route === '' && method === 'GET') return html(viewLogin('', ''));
    return redirect('/admin');
  }
  const csrf = await csrfFor(session, secret);

  /* --- Abmelden --------------------------------------------------------- */
  if (route === 'logout' && method === 'POST') {
    const form = await request.formData();
    if (!(await csrfOk(form, session, secret))) return redirect('/admin');
    return redirect('/admin', { 'Set-Cookie': sessionCookie('', 0) });
  }

  /* --- Übersicht -------------------------------------------------------- */
  if (route === '' && method === 'GET') {
    const changed = {};
    for (const page of Object.keys(PAGES)) {
      const d = await getPageData(kv, page);
      changed[page] =
        Object.keys(d.texts || {}).length +
        Object.keys(d.images || {}).length +
        (d.meta && (d.meta.title || d.meta.description) ? 1 : 0);
    }
    const errors = {
      pw: 'Das aktuelle Passwort stimmt nicht. Das Passwort wurde nicht geändert.',
      kurz: `Das neue Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen. Das Passwort wurde nicht geändert.`,
    };
    return html(
      viewList(
        csrf,
        changed,
        url.searchParams.get('ok') ? 'Gespeichert.' : '',
        errors[url.searchParams.get('err')] || ''
      )
    );
  }

  /* --- Passwort ändern -------------------------------------------------- */
  if (route === 'password' && method === 'POST') {
    const form = await request.formData();
    if (!(await csrfOk(form, session, secret))) return redirect('/admin');
    const current = String(form.get('current') || '');
    const next = String(form.get('password') || '');
    if (!(await verifyPassword(current, auth))) {
      return redirect('/admin?err=pw');
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      return redirect('/admin?err=kurz');
    }
    await kv.put('auth:user', JSON.stringify(await hashPassword(next)));
    // Neuer Signaturschlüssel: bestehende Sitzungen auf anderen Geräten enden.
    await kv.put('auth:secret', bytesToBase64url(randomBytes(32)));
    return redirect('/admin', { 'Set-Cookie': sessionCookie('', 0) });
  }

  /* --- Bearbeiten ------------------------------------------------------- */
  if (route === 'edit' && method === 'GET') {
    const page = String(url.searchParams.get('page') || '');
    if (!PAGES[page]) return redirect('/admin');
    const source = await loadPageHtml(env, url.origin, page);
    const data = await getPageData(kv, page);
    return html(
      viewEdit(
        page,
        csrf,
        labelFields(mergeFields(source, data)),
        mergeImages(source, data),
        mergeMeta(source, data),
        url.searchParams.get('ok') ? 'Ihre Änderungen sind gespeichert und sofort online.' : '',
        ''
      )
    );
  }

  /* --- Speichern -------------------------------------------------------- */
  if (route === 'save' && method === 'POST') {
    const form = await request.formData();
    if (!(await csrfOk(form, session, secret))) return redirect('/admin');

    const page = String(form.get('page') || '');
    if (!PAGES[page]) return redirect('/admin');

    const source = await loadPageHtml(env, url.origin, page);
    const fields = scanFields(source);
    const knownText = new Map(fields.map((f) => [f.key, f]));
    const knownImages = new Set(scanImages(source).map((i) => i.key));
    const base = scanMeta(source);

    const previous = await getPageData(kv, page);
    const next = {
      texts: { ...(previous.texts || {}) },
      images: { ...(previous.images || {}) },
      meta: { ...(previous.meta || {}) },
    };

    // Texte. Gespeichert wird nur, was vom Ausgangsstand abweicht.
    for (const [name, raw] of form.entries()) {
      if (!name.startsWith('t:')) continue;
      const key = name.slice(2);
      const field = knownText.get(key);
      if (!field) continue;
      const cleaned = sanitizeInline(raw, isMultiline(field.tag), allowedTagsFrom(field.original));
      if (cleaned === toEditableHtml(field.original, field.tag)) delete next.texts[key];
      else next.texts[key] = cleaned;
    }

    // Bilder.
    const uploadErrors = [];
    for (const [name, value] of form.entries()) {
      if (!name.startsWith('i:')) continue;
      const key = name.slice(2);
      if (!knownImages.has(key)) continue;
      if (typeof value === 'string' || !value || !value.size) continue;
      try {
        next.images[key] = await storeUpload(kv, value);
      } catch (err) {
        uploadErrors.push(err.message);
      }
    }

    // Google-Vorschau.
    const metaTitle = sanitizePlain(form.get('meta_title'), 120);
    const metaDesc = sanitizePlain(form.get('meta_description'), 320);
    if (metaTitle && metaTitle !== base.title) next.meta.title = metaTitle;
    else delete next.meta.title;
    if (metaDesc && metaDesc !== base.description) next.meta.description = metaDesc;
    else delete next.meta.description;

    await pushHistory(kv, page, previous);
    await savePageData(kv, page, next);

    if (uploadErrors.length) {
      const data = await getPageData(kv, page);
      return html(
        viewEdit(
          page, csrf,
          labelFields(mergeFields(source, data)),
          mergeImages(source, data),
          mergeMeta(source, data),
          'Die Texte wurden gespeichert.',
          'Bild nicht übernommen: ' + uploadErrors.join(' ')
        ),
        400
      );
    }
    return redirect(`/admin/edit?page=${encodeURIComponent(page)}&ok=1`);
  }

  /* --- Verlauf ---------------------------------------------------------- */
  if (route === 'history' && method === 'GET') {
    const page = String(url.searchParams.get('page') || '');
    if (!PAGES[page]) return redirect('/admin');
    const entries = await getHistory(kv, page);
    return html(viewHistory(page, csrf, entries, url.searchParams.get('ok') ? 'Stand wiederhergestellt.' : ''));
  }

  if (route === 'restore' && method === 'POST') {
    const form = await request.formData();
    if (!(await csrfOk(form, session, secret))) return redirect('/admin');
    const page = String(form.get('page') || '');
    if (!PAGES[page]) return redirect('/admin');
    const idx = parseInt(String(form.get('index') || ''), 10);
    const entries = await getHistory(kv, page);
    if (!Number.isInteger(idx) || idx < 0 || idx >= entries.length) {
      return redirect(`/admin/history?page=${encodeURIComponent(page)}`);
    }
    const current = await getPageData(kv, page);
    await pushHistory(kv, page, current); // auch das Zurücksetzen ist rückgängig zu machen
    await savePageData(kv, page, entries[idx].data);
    return redirect(`/admin/history?page=${encodeURIComponent(page)}&ok=1`);
  }

  return redirect('/admin');
}

/**
 * Der im HTML stehende Ausgangstext, durch dieselbe Aufbereitung geschickt wie
 * eine Kundeneingabe. Nur so lässt sich zuverlässig erkennen, ob wirklich etwas
 * geändert wurde — sonst würde bereits das Öffnen des Formulars jedes Feld als
 * Änderung speichern.
 */
function toEditableHtml(original, tag) {
  return sanitizeInline(toEditable(original), isMultiline(tag), allowedTagsFrom(original));
}

/**
 * In welchen Elementen ein Zeilenumbruch als <br> erhalten bleiben soll.
 * Muss beim Anzeigen und beim Speichern dieselbe Antwort geben, sonst gilt ein
 * unverändertes Feld beim ersten Speichern fälschlich als geändert.
 */
function isMultiline(tag) {
  return /^(p|li|td)$/.test(String(tag || ''));
}

/** Prüft eine hochgeladene Datei und legt sie im KV ab. */
async function storeUpload(kv, file) {
  const type = String(file.type || '').toLowerCase();
  const extByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = extByType[type];
  if (!ext) throw new Error('Nur JPG, PNG oder WebP sind erlaubt.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Die Datei ist zu groß (max. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`);
  }

  const buffer = await file.arrayBuffer();
  if (!looksLikeImage(new Uint8Array(buffer), ext)) {
    throw new Error('Die Datei ist kein gültiges Bild.');
  }

  // Eindeutiger, unveränderlicher Name: alte URLs bleiben gültig, neue Bilder
  // umgehen jeden Cache. Nur Zeichen, die /cms-media/ akzeptiert.
  const name = `${Date.now().toString(36)}-${bytesToBase64url(randomBytes(6)).toLowerCase().replace(/[^a-z0-9]/g, '')}.${ext}`;
  await kv.put('media:' + name, buffer);

  // Die Maße müssen mitgeführt werden. Bleiben width/height des alten Bildes
  // stehen und hat das neue ein anderes Seitenverhältnis, wird es verzerrt.
  const size = imageSize(new Uint8Array(buffer), ext);
  return { src: '/cms-media/' + name, width: size.width, height: size.height };
}

/**
 * Liest Breite und Höhe direkt aus dem Dateikopf. Ein Worker kann Bilder nicht
 * dekodieren, die Maße stehen aber in allen drei erlaubten Formaten an fester
 * Stelle. Sind sie nicht lesbar, wird ohne Maße gespeichert und die Middleware
 * entfernt die Attribute, statt falsche stehen zu lassen.
 */
function imageSize(b, ext) {
  const none = { width: 0, height: 0 };
  try {
    if (ext === 'png') {
      // IHDR steht immer direkt nach der 8 Byte langen Signatur.
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }

    if (ext === 'jpg') {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        // SOF0..SOF15 tragen die Maße, ausgenommen DHT (c4), JPG (c8), DAC (cc).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
      return none;
    }

    if (ext === 'webp') {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === 'VP8X') {
        return {
          width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
          height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        };
      }
      if (fourcc === 'VP8 ') {
        // Nach dem 3 Byte Frame-Tag folgt der Sync-Code 9d 01 2a.
        if (b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
          return {
            width: (b[26] | (b[27] << 8)) & 0x3fff,
            height: (b[28] | (b[29] << 8)) & 0x3fff,
          };
        }
        return none;
      }
      if (fourcc === 'VP8L' && b[20] === 0x2f) {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return none;
    }
  } catch (err) {
    return none;
  }
  return none;
}

/** Grobe Signaturprüfung, damit nicht beliebige Daten als Bild durchgehen. */
function looksLikeImage(bytes, ext) {
  if (bytes.length < 12) return false;
  if (ext === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === 'png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (ext === 'webp') {
    return (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    );
  }
  return false;
}
