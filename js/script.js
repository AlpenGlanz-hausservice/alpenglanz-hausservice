/* AlpenGlanz Hausservice — interactions */
(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var navToggle = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('.nav-links');

  /* ---------- Header shrink on scroll ---------- */
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 12) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Mobile nav toggle ---------- */
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', isOpen);
      navToggle.setAttribute('aria-expanded', String(isOpen));
      document.body.classList.toggle('nav-open', isOpen);
    });

    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
      });
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('is-open')) {
        navLinks.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
        navToggle.focus();
      }
    });
  }

  /* ---------- Active nav link by current page ---------- */
  var current = (window.location.pathname.split('/').pop() || 'index.html');
  document.querySelectorAll('.nav-links a[data-nav]').forEach(function (link) {
    var target = link.getAttribute('data-nav');
    if (target === current || (current === '' && target === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && revealEls.length) {
    var counters = new WeakMap();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var group = el.closest('[data-reveal-group]');
          if (group) {
            var count = counters.get(group) || 0;
            el.style.setProperty('--stagger', count);
            counters.set(group, count + 1);
          }
          el.classList.add('is-visible');
          io.unobserve(el);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Hero video: reduced motion + autoplay fallback ----------
     Responsive sources are declarative (<source media> in the HTML), so
     browsers pick the right file natively and autoplay muted. */
  var heroVideo = document.querySelector('.hero-video');
  if (heroVideo) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      heroVideo.removeAttribute('autoplay');
      heroVideo.pause();
    } else {
      heroVideo.muted = true; // belt & braces for strict webviews
      var tryPlay = function () {
        if (!heroVideo.paused) return;
        var p = heroVideo.play();
        if (p && p.catch) p.catch(function () { /* poster stays as fallback */ });
      };
      // Strict autoplay policies (some embedded webviews) need a user
      // gesture — first tap/scroll starts the loop as a fallback.
      window.addEventListener('pointerdown', tryPlay, { once: true, passive: true });
      window.addEventListener('scroll', tryPlay, { once: true, passive: true });
      // Browsers defer autoplay while the tab is hidden — resume when shown.
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) tryPlay();
      });
    }
  }

  /* ---------- Contact form -> Cloudflare Pages Function (/api/contact) ---------- */
  var form = document.getElementById('contact-form');
  if (form) {
    var statusBox = form.querySelector('.form-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    // Sprachabhängige UI-Texte (script.js wird von der DE- und der EN-Seite genutzt).
    var isEN = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
    var MSG = isEN ? {
      required: 'Please fill in this field.',
      email:    'Please enter a valid email address.',
      sending:  'Sending ...',
      success:  'Thank you. Your enquiry has been sent successfully.',
      error:    'Something went wrong while sending. Please try again later.'
    } : {
      required: 'Bitte füllen Sie dieses Feld aus.',
      email:    'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      sending:  'Wird gesendet ...',
      success:  'Vielen Dank. Ihre Anfrage wurde erfolgreich versendet.',
      error:    'Beim Versenden ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.'
    };

    var ICON_OK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> ';
    var ICON_ERR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ';

    function setError(field, message) {
      var wrap = field.closest('.form-field');
      if (!wrap) return;
      wrap.classList.add('has-error');
      var err = wrap.querySelector('.form-error');
      if (err) err.textContent = message;
    }
    function clearError(field) {
      var wrap = field.closest('.form-field');
      if (!wrap) return;
      wrap.classList.remove('has-error');
    }

    // Live-Validierung beim Verlassen/Tippen eines Feldes.
    form.querySelectorAll('input, textarea, select').forEach(function (field) {
      field.addEventListener('blur', function () { validateField(field); });
      field.addEventListener('input', function () {
        var wrap = field.closest('.form-field');
        if (wrap && wrap.classList.contains('has-error')) validateField(field);
      });
    });

    function validateField(field) {
      if (field.hasAttribute('required') && !field.value.trim()) {
        setError(field, MSG.required);
        return false;
      }
      if (field.type === 'email' && field.value.trim()) {
        var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!re.test(field.value.trim())) {
          setError(field, MSG.email);
          return false;
        }
      }
      clearError(field);
      return true;
    }

    function showStatus(kind, text) {
      statusBox.className = 'form-status is-' + kind;
      statusBox.innerHTML = (kind === 'success' ? ICON_OK : ICON_ERR) + text;
    }

    // Absenden: keine Formspree-Logik mehr - POST als JSON an /api/contact.
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      statusBox.className = 'form-status';

      // 1) Client-seitige Validierung (der Server validiert zusätzlich).
      var required = form.querySelectorAll('input[required], textarea[required], select[required]');
      var valid = true, firstInvalid = null;
      required.forEach(function (field) {
        var ok = validateField(field);
        if (!ok && !firstInvalid) firstInvalid = field;
        valid = valid && ok;
      });
      if (!valid) {
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      // 2) Button-Status setzen.
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
      submitBtn.textContent = MSG.sending;

      // 3) JSON-Payload bauen (inkl. Honeypot-Feld "company").
      var val = function (sel) { var el = form.querySelector(sel); return el ? el.value.trim() : ''; };
      var payload = {
        name:    val('#name'),
        email:   val('#email'),
        phone:   val('#phone'),
        service: (form.querySelector('#service') || {}).value || '',
        message: val('#message'),
        company: (form.querySelector('#company') || {}).value || '' // Honeypot: muss leer bleiben
      };

      // 4) An die Cloudflare Pages Function senden.
      try {
        var res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = {};
        try { data = await res.json(); } catch (err) { data = {}; }

        if (res.ok && data && data.ok) {
          form.reset();
          showStatus('success', MSG.success);
        } else {
          showStatus('error', (!isEN && data && data.error) ? data.error : MSG.error);
        }
      } catch (err) {
        showStatus('error', MSG.error);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText;
      }
    });
  }

  /* ---------- WhatsApp button: particle burst on click ---------- */
  var waBtn = document.querySelector('.wa-float');
  if (waBtn && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    waBtn.addEventListener('click', function () {
      var rect = waBtn.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;

      waBtn.classList.add('is-bursting');
      window.setTimeout(function () { waBtn.classList.remove('is-bursting'); }, 220);

      for (var i = 0; i < 12; i++) {
        (function (i) {
          var p = document.createElement('div');
          p.className = 'wa-particle';
          p.style.left = cx + 'px';
          p.style.top = cy + 'px';
          document.body.appendChild(p);

          var angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.5;
          var dist = 34 + Math.random() * 34;
          var dx = Math.cos(angle) * dist;
          var dy = Math.sin(angle) * dist;

          p.animate(
            [
              { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
              { transform: 'translate(-50%, -50%) translate(' + dx + 'px,' + dy + 'px) scale(0)', opacity: 0 }
            ],
            { duration: 600 + Math.random() * 200, delay: i * 12, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
          ).onfinish = function () { p.remove(); };
        })(i);
      }
      // The link still opens WhatsApp in a new tab; particles play on the current page.
    });
  }
})();

