<?php
/**
 * LumioWeb Mini-CMS
 * Leichtgewichtiges, dateibasiertes CMS für statische Websites.
 * Keine Datenbank nötig. Läuft auf jedem Standard-PHP-Hosting (PHP 7.4+).
 *
 * (c) LumioWeb – www.lumioweb.at
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Grundkonfiguration
// ---------------------------------------------------------------------------

define('CMS_VERSION', '1.0');
define('SITE_ROOT', dirname(__DIR__));
define('CMS_DATA', __DIR__ . '/data');
define('CMS_BACKUPS', CMS_DATA . '/backups');
define('CMS_UPLOAD_DIR', SITE_ROOT . '/images/cms');
define('CMS_MAX_UPLOAD', 8 * 1024 * 1024);   // 8 MB
define('CMS_MAX_IMG_WIDTH', 1920);           // Bilder werden auf max. Breite verkleinert
define('CMS_BACKUPS_KEEP', 15);              // Sicherungen pro Seite
define('CMS_LOCKOUT_TRIES', 5);              // Fehlversuche bis Sperre
define('CMS_LOCKOUT_SECONDS', 600);          // Sperrdauer (10 Minuten)

$config = require __DIR__ . '/config.php';

// ---------------------------------------------------------------------------
// Session & Sicherheit
// ---------------------------------------------------------------------------

function cms_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('lumiocms');
    session_start();
}

function cms_is_logged_in(): bool {
    cms_session_start();
    return !empty($_SESSION['cms_user']);
}

function cms_require_login(): void {
    if (!cms_users_exist()) {
        header('Location: setup.php');
        exit;
    }
    if (!cms_is_logged_in()) {
        header('Location: login.php');
        exit;
    }
}

function cms_users_file(): string { return CMS_DATA . '/users.json'; }

function cms_users_exist(): bool {
    $f = cms_users_file();
    if (!is_file($f)) return false;
    $d = json_decode((string)file_get_contents($f), true);
    return !empty($d['hash']);
}

function cms_set_password(string $password): void {
    if (!is_dir(CMS_DATA)) mkdir(CMS_DATA, 0755, true);
    cms_write_json(cms_users_file(), [
        'hash'    => password_hash($password, PASSWORD_DEFAULT),
        'updated' => date('c'),
    ]);
}

function cms_check_password(string $password): bool {
    $d = json_decode((string)file_get_contents(cms_users_file()), true);
    return !empty($d['hash']) && password_verify($password, $d['hash']);
}

function cms_write_json(string $file, array $data): void {
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

// Login-Sperre gegen Passwort-Rateversuche
function cms_lockout_file(): string { return CMS_DATA . '/lockout.json'; }

function cms_lockout_remaining(): int {
    $f = cms_lockout_file();
    if (!is_file($f)) return 0;
    $d = json_decode((string)file_get_contents($f), true) ?: [];
    if (($d['fails'] ?? 0) < CMS_LOCKOUT_TRIES) return 0;
    $remaining = (int)($d['last'] ?? 0) + CMS_LOCKOUT_SECONDS - time();
    return max(0, $remaining);
}

function cms_lockout_register_fail(): void {
    $f = cms_lockout_file();
    $d = is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
    // Zähler zurücksetzen, wenn die Sperrzeit abgelaufen ist
    if (($d['fails'] ?? 0) >= CMS_LOCKOUT_TRIES && time() - (int)($d['last'] ?? 0) > CMS_LOCKOUT_SECONDS) {
        $d = [];
    }
    $d['fails'] = ($d['fails'] ?? 0) + 1;
    $d['last']  = time();
    cms_write_json($f, $d);
}

function cms_lockout_reset(): void {
    @unlink(cms_lockout_file());
}

// CSRF-Schutz
function cms_csrf_token(): string {
    cms_session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function cms_csrf_field(): string {
    return '<input type="hidden" name="csrf" value="' . cms_csrf_token() . '">';
}

function cms_csrf_check(): void {
    cms_session_start();
    $sent = $_POST['csrf'] ?? '';
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], (string)$sent)) {
        http_response_code(400);
        exit('Ungültige Anfrage (Sicherheits-Token fehlt). Bitte gehen Sie zurück und versuchen Sie es erneut.');
    }
}

function e(?string $s): string {
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

// ---------------------------------------------------------------------------
// Seiten
// ---------------------------------------------------------------------------

/** Liste aller bearbeitbaren Seiten: [key => ['file' =>, 'label' =>, 'url' =>]] */
function cms_pages(): array {
    global $config;
    $pages = [];
    $candidates = array_merge(
        glob(SITE_ROOT . '/*.html') ?: [],
        glob(SITE_ROOT . '/en/*.html') ?: []
    );
    foreach ($candidates as $file) {
        $rel = ltrim(str_replace(SITE_ROOT, '', $file), '/\\');
        $rel = str_replace('\\', '/', $rel);
        $key = str_replace(['/', '.html'], ['--', ''], $rel);
        $html = (string)file_get_contents($file);
        // Nur Seiten mit CMS-Feldern anzeigen
        if (strpos($html, 'data-cms') === false) continue;
        $label = $config['page_labels'][$rel] ?? cms_page_title($html) ?: $rel;
        $pages[$key] = ['file' => $file, 'rel' => $rel, 'label' => $label, 'url' => '../' . $rel];
    }
    // Sortierung: Reihenfolge aus config, Rest alphabetisch
    $order = array_keys($config['page_labels'] ?? []);
    uasort($pages, function ($a, $b) use ($order) {
        $ia = array_search($a['rel'], $order); $ib = array_search($b['rel'], $order);
        if ($ia === false && $ib === false) return strcmp($a['rel'], $b['rel']);
        if ($ia === false) return 1;
        if ($ib === false) return -1;
        return $ia <=> $ib;
    });
    return $pages;
}

