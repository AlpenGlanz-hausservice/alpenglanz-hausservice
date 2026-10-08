<?php
require __DIR__ . '/lib.php';
cms_require_login();

$pages = cms_pages();

cms_header('Seiten');
cms_show_flash();
?>
<h1>Ihre Website-Seiten</h1>
<p class="hint">Wählen Sie eine Seite aus, um Texte und Bilder zu bearbeiten. Jede Änderung wird automatisch gesichert und kann jederzeit rückgängig gemacht werden.</p>

<ul class="page-list">
<?php foreach ($pages as $key => $p):
    $html = (string)file_get_contents($p['file']);
    $nText = count(cms_scan_fields($html));
    $nImg  = count(cms_scan_images($html));
?>
  <li class="page-card">
    <strong><?= e($p['label']) ?></strong>
    <span class="meta"><?= $nText ?> Textfelder<?= $nImg ? ' · ' . $nImg . ' Bild(er)' : '' ?> · Stand: <?= date('d.m.Y H:i', (int)filemtime($p['file'])) ?></span>
    <div class="actions">
      <a class="btn btn-gold btn-sm" href="edit.php?page=<?= e($key) ?>">Bearbeiten</a>
      <a class="btn btn-ghost btn-sm" href="<?= e($p['url']) ?>" target="_blank" rel="noopener">Ansehen</a>
      <a class="btn btn-ghost btn-sm" href="history.php?page=<?= e($key) ?>">Verlauf</a>
    </div>
  </li>
<?php endforeach; ?>
</ul>
<?php cms_footer(); ?>