/* =========================================================
   CUSTOM CURSOR — START
   Matching CSS lives in css/style.css (search "CUSTOM CURSOR").
   To remove the whole effect: delete this IIFE and the CSS block.
   ========================================================= */
(function () {
  'use strict';

  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Touch devices and reduced-motion users keep the normal system cursor.
  if (!canHover || prefersReducedMotion) return;

  var dot = document.createElement('div');
  dot.className = 'cursor-dot';
  dot.setAttribute('aria-hidden', 'true');

  var ring = document.createElement('div');
  ring.className = 'cursor-ring';
  ring.setAttribute('aria-hidden', 'true');

  document.body.appendChild(dot);
  document.body.appendChild(ring);
  document.documentElement.classList.add('has-custom-cursor');

  var mouseX = -100;
  var mouseY = -100;
  var ringX = -100;
  var ringY = -100;

  // How quickly the ring "catches up" to the pointer each frame.
  // 1 = no lag (snaps instantly), lower = smoother/slower trailing motion.
  // Try values between 0.1 (very smooth/slow) and 0.3 (snappier).
  var RING_EASE = 0.18;

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.transform = 'translate3d(' + mouseX + 'px,' + mouseY + 'px,0) translate(-50%,-50%)';
  }
  document.addEventListener('mousemove', onMouseMove, { passive: true });

  function renderRing() {
    ringX += (mouseX - ringX) * RING_EASE;
    ringY += (mouseY - ringY) * RING_EASE;
    ring.style.transform = 'translate3d(' + ringX + 'px,' + ringY + 'px,0) translate(-50%,-50%)';
    requestAnimationFrame(renderRing);
  }
  requestAnimationFrame(renderRing);

  // Elements that should trigger the hover-grow state.
  var hoverSelector = 'a, button, input, textarea, select, label, .btn, [role="button"]';

  document.addEventListener('mouseover', function (e) {
    if (e.target.closest && e.target.closest(hoverSelector)) {
      ring.classList.add('is-hover');
      dot.classList.add('is-hover');
    }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest(hoverSelector)) {
      ring.classList.remove('is-hover');
      dot.classList.remove('is-hover');
    }
  });

  document.addEventListener('mousedown', function () { ring.classList.add('is-pressed'); });
  document.addEventListener('mouseup', function () { ring.classList.remove('is-pressed'); });

  // Hide while the pointer is outside the browser viewport.
  document.documentElement.addEventListener('mouseleave', function () {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });
  document.documentElement.addEventListener('mouseenter', function () {
    dot.style.opacity = '';
    ring.style.opacity = '';
  });
})();
/* =========================================================
   CUSTOM CURSOR — END
   ========================================================= */

/* =========================================================
   CRYSTAL CURSOR TRAIL — START
   Vanilla port of the React "crystal cursor", recoloured to the
   brand gold. Scoped to the DARK video hero only (.hero-has-video),
   where the gold shimmer + click-shatter read best. Pages without
   that hero (light headers) get no effect. The canvas lives inside
   the hero, so it scrolls away with it. Matching CSS: css/style.css
   (search "CRYSTAL CURSOR TRAIL"). Delete both blocks to remove.
   ========================================================= */
