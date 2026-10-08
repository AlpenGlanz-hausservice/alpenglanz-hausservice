# LumioWeb Mini-CMS — Setup-Notizen (intern, für Jonathan)

## Was wurde eingebaut

Ein dateibasiertes PHP-CMS ohne Datenbank im Ordner `/admin`. Die HTML-Seiten selbst bleiben statisch (kein PHP beim Ausliefern, keine Performance-Änderung). Editierbare Stellen sind in den HTML-Dateien mit `data-cms="..."` (Texte) und `data-cms-img="..."` (Bilder) markiert. Das Admin-Panel liest diese Markierungen aus und schreibt Änderungen zielgenau zurück — der Rest der Datei bleibt Byte für Byte unverändert.

Funktionsumfang:

- Login mit Passwort (bcrypt-Hash, Login-Sperre nach 5 Fehlversuchen, CSRF-Schutz, Session-Härtung)
- Erste Einrichtung: Beim ersten Aufruf von `/admin` legt man das Passwort selbst fest (kein Standard-Passwort im Code)
- Texte bearbeiten inkl. erlaubter Inline-Formatierung (`<strong>`, `<em>`, `<a>`, Zeilenumbrüche), alles andere wird beim Speichern automatisch entschärft
- Bild-Upload mit Validierung (JPG/PNG/WebP, max. 8 MB), automatische Verkleinerung auf 1920 px Breite, `width`/`height`-Attribute werden mitgezogen
- Seitentitel + Meta-Description pro Seite editierbar (inkl. og:/twitter:-Tags)
- Automatische Sicherung vor jedem Speichern (15 Stände pro Seite) + Wiederherstellen über „Verlauf“

## Upload zu easyname

1. Gesamten Website-Ordner wie gewohnt per FTP hochladen — **neu dabei ist nur der Ordner `admin/`** (inkl. der versteckten `.htaccess`-Dateien! FTP-Programm so einstellen, dass versteckte Dateien übertragen werden).
2. Voraussetzungen am Hosting: PHP 7.4 oder neuer (easyname-Standard passt), Apache mit `.htaccess`-Unterstützung (Standard). Keine Datenbank nötig.
3. **Schreibrechte:** Das CMS muss die HTML-Dateien und `admin/data/` beschreiben dürfen. Bei easyname läuft PHP als eigener User, das passt normalerweise ohne Zutun. Falls Speichern fehlschlägt: Rechte der `.html`-Dateien und von `admin/` auf 644/755 prüfen.
4. `https://DOMAIN/admin/` aufrufen → Passwort festlegen → fertig. Passwort am besten gemeinsam mit dem Kunden bei der Übergabe setzen.
5. HTTPS sollte aktiv sein (Login-Passwort!). Bei easyname: Let's-Encrypt-Zertifikat im Control Panel aktivieren, falls noch nicht geschehen.

## Sicherheits-Hinweise

- `admin/data/` (Passwort-Hash, Sicherungen) ist per `.htaccess` komplett gesperrt.
- Es gibt kein Passwort-Zurücksetzen per E-Mail. Wenn der Kunde das Passwort vergisst: per FTP die Datei `admin/data/users.json` löschen → beim nächsten Aufruf von `/admin` kann ein neues Passwort gesetzt werden.
- Original-Bilder der Website werden nie überschrieben; Uploads landen in `images/cms/`.

## Auf ein neues Kundenprojekt übertragen

Wiederverwendbares Kit liegt in deinem Ordner `Claude Code/lumio-cms/`:

1. `admin/`-Ordner in das neue Projekt kopieren.
2. `admin/config.php` anpassen (Website-Name + Seiten-Beschriftungen).
3. Editierbare Stellen markieren — entweder von Hand (`data-cms="eindeutiger-key"` auf `h1–h4`, `p`, `li`, `span`, `strong`; `data-cms-img="key"` auf `img`) oder automatisch mit dem Tagging-Skript:
   `php tag_cms.php /pfad/zur/website`
   (läuft lokal bzw. in Claude Code/Cowork, braucht PHP 8.4; markiert alle Inhalte in `<main>` und `<footer>`)
4. Hochladen, `/admin` aufrufen, Passwort setzen, Kundenanleitung mitgeben.

## Grenzen (bewusst so gehalten)

- Der Kunde kann Inhalte ändern, aber keine neuen Seiten/Abschnitte anlegen und nichts am Layout verschieben — genau das macht es wartbar.
- Für News/Blog-Funktionen (Kunde legt selbst Einträge an) wäre die nächste Ausbaustufe ein Abschnitts-Duplizieren im CMS — bei Bedarf ansprechen.
