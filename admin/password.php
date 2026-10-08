<?php
require __DIR__ . '/lib.php';
cms_require_login();

$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    cms_csrf_check();
    $old = (string)($_POST['old'] ?? '');
    $p1  = (string)($_POST['password'] ?? '');
    $p2  = (string)($_POST['password2'] ?? '');
    if (!cms_check_password($old)) {
        $error = 'Das aktuelle Passwort ist nicht korrekt.';
    } elseif (strlen($p1) < 10) {
        $error = 'Das neue Passwort muss mindestens 10 Zeichen lang sein.';
    } elseif ($p1 !== $p2) {
        $error = 'Die beiden neuen Passwörter stimmen nicht überein.';
    } else {
        cms_set_password($p1);
        cms_flash('Das Passwort wurde geändert.');
        header('Location: index.php');
        exit;
    }
}

cms_header('Passwort ändern');
?>
<p><a href="index.php">&larr; Zur Übersicht</a></p>
<h1>Passwort ändern</h1>
<?php if ($error): ?><div class="flash flash-err"><?= e($error) ?></div><?php endif; ?>
<div class="card" style="max-width:430px">
  <form method="post" autocomplete="off">
    <?= cms_csrf_field() ?>
    <p><label><strong>Aktuelles Passwort</strong></label>
    <input type="password" name="old" required></p>
    <p><label><strong>Neues Passwort</strong> <span class="hint">(mind. 10 Zeichen)</span></label>
    <input type="password" name="password" required minlength="10"></p>
    <p><label><strong>Neues Passwort wiederholen</strong></label>
    <input type="password" name="password2" required minlength="10"></p>
    <button class="btn btn-gold" type="submit">Passwort ändern</button>
  </form>
</div>
<?php cms_footer(); ?>
