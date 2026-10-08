# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static marketing website for **AlpenGlanz Hausservice OG**, a cleaning company in Schladming, Austria. Plain HTML/CSS/JS — **no framework, no build step, no package manager, no tests**. Deploy = copy files to any static host. German-language content.

Six pages, all sharing one stylesheet and one script:
`index.html` (hero + video), `leistungen.html` (8 service cards), `ueber-uns.html` (team + area map), `kontakt.html` (form), `impressum.html`, `datenschutz.html`.

## Running & exporting

```bash
# Local preview (a server is required so fetch()/form logic and video load correctly)
python -m http.server 5500        # then open http://localhost:5500
```

There is nothing to build, lint, or test. `.claude/launch.json` defines the preview server for tooling; it is not part of the deliverable.

## Critical conventions (read before editing)

**1. No templating — the header, nav, and footer are duplicated verbatim in every HTML file.** The site is now bilingual: 6 German pages at the root + 4 English pages under `en/` + `404.html` = **11 HTML files** (a DE/EN `.lang-switch` lives in each header; some pages also carry `data-cms` attributes + per-page `<style>` blocks for Phase-2 sections like reviews/FAQ/service detail). Any change to navigation, logo markup, the WhatsApp button, or the footer must be applied to every page. Bulk edits are normally done with a small Python `re.sub` loop over all HTML files rather than one Edit per file.

**2. Cache-busting is manual and mandatory.** CSS and JS are linked as `css/style.css?v=N` and `js/script.js?v=N` (currently **v=25**; `en/` pages use `../css/...`). After editing `style.css` or `script.js`, **bump `N` in all 11 HTML files** (regex on `style.css?v=\d+` / `script.js?v=\d+`) or browsers serve stale assets. The map image is versioned separately (`images/schladming-map.jpg?v=…` in `ueber-uns.html`). Bump its query when the image is regenerated.

**3. Fonts are loaded per-page via `<link>` in each `<head>`** (not `@import`): Playfair Display (headings), Figtree (body), Poppins (logo wordmark only).

## Architecture

**Design system lives entirely in CSS custom properties** at the top of `css/style.css` (`:root`): color tokens (brand palette is ivory `--color-bg`, ink `--color-ink`, gold `--color-gold*`; plus `--color-logo-navy` sampled from the logo), a 4/8pt spacing scale, a type scale, elevation/radius, and motion tokens (`--ease-*`, `--dur-*`). Component styles are built from these tokens — prefer variables over raw hex. Sections alternate `.section` / `.section-alt` (cream) / `.section-ink` (dark).

**Visual style was deliberately "de-slopped" (2026-10) at the owner's request — keep it square and flat.** All radius tokens are `0` (square corners everywhere — no pills, no rounded cards/images). Buttons and CTAs use flat solid colors, never gradients. Section kickers (`.eyebrow`) are quiet sentence-case labels, not uppercase+gold-dash. Hover/entrance motion is restrained (no big translateY lifts, no gold glow shadows, subtle `[data-reveal]` fade). Do **not** reintroduce pill shapes, gradients, glow blobs, circular icon badges, or heavy hover effects — that is exactly the "AI slop" look that was removed. (The custom/crystal cursor in the hero is intentional and stays.)

**`js/script.js` is plain IIFEs, no modules**, split into clearly labelled blocks:
- Main IIFE: sticky-header scroll state, mobile full-screen nav toggle, active-nav highlighting (`a[data-nav]` vs current filename), scroll-reveal via one `IntersectionObserver` on `[data-reveal]` (with `[data-reveal-group]` for stagger), responsive hero-video handling, contact-form validation + Formspree submit, and the WhatsApp particle-burst button.
- `CUSTOM CURSOR — START/END`: dot + trailing ring cursor. Guarded by `(hover: hover) and (pointer: fine)` + `prefers-reduced-motion`.
- `CRYSTAL CURSOR TRAIL — START/END`: gold canvas particle trail, **scoped to the homepage hero only** (`.hero-has-video`). Toggle with `var CRYSTAL_ENABLED` (currently `true`). Same touch/reduced-motion guards.

All animation respects `prefers-reduced-motion`. CSS blocks that pair with a JS feature use matching `— START/END` comment markers so a feature can be removed cleanly.

**Logo is composed, not a single asset.** The supplied `logo.jpeg` has a white background, so the mountain mark was extracted to transparent PNGs — `images/logo-icon.png` (navy, header) and `images/logo-icon-gold.png` (gold, dark footer) — and the "AlpenGlanz / Hausservice" wordmark is rendered as **live Poppins text** (`.brand-name` + `<small>`), not baked into an image. Keep this split; don't revert to the raw JPEG (white box on dark backgrounds, blurry text).

**Hero video** (`index.html`) uses declarative responsive sources: `<source media="(max-width: 768px)">` loads `videos/hero-loop-mobile.mp4` (~0.7 MB), otherwise `videos/hero-loop.mp4` (2K, ~2.9 MB). `videos/hero-poster.jpg` is both the poster and the OG/Twitter preview image. JS re-asserts `muted`, retries autoplay on first gesture/visibility change, and pauses under reduced-motion.

**The area map is a pre-rendered static image**, not a live map. `images/schladming-map.jpg` was produced by stitching light CARTO Voyager `@2x` tiles centered on Schladming (47.3944, 13.6878, zoom 12) and baking in a gold location marker plus surrounding-village labels with Pillow. There is intentionally no Leaflet/JS map (removed to avoid runtime tile failures and scroll-hijacking). To change zoom/labels/marker, re-stitch and overwrite the JPG, then bump its `?v=` in `ueber-uns.html`.

## Pre-launch placeholders (intentionally unfinished)

- **Contact form is inert until configured:** `kontakt.html` still has `action="https://formspree.io/f/YOUR_FORM_ID"`. Until a real Formspree ID is set, submits show a friendly "email us instead" fallback (handled in `script.js`).
- **Domain assumed** `https://alpenglanz-hausservice.at/` in canonical + OG/Twitter tags across pages — change if the real domain differs.
- `datenschutz.html` is a template that should get a legal/GDPR review before going live.

See `README.md` for the deployment/launch checklist (in German).
