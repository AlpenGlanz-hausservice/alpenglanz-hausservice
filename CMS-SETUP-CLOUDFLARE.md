# LumioWeb Mini-CMS auf Cloudflare Pages — Einrichtung (intern, für Jonathan)

Diese Datei ersetzt `CMS-SETUP-LUMIOWEB.md` für dieses Projekt. Die dortige
Anleitung beschreibt die PHP-Variante und gilt nur für klassisches Hosting.

## Warum es diese Variante gibt

alpenglanz-hausservice.at liegt auf **Cloudflare Pages**. Pages führt kein PHP
aus, das ist Architektur und keine Einstellung. Der Ordner `admin/` im Projekt
war deshalb live nie in Betrieb, `/admin/` hat mit 404 geantwortet.

Diese Variante erledigt dasselbe mit den Mitteln, die Pages hat: Functions,
KV-Speicher und HTMLRewriter.

## Wie es funktioniert

- Die `.html`-Dateien bleiben **unverändert**. Sie sind weiterhin der
  Ausgangsstand und werden nie beschrieben.
- Änderungen liegen im **KV**, ein Eintrag pro Seite (`page:index.html`).
  Gespeichert wird nur, was vom Ausgangsstand abweicht.
- `functions/_middleware.js` setzt sie beim Ausliefern per **HTMLRewriter** ein.
  Der geänderte Text steht damit sofort im Quelltext und nicht erst nach einem
  Nachladen per JavaScript. Für Google und für die Ladezeit ist das der
  entscheidende Unterschied.
- Bilder liegen ebenfalls im KV und werden über `/cms-media/` ausgeliefert.
  Kein R2 nötig.

Dateien:

| Datei | Aufgabe |
|---|---|
| `functions/_middleware.js` | setzt gepflegte Inhalte in jede HTML-Antwort ein |
| `functions/admin/[[route]].js` | die komplette Verwaltung |
| `functions/cms-media/[[key]].js` | liefert hochgeladene Bilder aus |
| `functions/api/contact.js` | Kontaktformular, unverändert |

## Einrichtung: die eine Sache, die von Hand passieren muss

Im Cloudflare-Dashboard:

1. **Workers & Pages → alpenglanz-hausservice → Settings → Bindings**
2. **Add binding → KV namespace**
   - Variablenname: **`CMS`** (genau so, Großbuchstaben)
   - Namespace: neu anlegen, z. B. `alpenglanz-cms`
3. Für **Production** und **Preview** eintragen.
4. Danach **neu deployen**, sonst greift die Bindung nicht.

Alternativ per CLI:

```bash
npx wrangler kv namespace create alpenglanz-cms
```

Danach die zurückgegebene ID im Dashboard als Bindung `CMS` zuordnen.

**Solange die Bindung fehlt, passiert nichts Schlimmes:** Die Website läuft
unverändert weiter, und `/admin/` meldet sauber, dass die Bindung fehlt. Die
Middleware ist so gebaut, dass sie im Fehlerfall immer die Originalantwort
durchreicht. Die Seite kann durch das CMS nicht ausfallen.

Ein zusätzliches Secret ist **nicht** nötig. Der Signaturschlüssel für die
Sitzungen wird bei der Ersteinrichtung selbst erzeugt und im KV abgelegt.

## Passwort setzen

`https://alpenglanz-hausservice.at/admin/` aufrufen und das Passwort festlegen.
Mindestens 10 Zeichen, am besten ein ganzer Satz.

**Wichtig:** Wer die Adresse kennt, kann das Passwort setzen, solange noch
keines existiert. Das gilt genauso für die PHP-Variante. Deshalb: **direkt nach
dem ersten Deploy setzen**, am besten gemeinsam mit dem Kunden bei der
Übergabe. Danach ist die Lücke zu.

Passwort vergessen: im Cloudflare-Dashboard unter **Workers & Pages → KV →
alpenglanz-cms** den Schlüssel `auth:user` löschen. Beim nächsten Aufruf von
`/admin/` kann ein neues gesetzt werden.

## Was der Kunde kann

- Texte auf allen 10 Seiten ändern (590 markierte Stellen, deutsch und englisch)
- Bilder austauschen (10 Stellen), Verkleinerung auf 1920 px passiert im Browser
- Seitentitel und Meta-Description je Seite pflegen
- Die letzten 15 Stände je Seite über „Verlauf" wiederherstellen

## Sicherheit

- Passwort als PBKDF2-SHA256 mit 210 000 Runden und zufälligem Salt
- Sitzungs-Cookie HMAC-signiert, `HttpOnly`, `Secure`, `SameSite=Strict`, 8 Stunden
- CSRF-Token an die Sitzung gebunden, wird bei jedem POST geprüft
- Login-Sperre 15 Minuten nach 5 Fehlversuchen
- Passwortwechsel erzeugt einen neuen Signaturschlüssel und beendet damit
  Sitzungen auf anderen Geräten
- `/admin` mit `noindex`, `X-Frame-Options: DENY`, `Cache-Control: no-store`
- Uploads: nur JPG/PNG/WebP, Signaturprüfung im Dateikopf, max. 4 MB

### Wie Kundeneingaben behandelt werden

Erst wird alles neutralisiert, dann werden gezielt nur erlaubte Tags
zurückgeholt: `<strong>`, `<em>`, `<br>`, sichere Links **und genau die Tags,
die im Ausgangstext dieses Feldes schon standen**. Das Letzte ist wichtig,
damit Stellen wie

```html
Pflichtfelder sind mit <span style="color:var(--color-gold-deep);">*</span> markiert.
```

ihre Formatierung behalten. Erfinden lässt sich dabei nichts, was nicht ohnehin
schon auf der Seite steht. Getestet gegen `<script>`, `<iframe>`, `<svg>`,
`onerror=`, `javascript:` und `data:`-URLs; alle werden entfernt.

## Auf ein neues Kundenprojekt übertragen

1. Die drei Dateien unter `functions/` kopieren.
2. In `functions/admin/[[route]].js` oben `SITE_NAME` und `PAGES` anpassen.
3. Editierbare Stellen wie gehabt mit `data-cms="..."` bzw. `data-cms-img="..."`
   markieren.
4. KV-Bindung `CMS` anlegen, deployen, Passwort setzen.

## Grenzen

- Der Kunde ändert Inhalte, legt aber keine neuen Seiten oder Abschnitte an.
- Die Fußzeilen-Navigation ist mitmarkiert und erscheint als roher Link-Quelltext
  (`<a href="index.html">Startseite</a>`). Wer daran herumtippt, kann sie
  beschädigen. Wenn das stört: die `data-cms`-Marker auf den Navigationsfeldern
  entfernen, dann verschwinden sie aus der Verwaltung.
- KV ist am Rand eventuell konsistent. Eine Änderung ist praktisch sofort da,
  in seltenen Fällen dauert es einige Sekunden.