function cms_page_title(string $html): string {
    if (preg_match('/<title>(.*?)<\/title>/si', $html, $m)) {
        return trim(html_entity_decode($m[1], ENT_QUOTES, 'UTF-8'));
    }
    return '';
}

function cms_get_page(string $key): ?array {
    $pages = cms_pages();
    return $pages[$key] ?? null;
}

// ---------------------------------------------------------------------------
// Inhalte auslesen (data-cms / data-cms-img)
// ---------------------------------------------------------------------------

const CMS_TEXT_TAGS = 'h1|h2|h3|h4|p|li|span|strong';

/**
 * Findet alle Textfelder einer Seite in Dokument-Reihenfolge.
 * Rückgabe: Liste von ['key','tag','html','text','multiline']
 */
function cms_scan_fields(string $html): array {
    $fields = [];
    $re = '/<(' . CMS_TEXT_TAGS . ')\b([^>]*\bdata-cms="([a-z0-9\-]+)"[^>]*)>(.*?)<\/\1>/su';
    if (preg_match_all($re, $html, $ms, PREG_SET_ORDER)) {
        foreach ($ms as $m) {
            $inner = $m[4];
            $fields[] = [
                'key'       => $m[3],
                'tag'       => strtolower($m[1]),
                'html'      => $inner,
                'text'      => cms_inner_to_editable($inner),
                'multiline' => in_array(strtolower($m[1]), ['p', 'li'], true),
            ];
        }
    }
    return $fields;
}

/** Findet alle Bilder mit data-cms-img. Rückgabe: Liste von ['key','src','alt'] */
function cms_scan_images(string $html): array {
    $imgs = [];
    if (preg_match_all('/<img\b[^>]*\bdata-cms-img="([a-z0-9\-]+)"[^>]*>/su', $html, $ms, PREG_SET_ORDER)) {
        foreach ($ms as $m) {
            $tag = $m[0];
            $src = preg_match('/\bsrc="([^"]*)"/', $tag, $s) ? $s[1] : '';
            $alt = preg_match('/\balt="([^"]*)"/', $tag, $a) ? $a[1] : '';
            $imgs[] = ['key' => $m[1], 'src' => $src, 'alt' => html_entity_decode($alt, ENT_QUOTES, 'UTF-8')];
        }
    }
    return $imgs;
}

/** Meta-Angaben (Titel + Beschreibung) einer Seite */
function cms_scan_meta(string $html): array {
    $title = cms_page_title($html);
    $desc  = '';
    if (preg_match('/<meta\s+name="description"\s+content="([^"]*)"/si', $html, $m)) {
        $desc = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
    }
    return ['title' => $title, 'description' => $desc];
}