(function () {
  'use strict';

  // Gold crystal cursor trail over the homepage hero video.
  // Set to false to disable without deleting anything.
  var CRYSTAL_ENABLED = true;
  if (!CRYSTAL_ENABLED) return;

  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canHover || reduced) return;

  // Only run over the dark video hero (homepage). No dark hero -> no effect.
  var hero = document.querySelector('.hero-has-video');
  if (!hero) return;

  // --- Tunables ---
  var GOLD_LINE_H = 44;   // hue for crystal lines (warm gold)
  var GOLD_LINE_S = 88;   // saturation %
  var GOLD_LINE_L = 78;   // lightness % (bright warm-gold, reads on the video)
  var LINE_ALPHA  = 0.95; // max line opacity
  var LINE_GLOW   = 9;    // soft glow radius
  var CRYSTAL_LIFE = 55;  // frames a crystal lives (short = tidy trail, no litter)
  var SPAWN_JITTER = 12;  // px spread around the cursor (small = hugs the cursor)
  var EMIT_CHANCE = 0.55; // 0..1 chance to spawn each frame while over the hero
  var SHARD_COUNT = 30;   // particles per click

  var canvas = document.createElement('canvas');
  canvas.className = 'crystal-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  hero.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var cssW = 0, cssH = 0;
  function sizeCanvas() {
    var r = hero.getBoundingClientRect();
    cssW = r.width;
    cssH = r.height;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeCanvas();

  // Mouse tracked in viewport coords; converted to hero-local each frame.
  var mx = 0, my = 0, hasMouse = false;
  var crystals = [];
  var shards = [];

  function Crystal(x, y) {
    this.x = x; this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    this.radius = 0;
    this.targetRadius = Math.random() * 16 + 6; // short, delicate lines
    this.life = CRYSTAL_LIFE;
    this.maxLife = CRYSTAL_LIFE;
    this.lineWidth = Math.random() * 0.7 + 0.5;
    this.turn = (Math.random() - 0.5) * 0.08;
  }
  Crystal.prototype.update = function () {
    if (this.radius < this.targetRadius) this.radius += 0.5;
    this.life -= 1;
    this.angle += this.turn;
  };
  Crystal.prototype.draw = function () {
    var a = (this.life / this.maxLife) * LINE_ALPHA;
    ctx.save();
    ctx.strokeStyle = 'hsla(' + GOLD_LINE_H + ',' + GOLD_LINE_S + '%,' + GOLD_LINE_L + '%,' + a + ')';
    ctx.lineCap = 'round';
    ctx.lineWidth = this.lineWidth;
    ctx.shadowColor = 'hsla(' + GOLD_LINE_H + ',' + GOLD_LINE_S + '%,72%,' + a + ')';
    ctx.shadowBlur = LINE_GLOW;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.angle) * this.radius, this.y + Math.sin(this.angle) * this.radius);
    ctx.stroke();
    ctx.restore();
  };

  function Shard(x, y) {
    this.x = x; this.y = y;
    var angle = Math.random() * Math.PI * 2;
    var speed = Math.random() * 5 + 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = 100;
    this.maxLife = 100;
    this.size = Math.random() * 2.4 + 0.8;
  }
  Shard.prototype.update = function () {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.04; // subtle gravity
    this.life -= 1;
  };
  Shard.prototype.draw = function () {
    var a = this.life / this.maxLife;
    ctx.save();
    ctx.fillStyle = 'hsla(44, 82%, 66%, ' + a + ')';
    ctx.shadowColor = 'hsla(44, 82%, 70%, ' + a + ')';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  function heroLocal() {
    var r = hero.getBoundingClientRect();
    return { lx: mx - r.left, ly: my - r.top, w: r.width, h: r.height };
  }

  function animate() {
    ctx.clearRect(0, 0, cssW, cssH);

    var p = heroLocal();
    var inside = hasMouse && p.lx >= 0 && p.lx <= p.w && p.ly >= 0 && p.ly <= p.h;
    if (inside && Math.random() < EMIT_CHANCE) {
      crystals.push(new Crystal(
        p.lx + (Math.random() - 0.5) * SPAWN_JITTER,
        p.ly + (Math.random() - 0.5) * SPAWN_JITTER
      ));
    }

    for (var i = crystals.length - 1; i >= 0; i--) {
      crystals[i].update();
      crystals[i].draw();
      if (crystals[i].life <= 0) crystals.splice(i, 1);
    }
    for (var j = shards.length - 1; j >= 0; j--) {
      shards[j].update();
      shards[j].draw();
      if (shards[j].life <= 0) shards.splice(j, 1);
    }
    requestAnimationFrame(animate);
  }
  animate();

  window.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY; hasMouse = true;
  }, { passive: true });

  // Shatter only when the click lands inside the hero.
  hero.addEventListener('click', function (e) {
    var r = hero.getBoundingClientRect();
    var lx = e.clientX - r.left, ly = e.clientY - r.top;
    for (var i = 0; i < SHARD_COUNT; i++) shards.push(new Shard(lx, ly));
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sizeCanvas, 150);
  });
})();
/* =========================================================
   CRYSTAL CURSOR TRAIL — END
   ========================================================= */
