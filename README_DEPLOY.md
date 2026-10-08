# Kontaktformular – Deployment-Anleitung (Cloudflare Pages + Brevo)

Das Kontaktformular läuft ohne Formspree und ohne PHP – ausschließlich über eine
**Cloudflare Pages Function** (`functions/api/contact.js`), die E-Mails über die
**Brevo API** versendet.

Ablauf beim Absenden:

1. `kontakt.html` / `en/contact.html` sendet die Daten per `fetch()` als JSON an **`/api/contact`**.
2. Die Pages Function validiert serverseitig, prüft den Honeypot und ruft die Brevo API auf.
3. Es werden zwei Mails verschickt: **Benachrichtigung an den Betrieb** + **Bestätigung an den Kunden**.

---

## Schritt 1 – Brevo vorbereiten

1. Konto bei **[brevo.com](https://www.brevo.com)** anlegen (kostenloser Plan: 300 Mails/Tag genügt).
2. **Absender verifizieren:** *Senders, Domains & Dedicated IPs → Senders* → `info@alpenglanz-hausservice.at` hinzufügen und per Bestätigungs-Mail verifizieren.
   *(Empfohlen: zusätzlich die Domain `alpenglanz-hausservice.at` mit SPF/DKIM verifizieren – bessere Zustellbarkeit.)*
3. **API-Key erstellen:** *Settings → SMTP & API → API Keys → Generate a new API key*. Key kopieren (beginnt mit `xkeysib-…`).

---

## Schritt 2 – API-Key als Cloudflare Secret `BREVO_API_KEY` anlegen

Der Key darf **niemals** im Code stehen – er kommt nur aus der Umgebungsvariable.

**Im Cloudflare-Dashboard:**

1. **Workers & Pages → dein Pages-Projekt** (`alpenglanz-hausservice`) öffnen.
2. **Settings → Environment variables → Production** (und optional *Preview*).
3. **Add variable:**
   - **Variable name:** `BREVO_API_KEY`
   - **Value:** dein Brevo-Key (`xkeysib-…`)
   - **Type:** auf **Secret / Encrypt** stellen (Auge-Symbol → verschlüsselt).
4. **Save.**

> Alternativ per CLI:
> ```bash
> npx wrangler pages secret put BREVO_API_KEY
> # dann den Key einfügen, wenn danach gefragt wird
> ```

---

## Schritt 3 – Deployment durchführen

Die Funktion wird automatisch erkannt, weil sie im Ordner **`functions/`** liegt
(`functions/api/contact.js` → Endpoint `/api/contact`). **Wichtig:** Beim Upload
muss der `functions/`-Ordner enthalten sein.

**Variante A – Dashboard (Direct Upload):**
1. **Workers & Pages → dein Projekt → Create deployment / Upload.**
2. Den **gesamten Website-Ordner** (inkl. `functions/`) bzw. die Deploy-Zip hochladen.
3. Deployment starten und abwarten.

**Variante B – Wrangler CLI (empfohlen, überträgt Functions zuverlässig):**
```bash
cd "Alpenglanz neu"
npx wrangler pages deploy . --project-name alpenglanz-hausservice
```

> Nach jedem Ändern des Secrets **neu deployen**, damit die Variable aktiv wird.

---

## Schritt 4 – Test des Formulars

1. Live-Seite öffnen: **https://alpenglanz-hausservice.at/kontakt**
2. Testdaten eingeben (echte E-Mail bei „E-Mail", damit die Bestätigung ankommt) → **Absenden**.
3. Erwartetes Ergebnis:
   - Grüne Meldung: **„Vielen Dank. Ihre Anfrage wurde erfolgreich versendet."**
   - Mail **an `info@alpenglanz-hausservice.at`** mit allen Feldern (Name, E-Mail, Telefon, Leistung, Nachricht, Datum, Uhrzeit, IP).
   - **Bestätigungsmail** an die eingegebene Kundenadresse.

### Schnelltest per Kommandozeile
```bash
curl -X POST https://alpenglanz-hausservice.at/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","message":"Testnachricht"}'
# Erwartet: {"ok":true,"message":"Vielen Dank. Ihre Anfrage wurde erfolgreich versendet."}
```

### Honeypot testen (muss geblockt werden)
```bash
curl -X POST https://alpenglanz-hausservice.at/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Bot","email":"bot@x.com","message":"spam","company":"gefuellt"}'
# Antwortet {"ok":true}, versendet aber KEINE Mail.
```

---

## Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Rote Meldung „Beim Versenden ist ein Fehler aufgetreten." | `BREVO_API_KEY` fehlt/falsch, oder Absender nicht verifiziert. Secret prüfen + **neu deployen**. |
| `/api/contact` gibt 404 | `functions/`-Ordner war nicht im Upload. Mit Wrangler (Variante B) deployen. |
| Mail landet im Spam | In Brevo die **Domain mit SPF/DKIM** verifizieren. |
| Keine Bestätigungsmail | Absender in Brevo verifiziert? Kunden-E-Mail korrekt eingegeben? |

## Lokaler Test (optional, mit Wrangler)
```bash
cd "Alpenglanz neu"
npx wrangler pages dev . --binding BREVO_API_KEY=DEIN_KEY
# Formular unter der angezeigten localhost-Adresse testen
```
> Ein einfacher statischer Server (z. B. `python -m http.server`) kann die
> Function **nicht** ausführen – dann liefert `/api/contact` nur einen 404.