/**
 * Wandelt gespeichertes Inner-HTML in editierbaren Text um:
 * <br> wird zu Zeilenumbruch, erlaubte Inline-Tags bleiben sichtbar.
 */
function cms_inner_to_editable(string $inner): string {
    $s = preg_replace('/<br\s*\/?>/i', "\n", $inner);
    return trim(html_entity_decode(strip_tags($s, '<strong><em><b><i><a><small>'), ENT_QUOTES, 'UTF-8'));
}

// ---------------------------------------------------------------------------
// Inhalte speichern
// ---------------------------------------------------------------------------

/**
 * Bereinigt Kundeneingaben. Erlaubt sind nur harmlose Inline-Tags,
 * alle Attribute außer einem sicheren href werden entfernt.
 */
function cms_sanitize(string $input, bool $multiline): string {
    $s = str_replace(["\r\n", "\r"], "\n", trim($input));

    // Nur erlaubte Tags behalten
    $s = strip_tags($s, '<br><strong><em><b><i><a><small>');

    // Attribute säubern: alles entfernen außer sicherem href bei <a>
    $s = preg_replace_callback('/<a\b[^>]*>/i', function ($m) {
        if (preg_match('/href="([^"]*)"/i', $m[0], $h)) {
            $href = trim($h[1]);
            $ok = preg_match('#^(https?://|mailto:|tel:|/|\#|[a-z0-9_\-./]+(\.html)?(\#[^"]*)?$)#i', $href)
                  && stripos($href, 'javascript:') === false
                  && stripos($href, 'data:') === false;
            if ($ok) return '<a href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '">';
        }
        return '<a>';
    }, $s);
    $s = preg_replace('/<(strong|em|b|i|small|br)\b[^>]*>/i', '<$1>', $s);

    // Freistehende & korrekt kodieren (bestehende Entities bleiben erhalten)
    $s = preg_replace('/&(?![a-zA-Z][a-zA-Z0-9]{1,10};|#[0-9]{1,6};|#x[0-9a-fA-F]{1,6};)/', '&amp;', $s);
    // < und > kodieren, die nicht zu erlaubten Tags gehören
    $s = preg_replace('/<(?!\/?(?:br|strong|em|b|i|a|small)\b)/i', '&lt;', $s);

    if ($multiline) {
        $s = str_replace("\n", "<br>\n", $s);
    } else {
        $s = str_replace("\n", ' ', $s);
    }
    return $s;
}

/** Ersetzt den Inhalt eines Textfeldes in der HTML-Datei (stringbasiert, byteschonend). */
function cms_replace_field(string $html, string $key, string $newInner, ?string &$error = null): string {
    $re = '/(<(' . CMS_TEXT_TAGS . ')\b[^>]*\bdata-cms="' . preg_quote($key, '/') . '"[^>]*>)(.*?)(<\/\2>)/su';
    $count = 0;
    $result = preg_replace_callback($re, function ($m) use ($newInner) {
        return $m[1] . $newInner . $m[4];
    }, $html, 1, $count);
    if ($count !== 1 || $result === null) {
        $error = 'Feld „' . $key . '“ wurde in der Seite nicht gefunden.';
        return $html;
    }
    return $result;
}

/** Ersetzt Titel + Meta-Beschreibung */
function cms_replace_meta(string $html, string $title, string $desc): string {
    $title = trim(str_replace(["\n", "\r"], ' ', $title));
    $desc  = trim(str_replace(["\n", "\r"], ' ', $desc));
    if ($title !== '') {
        $html = preg_replace('/(<title>).*?(<\/title>)/si', '$1' . cms_attr_escape($title) . '$2', $html, 1);
        $html = preg_replace('/(<meta\s+property="og:title"\s+content=")[^"]*(")/si', '$1' . cms_attr_escape($title) . '$2', $html, 1);
        $html = preg_replace('/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/si', '$1' . cms_attr_escape($title) . '$2', $html, 1);
    }
    if ($desc !== '') {
        $html = preg_replace('/(<meta\s+name="description"\s+content=")[^"]*(")/si', '$1' . cms_attr_escape($desc) . '$2', $html, 1);
        $html = preg_replace('/(<meta\s+property="og:description"\s+content=")[^"]*(")/si', '$1' . cms_attr_escape($desc) . '$2', $html, 1);
        $html = preg_replace('/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/si', '$1' . cms_attr_escape($desc) . '$2', $html, 1);
    }
    return $html;
}

