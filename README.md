# AlpenGlanz Hausservice — Website

Statische Website (HTML/CSS/JS, kein Build-Prozess nötig) für AlpenGlanz Hausservice in Schladming.

## Struktur

```
index.html        Startseite
leistungen.html    Leistungen (8 Services)
ueber-uns.html     Über uns / Team
kontakt.html       Kontakt + Anfrageformular
impressum.html     Impressum (Pflichtangaben fehlen noch, siehe unten)
datenschutz.html   Datenschutzerklärung (Vorlage, siehe unten)
css/style.css      Gesamtes Design-System (Farben, Typografie, Komponenten, Animationen)
js/script.js       Navigation, Scroll-Reveal-Animationen, Formularlogik
images/            Logo + Teamfotos
```

## Vor dem Livegang unbedingt erledigen

1. **Telefonnummer** — aktuell als Platzhalter `+43 (0) 000 000 000` in allen Seiten (Header ist überall gleich aufgebaut, am schnellsten per "Suchen & Ersetzen" über alle `.html`-Dateien).
2. **Impressum** (`impressum.html`) — eckige Klammern `[...]` durch echte Firmendaten ersetzen (Rechtsform, Adresse, ggf. UID-Nummer, Firmenbuchnummer). In Österreich Pflicht (§ 5 ECG).
3. **Datenschutzerklärung** (`datenschutz.html`) — ist eine Vorlage, bitte vor Livegang von einer Rechtsberatung auf DSGVO-Konformität prüfen lassen.
4. **Kontaktformular aktivieren** — das Formular ist technisch fertig, sendet aber noch nicht wirklich, weil noch kein Formular-Dienst verbunden ist:
   - Kostenloses Konto auf [formspree.io](https://formspree.io) anlegen
   - Neues Formular mit Ziel-E-Mail `info@alpenglanz-hausservice.at` erstellen
   - In `kontakt.html` die Zeile
     `<form id="contact-form" action="https://formspree.io/f/YOUR_FORM_ID" novalidate>`
     `YOUR_FORM_ID` durch die echte Formspree-ID ersetzen
   - Bis dahin zeigt das Formular bei Absenden freundlich einen Hinweis, sich direkt per E-Mail zu melden — es geht also nichts verloren.

## Lokal ansehen

Da die Seite reines HTML/CSS/JS ist, reicht ein einfacher lokaler Server (nötig für sauberes Laden der Formular-Requests):

```
python -m http.server 5500
```

Danach im Browser `http://localhost:5500` öffnen.

## Hosting

Die Seite kann bei jedem Standard-Webhoster (z.B. auch bei der Domain `alpenglanz-hausservice.at`) einfach per FTP/Datei-Upload hochgeladen werden — es sind keine Datenbank, kein PHP und kein Build-Schritt nötig.

## Design-System

- Farben: warmes Elfenbein/Off-White, tiefes Anthrazit-Schwarz, gedämpftes Gold als Akzent (edel & dezent, keine grellen Töne)
- Typografie: Playfair Display (Überschriften) + Figtree (Fließtext), geladen per `<link>` im `<head>` (schneller als `@import`)
- Animationen: sanftes Scroll-Reveal, Hover-Elevation auf Karten, Nav-Underline, Custom Cursor, mobiles Vollbild-Menü — alles respektiert `prefers-reduced-motion`. Der goldene Kristall-Cursor-Effekt ist deaktiviert, aber im Code erhalten: in `js/script.js` `CRYSTAL_ENABLED = true` setzen, um ihn zu reaktivieren.
- Getestet auf 375px (Mobile), 768px (Tablet) und 1440px (Desktop)

## Performance & SEO

- **Hero-Video responsive**: Handys laden `videos/hero-loop-mobile.mp4` (720p, ~0,7 MB), größere Screens die 2K-Version (~2,9 MB) — gesteuert über `<source media>` im Video-Tag
- **Poster** (`videos/hero-poster.jpg`, ~100 KB) dient als Standbild-Fallback und als Social-Media-Vorschaubild
- **Open-Graph/Twitter-Tags + Canonical** auf allen Hauptseiten — die URLs zeigen auf `https://alpenglanz-hausservice.at/`. **Falls die Domain anders lautet, vor Livegang in den `<head>`s anpassen.**
- **Favicons**: `images/favicon.png` (Browser-Tab) + `images/apple-touch-icon.png` (iOS-Homescreen)
- **Cache-Busting**: CSS/JS werden mit `?v=N` eingebunden. Bei Änderungen an `style.css`/`script.js` die Nummer in allen HTML-Dateien hochzählen, damit Besucher die neue Version erhalten.
- Teamfotos laden lazy und haben feste Dimensionen (kein Layout-Springen)
