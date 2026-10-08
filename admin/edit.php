<?php
require __DIR__ . '/lib.php';
cms_require_login();

$page = cms_get_page((string)($_GET['page'] ?? ''));
if (!$page) { cms_flash('Diese Seite wurde nicht gefunden.', 'err'); header('Location: index.php'); exit; }
$pageKey = (string)$_GET['page'];

$html = (string)file_get_contents($page['file']);

// ---------------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    cms_csrf_check();
    $errors  = [];
    $changed = false;

    // 1) Textfelder
    $fields = cms_scan_fields($html);
    foreach ($fields as $f) {
        $name = 'f_' . $f['key'];
        if (!isset($_POST[$name])) continue;
        $new = cms_sanitize((string)$_POST[$name], $f['multiline']);
        if ($new === '') continue; // leere Felder überspringen statt Inhalte zu löschen
        $current = trim($f['html']);
        if ($new !== $current && cms_inner_to_editable($new) !== cms_inner_to_editable($current)) {
            $err = null;
            $html = cms_replace_field($html, $f['key'], $new, $err);
            if ($err) $errors[] = $err; else $changed = true;
        }
    }

    // 2) Meta (Titel + Beschreibung für Google)
    $meta = cms_scan_meta($html);
    $newTitle = trim((string)($_POST['meta_title'] ?? ''));
    $newDesc  = trim((string)($_POST['meta_description'] ?? ''));
    if (($newTitle !== '' && $newTitle !== $meta['title']) || ($newDesc !== '' && $newDesc !== $meta['description'])) {
        $html = cms_replace_meta($html, $newTitle, $newDesc);
        $changed = true;
    }

    // 3) Bilder
    foreach (cms_scan_images($html) as $img) {
        $name = 'img_' . $img['key'];
        if (empty($_FILES[$name]['name'])) continue;
        $err = null;
        $newPath = cms_handle_image_upload($_FILES[$name], $img['key'], $err);
        if ($newPath === null) { $errors[] = $err; continue; }
        cms_delete_old_upload($img['src'], $page['rel']);
        $html = cms_replace_image($html, $img['key'], $newPath, $page['rel']);
        $changed = true;
    }

    if ($changed) {
        if (cms_save_page($page, $html)) {
            $msg = 'Ihre Änderungen wurden gespeichert.';
            if ($errors) $msg .= ' Hinweis: ' . implode(' ', $errors);
            cms_flash($msg, $errors ? 'err' : 'ok');
        } else {
            cms_flash('Die Seite konnte nicht gespeichert werden. Bitte kontaktieren Sie LumioWeb.', 'err');
        }
    } else {
        cms_flash($errors ? implode(' ', $errors) : 'Es gab keine Änderungen zu speichern.', $errors ? 'err' : 'ok');
    }
    header('Location: edit.php?page=' . urlencode($pageKey));
    exit;
}

// ---------------------------------------------------------------------------
// Formular anzeigen
// ---------------------------------------------------------------------------
$fields = cms_scan_fields($html);
$images = cms_scan_images($html);
$meta   = cms_scan_meta($html);

$badges = [
    'h1' => 'Hauptüberschrift', 'h2' => 'Überschrift', 'h3' => 'Zwischentitel',
    'h4' => 'Zwischentitel', 'p' => 'Text', 'li' => 'Listenpunkt',
    'span' => 'Kurztext', 'strong' => 'Hervorhebung',
];

cms_header($page['label']);
cms_show_flash();
?>
<p><a href="index.php">&larr; Zur Übersicht</a></p>
<h1><?= e($page['label']) ?> bearbeiten</h1>
<p class="hint">Ändern Sie die gewünschten Texte und klicken Sie unten auf „Änderungen speichern“. Das Design der Website bleibt dabei automatisch erhalten. <a href="<?= e($page['url']) ?>" target="_blank" rel="noopener">Seite ansehen</a></p>

<form method="post" enctype="multipart/form-data">
  <?= cms_csrf_field() ?>

  <?php if ($images): ?>
  <h2>Bilder</h2>
  <?php foreach ($images as $img): ?>
    <div class="field imgfield">
      <img src="<?= e($page['url'] !== '' ? dirname($page['url']) . '/' . $img['src'] : $img['src']) ?>" alt="">
      <div style="flex:1;min-width:230px">
        <label><span class="badge badge-img">Bild</span> <strong><?= e($img['alt'] ?: basename($img['src'])) ?></strong></label>
        <input type="file" name="img_<?= e($img['key']) ?>" accept="image/jpeg,image/png,image/webp">
        <p class="hint" style="margin:.4rem 0 0">Neues Bild auswählen (JPG, PNG oder WebP, max. 8 MB). Große Bilder werden automatisch verkleinert.</p>
      </div>
    </div>
  <?php endforeach; ?>
  <?php endif; ?>

  <h2>Texte</h2>
  <?php foreach ($fields as $f): ?>
    <div class="field">
      <label for="f-<?= e($f['key']) ?>"><span class="badge"><?= e($badges[$f['tag']] ?? 'Text') ?></span></label>
      <?php if ($f['multiline'] || mb_strlen($f['text']) > 90): ?>
        <textarea id="f-<?= e($f['key']) ?>" name="f_<?= e($f['key']) ?>" rows="<?= min(9, max(2, (int)ceil(mb_strlen($f['text']) / 80))) ?>"><?= e($f['text']) ?></textarea>
      <?php else: ?>
        <input type="text" id="f-<?= e($f['key']) ?>" name="f_<?= e($f['key']) ?>" value="<?= e($f['text']) ?>">
      <?php endif; ?>
    </div>
  <?php endforeach; ?>

  <h2>Google-Vorschau (für Fortgeschrittene)</h2>
  <p class="hint">Diese Texte erscheinen nicht auf der Website selbst, sondern in Suchergebnissen und beim Teilen des Links.</p>
  <div class="field">
    <label><span class="badge">Seitentitel</span></label>
    <input type="text" name="meta_title" value="<?= e($meta['title']) ?>">
  </div>
  <div class="field">
    <label><span class="badge">Beschreibung</span></label>
    <textarea name="meta_description" rows="2"><?= e($meta['description']) ?></textarea>
  </div>

  <div class="savebar">
    <button class="btn btn-gold" type="submit">Änderungen speichern</button>
    <a class="btn btn-ghost" href="index.php">Abbrechen</a>
  </div>
</form>
<?php cms_footer(); ?>