function cms_attr_escape(string $s): string {
    return htmlspecialchars(html_entity_decode($s, ENT_QUOTES, 'UTF-8'), ENT_QUOTES, 'UTF-8');
}

/** Schreibt eine Seite mit vorheriger Sicherung */
function cms_save_page(array $page, string $newHtml): bool {
    cms_backup_page($page);
    return file_put_contents($page['file'], $newHtml, LOCK_EX) !== false;
}

// ---------------------------------------------------------------------------
// Sicherungen
// ---------------------------------------------------------------------------

function cms_backup_dir(array $page): string {
    return CMS_BACKUPS . '/' . str_replace(['/', '\\'], '--', $page['rel']);
}

function cms_backup_page(array $page): void {
    $dir = cms_backup_dir($page);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $name = date('Y-m-d_H-i-s') . '.html';
    copy($page['file'], $dir . '/' . $name);
    // Alte Sicherungen aufräumen
    $files = glob($dir . '/*.html') ?: [];
    sort($files);
    while (count($files) > CMS_BACKUPS_KEEP) {
        @unlink(array_shift($files));
    }
}

function cms_backups(array $page): array {
    $dir = cms_backup_dir($page);
    $files = is_dir($dir) ? (glob($dir . '/*.html') ?: []) : [];
    rsort($files);
    return $files;
}

function cms_restore_backup(array $page, string $backupName): bool {
    if (!preg_match('/^[0-9\-_]+\.html$/', $backupName)) return false;
    $src = cms_backup_dir($page) . '/' . $backupName;
    if (!is_file($src)) return false;
    cms_backup_page($page); // aktuellen Stand ebenfalls sichern
    return copy($src, $page['file']);
}

// ---------------------------------------------------------------------------
// Bild-Upload
// ---------------------------------------------------------------------------

/**
 * Verarbeitet einen Bild-Upload für ein data-cms-img Feld.
 * Gibt bei Erfolg den neuen relativen Pfad zurück, sonst null (Fehlertext in $error).
 */
function cms_handle_image_upload(array $file, string $key, ?string &$error = null): ?string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $error = 'Der Upload ist fehlgeschlagen. Bitte versuchen Sie es erneut.';
        return null;
    }
    if ($file['size'] > CMS_MAX_UPLOAD) {
        $error = 'Das Bild ist zu groß (max. 8 MB).';
        return null;
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->file($file['tmp_name']);
    $types = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($types[$mime])) {
        $error = 'Bitte laden Sie ein Bild im Format JPG, PNG oder WebP hoch.';
        return null;
    }
    $info = @getimagesize($file['tmp_name']);
    if ($info === false) {
        $error = 'Die Datei konnte nicht als Bild gelesen werden.';
        return null;
    }

    if (!is_dir(CMS_UPLOAD_DIR)) mkdir(CMS_UPLOAD_DIR, 0755, true);
    $ext  = $types[$mime];
    $name = $key . '-' . date('YmdHis') . '.' . $ext;
    $dest = CMS_UPLOAD_DIR . '/' . $name;

    // Bei Bedarf verkleinern (spart Ladezeit), sonst direkt übernehmen
    [$w, $h] = $info;
    if ($w > CMS_MAX_IMG_WIDTH && function_exists('imagecreatetruecolor')) {
        $srcImg = null;
        if ($mime === 'image/jpeg') $srcImg = @imagecreatefromjpeg($file['tmp_name']);
        elseif ($mime === 'image/png') $srcImg = @imagecreatefrompng($file['tmp_name']);
        elseif ($mime === 'image/webp' && function_exists('imagecreatefromwebp')) $srcImg = @imagecreatefromwebp($file['tmp_name']);
        if ($srcImg) {
            $nw = CMS_MAX_IMG_WIDTH;
            $nh = (int)round($h * $nw / $w);
            $dst = imagecreatetruecolor($nw, $nh);
            if ($mime === 'image/png' || $mime === 'image/webp') {
                imagealphablending($dst, false);
                imagesavealpha($dst, true);
            }
            imagecopyresampled($dst, $srcImg, 0, 0, 0, 0, $nw, $nh, $w, $h);
            $ok = false;
            if ($mime === 'image/jpeg') $ok = imagejpeg($dst, $dest, 85);
            elseif ($mime === 'image/png') $ok = imagepng($dst, $dest, 6);
            elseif ($mime === 'image/webp' && function_exists('imagewebp')) $ok = imagewebp($dst, $dest, 85);
            imagedestroy($dst);
            imagedestroy($srcImg);
            if ($ok) return 'images/cms/' . $name;
        }
    }
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        $error = 'Das Bild konnte nicht gespeichert werden.';
        return null;
    }
    return 'images/cms/' . $name;
}

