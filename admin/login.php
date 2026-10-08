<?php
require __DIR__ . '/lib.php';
cms_session_start();

if (!cms_users_exist()) { header('Location: setup.php'); exit; }
if (cms_is_logged_in())  { header('Location: index.php'); exit; }

$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    cms_csrf_check();
    $wait = cms_lockout_remaining();
    if ($wait > 0) {
        $error = 'Zu viele Fehlversuche. Bitte warten Sie ' . ceil($wait / 60) . ' Minute(n).';
    } elseif (cms_check_password((string)($_POST['password'] ?? ''))) {
        cms_lockout_reset();
        session_regenerate_id(true);
        $_SESSION['cms_user'] = 'admin';
        header('Location: index.php');
        exit;
    } else {
        cms_lockout_register_fail();
        $error = 'Das Passwort ist leider nicht korrekt.';
    }
}

cms_header('Anmelden', false);
?>
<div class="login-box">
  <div class="card">
    <h1>Anmelden</h1>
    <p class="hint">Melden Sie sich an, um die Inhalte Ihrer Website zu bearbeiten.</p>
    <?php if ($error): ?><div class="flash flash-err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" autocomplete="off">
      <?= cms_csrf_field() ?>
      <p><label for="pw"><strong>Passwort</strong></label>
      <input type="password" id="pw" name="password" required autofocus></p>
      <button class="btn btn-gold" type="submit">Anmelden</button>
    </form>
  </div>
</div>
<?php cms_footer(); ?>
