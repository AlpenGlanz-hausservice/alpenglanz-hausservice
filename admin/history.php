<?php
require __DIR__ . '/lib.php';
cms_require_login();

$page = cms_get_page((string)($_GET['page'] ?? ''));
if (!$page) { cms_flash('Diese Seite wurde nicht gefunden.', 'err'); header('Location: index.php'); exit; }
$pageKey = (string)$_GET['page'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    cms_csrf_check();
    $name = (string)($_POST['backup'] ?? '');
    if (cms_restore_backup($page, $name)) {
        cms_flash('Die frühere Version wurde wiederhergestellt.');
    } else {
        cms_flash('Die Version konnte nicht wiederhergestellt werden.', 'err');
    }
    header('Location: history.php?page=' . urlencode($pageKey));
    exit;
}

$backups = cms_backups($page);

cms_header('Verlauf · ' . $page['label']);
cms_show_flash();
?>
<p><a href="index.php">&larr; Zur Übersicht</a></p>
<h1>Verlauf: <?= e($page['label']) ?></h1>
<p class="hint">Vor jedem Speichern wird automatisch eine Sicherung angelegt. Hier können Sie eine frühere Version wiederherstellen — der aktuelle Stand wird dabei ebenfalls gesichert, es geht also nichts verloren.</p>

<?php if (!$backups): ?>
  <div class="card">Es gibt noch keine Sicherungen. Sie entstehen automatisch beim ersten Speichern.</div>
<?php else: ?>
<table class="backups">
  <tr><th>Zeitpunkt</th><th></th></tr>
  <?php foreach ($backups as $b):
      $name = basename($b);
      $nice = DateTime::createFromFormat('Y-m-d_H-i-s', substr($name, 0, -5));
  ?>
  <tr>
    <td><?= $nice ? e($nice->format('d.m.Y \u\m H:i:s \U\h\r')) : e($name) ?></td>
    <td style="text-align:right">
      <form method="post" style="display:inline" onsubmit="return confirm('Diese Version wirklich wiederherstellen?');">
        <?= cms_csrf_field() ?>
        <input type="hidden" name="backup" value="<?= e($name) ?>">
        <button class="btn btn-ghost btn-sm" type="submit">Wiederherstellen</button>
      </form>
    </td>
  </tr>
  <?php endforeach; ?>
</table>
<?php endif; ?>
<?php cms_footer(); ?>