/** Aktualisiert src/width/height eines data-cms-img Bildes in der HTML-Datei */
function cms_replace_image(string $html, string $key, string $newRelPath, string $pageRel): string {
    // Pfad relativ zur Seite (en/-Seiten brauchen ../)
    $prefix = (strpos($pageRel, '/') !== false) ? '../' : '';
    $newSrc = $prefix . $newRelPath;
    $size   = @getimagesize(SITE_ROOT . '/' . $newRelPath);

    return preg_replace_callback(
        '/<img\b[^>]*\bdata-cms-img="' . preg_quote($key, '/') . '"[^>]*>/su',
        function ($m) use ($newSrc, $size) {
            $tag = $m[0];
            $tag = preg_replace('/\bsrc="[^"]*"/', 'src="' . $newSrc . '"', $tag);
            if ($size) {
                if (preg_match('/\bwidth="[^"]*"/', $tag)) {
                    $tag = preg_replace('/\bwidth="[^"]*"/', 'width="' . $size[0] . '"', $tag);
                }
                if (preg_match('/\bheight="[^"]*"/', $tag)) {
                    $tag = preg_replace('/\bheight="[^"]*"/', 'height="' . $size[1] . '"', $tag);
                }
            }
            return $tag;
        },
        $html, 1
    );
}

/** Löscht ein zuvor vom CMS hochgeladenes Bild (nur innerhalb von images/cms/) */
function cms_delete_old_upload(string $src, string $pageRel): void {
    $src = ltrim($src, './');
    if (strpos($pageRel, '/') !== false) $src = preg_replace('#^\.\./#', '', $src);
    if (strpos($src, 'images/cms/') !== 0) return; // Original-Bilder der Website nie löschen
    $path = realpath(SITE_ROOT . '/' . $src);
    if ($path && strpos($path, realpath(CMS_UPLOAD_DIR)) === 0 && is_file($path)) {
        @unlink($path);
    }
}

// ---------------------------------------------------------------------------
// Layout (Admin-Oberfläche)
// ---------------------------------------------------------------------------

function cms_header(string $title, bool $withNav = true): void {
    global $config;
    $site = e($config['site_name']);
    echo '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<meta name="robots" content="noindex, nofollow">';
    echo '<title>' . e($title) . ' · CMS</title>';
    echo '<style>' . cms_css() . '</style></head><body>';
    echo '<header class="topbar"><div class="topbar-inner">';
    echo '<div class="brand"><span class="brand-dot"></span> <strong>' . $site . '</strong><span class="brand-sub">Website-Verwaltung</span></div>';
    if ($withNav && cms_is_logged_in()) {
        echo '<nav class="topnav">';
        echo '<a href="index.php">Seiten</a>';
        echo '<a href="password.php">Passwort</a>';
        echo '<a href="logout.php" class="logout">Abmelden</a>';
        echo '</nav>';
    }
    echo '</div></header><main class="wrap">';
}

function cms_footer(): void {
    echo '</main><footer class="cms-footer">LumioWeb Mini-CMS ' . CMS_VERSION
       . ' · erstellt von <a href="https://www.lumioweb.at" target="_blank" rel="noopener">LumioWeb</a></footer></body></html>';
}

function cms_flash(?string $msg = null, string $type = 'ok'): ?array {
    cms_session_start();
    if ($msg !== null) {
        $_SESSION['flash'] = ['msg' => $msg, 'type' => $type];
        return null;
    }
    $f = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $f;
}

function cms_show_flash(): void {
    $f = cms_flash();
    if ($f) {
        echo '<div class="flash flash-' . e($f['type']) . '">' . e($f['msg']) . '</div>';
    }
}

