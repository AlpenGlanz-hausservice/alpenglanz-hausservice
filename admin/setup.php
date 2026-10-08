<?php
require __DIR__ . '/lib.php';
cms_session_start();

// Nur zugänglich, solange noch kein Passwort gesetzt wurde
if (cms_users_exist()) { header('Location: login.php'); exit; }

$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    cms_csrf_check();
    $p1 = (string)($_POST['password'] ?? '');
    $p2 = (string)($_POST['password2'] ?? '');
    if (strlen($p1) < 10) {
        $error = 'Das Passwort muss mindestens 10 Zeichen lang sein.';
    } elseif ($p1 !== $p2) {
        $error = 'Die beiden Passwörter stimmen nicht überein.';
    } else {
        cms_set_password($p1);
        session_regenerate_id(true);
        $_SESSION['cms_user'] = 'admin';
        cms_flash('Willkommen! Das Passwort wurde gesetzt, Sie sind jetzt angemeldet.');
        header('Location: index.php');
        exit;
    }
}

cms_header('Einrichtung', false);
?>
<div class="login-box">
  <div class="card">
    <h1>Erste Einrichtung</h1>
    <p class="hint">Legen Sie ein Passwort für die Website-Verwaltung fest. Mindestens 10 Zeichen, am besten ein ganzer Satz.</p>
    <?php if ($error): ?><div class="flash flash-err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" autocomplete="off">
      <?= cms_csrf_field() ?>
      <p><label for="pw"><strong>Neues Passwort</strong></label>
      <input type="password" id="pw" name="password" required minlength="10" autofocus></p>
      <p><label for="pw2"><strong>Passwort wiederholen</strong></label>
      <input type="password" id="pw2" name="password2" required minlength="10"></p>
      <button class="btn btn-gold" type="submit">Passwort festlegen</button>
    </form>
  </div>
</div>
<?php cms_footer(); ?>