function cms_css(): string {
    return <<<'CSS'
:root{--ink:#1c1f24;--ink-soft:#5c636e;--bg:#f4f2ee;--surface:#fff;--border:#e3dfd7;--gold:#b8892b;--gold-dark:#96701f;--green:#2e7d32;--red:#b3261e;}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);font-size:16px;line-height:1.55}
a{color:var(--gold-dark)}
.topbar{background:#14171c;color:#fff;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.topbar-inner{max-width:960px;margin:0 auto;padding:.8rem 1.2rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:.55rem;font-size:1.02rem}
.brand-dot{width:10px;height:10px;border-radius:50%;background:var(--gold);display:inline-block}
.brand-sub{color:#9aa1ab;font-size:.85rem;margin-left:.35rem}
.topnav a{color:#d6dae0;text-decoration:none;margin-left:1.1rem;font-size:.95rem}
.topnav a:hover{color:#fff;text-decoration:underline}
.topnav .logout{color:#f0b9b5}
.wrap{max-width:960px;margin:0 auto;padding:1.6rem 1.2rem 3rem}
h1{font-size:1.5rem;margin:.4rem 0 1rem}
h2{font-size:1.12rem;margin:2rem 0 .6rem}
.hint{color:var(--ink-soft);font-size:.92rem}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.2rem;margin-bottom:.8rem}
.page-list{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));padding:0;margin:1rem 0;list-style:none}
.page-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.35rem}
.page-card strong{font-size:1.03rem}
.page-card .meta{color:var(--ink-soft);font-size:.85rem}
.page-card .actions{margin-top:.5rem;display:flex;gap:.6rem;flex-wrap:wrap}
.btn{display:inline-block;border:0;border-radius:10px;padding:.6rem 1.1rem;font-size:.95rem;cursor:pointer;text-decoration:none;font-weight:600}
.btn-gold{background:var(--gold);color:#fff}
.btn-gold:hover{background:var(--gold-dark)}
.btn-ghost{background:transparent;color:var(--ink);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--ink-soft)}
.btn-sm{padding:.4rem .8rem;font-size:.87rem}
.field{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.9rem 1rem;margin-bottom:.7rem}
.field label{display:flex;gap:.5rem;align-items:baseline;margin-bottom:.45rem}
.badge{font-size:.72rem;letter-spacing:.03em;text-transform:uppercase;background:#efe9dd;color:#7a6428;border-radius:6px;padding:.15rem .5rem;font-weight:700}
.badge-img{background:#e3ede3;color:#2e5d32}
input[type=text],input[type=password],textarea{width:100%;border:1px solid var(--border);border-radius:9px;padding:.6rem .75rem;font-size:1rem;font-family:inherit;background:#fdfcfa;color:var(--ink)}
input:focus,textarea:focus{outline:2px solid var(--gold);outline-offset:0;border-color:var(--gold)}
textarea{min-height:5.2rem;resize:vertical;line-height:1.5}
.savebar{position:sticky;bottom:0;background:linear-gradient(to top,var(--bg) 75%,transparent);padding:1rem 0 .6rem;display:flex;gap:.8rem;align-items:center}
.flash{border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;font-weight:500}
.flash-ok{background:#e6f2e6;color:var(--green);border:1px solid #bcd9bc}
.flash-err{background:#fbe9e7;color:var(--red);border:1px solid #ecc4c0}
.imgfield{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
.imgfield img{max-width:130px;max-height:100px;border-radius:8px;border:1px solid var(--border);object-fit:cover}
.login-box{max-width:400px;margin:8vh auto 0}
.login-box .card{padding:1.6rem}
.login-box h1{margin-top:0}
table.backups{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
table.backups th,table.backups td{text-align:left;padding:.65rem .9rem;border-bottom:1px solid var(--border);font-size:.95rem}
table.backups tr:last-child td{border-bottom:0}
.cms-footer{max-width:960px;margin:0 auto;padding:1rem 1.2rem 2rem;color:var(--ink-soft);font-size:.85rem}
.section-jump{display:flex;gap:.5rem;flex-wrap:wrap;margin:.4rem 0 1.2rem}
.section-jump a{font-size:.85rem;background:var(--surface);border:1px solid var(--border);padding:.3rem .7rem;border-radius:999px;text-decoration:none;color:var(--ink-soft)}
CSS;
}
