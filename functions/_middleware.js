/**
 * Cloudflare Pages Middleware — setzt die im CMS gepflegten Inhalte ein.
 *
 * Läuft vor jeder Auslieferung. Holt die gespeicherten Änderungen der
 * angeforderten Seite aus dem KV und schreibt sie per HTMLRewriter in das
 * HTML, bevor es beim Besucher ankommt. Dadurch steht der geänderte Text
 * sofort im Quelltext und nicht erst nach einem Nachladen per JavaScript.
 *
 * Die statischen .html-Dateien bleiben unverändert. Sie sind weiterhin der
 * Ausgangsstand; im KV liegt nur, was der Kunde tatsächlich geändert hat.
 *
 * Sicherheitsnetz: Fehlt die KV-Bindung oder geht beim Einsetzen etwas
 * schief, wird die Originalantwort unverändert ausgeliefert. Die Seite kann
 * durch dieses Skript also nicht ausfallen.
 *
 * Bewusst ohne gemeinsames Hilfsmodul: alles unter functions/ wird von Pages
 * zu einer Route. Ein importiertes Modul würde also einen zusätzlichen,
 * kaputten Pfad erzeugen. Die paar geteilten Zeilen stehen daher doppelt.
 */

/** Name der KV-Bindung im Cloudflare-Dashboard. */
const KV_BINDING = 'CMS';

/** Pfade, die nie umgeschrieben werden. */
function isExcluded(pathname) {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/cms-media/')
  );
}

/**
 * Übersetzt den aufgerufenen Pfad in den Dateinamen der Seite.
 *   /              -> index.html
 *   /leistungen    -> leistungen.html
 *   /en/           -> en/index.html
 *   /en/contact    -> en/contact.html
 */
function pageKeyFromPath(pathname) {
  let p = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p === '') p = 'index';
  if (p.toLowerCase().endsWith('.html')) p = p.slice(0, -5);
  if (p.endsWith('/index')) p = p.slice(0, -6) + '/index';
  return p + '.html';
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const response = await next();

  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return response;

    const url = new URL(request.url);
    if (isExcluded(url.pathname)) return response;

    // Nur fertige HTML-Seiten. Weiterleitungen (308 auf die saubere URL)
    // und Fehlerseiten laufen hier unverändert durch.
    if (response.status !== 200) return response;
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('text/html')) return response;

    const kv = env[KV_BINDING];
    if (!kv) return response; // CMS noch nicht eingerichtet → Seite bleibt wie sie ist

    const data = await kv.get('page:' + pageKeyFromPath(url.pathname), { type: 'json' });
    if (!data) return response; // nichts geändert → nichts einzusetzen

    const texts = data.texts || {};
    const images = data.images || {};
    const meta = data.meta || {};

    const hasTexts = Object.keys(texts).length > 0;
    const hasImages = Object.keys(images).length > 0;
    const hasMeta = Boolean(meta.title || meta.description);
    if (!hasTexts && !hasImages && !hasMeta) return response;

    let rewriter = new HTMLRewriter();

    if (hasTexts) {
      rewriter = rewriter.on('[data-cms]', {
        element(el) {
          const value = texts[el.getAttribute('data-cms')];
          if (typeof value === 'string') el.setInnerContent(value, { html: true });
        },
      });
    }

    if (hasImages) {
      rewriter = rewriter.on('[data-cms-img]', {
        element(el) {
          const img = images[el.getAttribute('data-cms-img')];
          if (!img || !img.src) return;
          el.setAttribute('src', img.src);
          if (img.alt) el.setAttribute('alt', img.alt);
          // Die Maße des Originals passen nicht mehr. Sind die neuen bekannt,
          // werden sie gesetzt, sonst müssen die alten weg: ein falsches
          // Seitenverhältnis verzerrt das Bild sichtbar.
          if (img.width && img.height) {
            el.setAttribute('width', String(img.width));
            el.setAttribute('height', String(img.height));
          } else {
            el.removeAttribute('width');
            el.removeAttribute('height');
          }
          // Ein ausgetauschtes Bild hat andere Maße als das Original.
          // Ein stehengebliebenes srcset würde weiter die alte Datei laden.
          el.removeAttribute('srcset');
        },
      });
    }

    if (hasMeta) {
      if (meta.title) {
        rewriter = rewriter
          .on('title', {
            element(el) {
              el.setInnerContent(meta.title);
            },
          })
          .on('meta[property="og:title"], meta[name="twitter:title"]', {
            element(el) {
              el.setAttribute('content', meta.title);
            },
          });
      }
      if (meta.description) {
        rewriter = rewriter.on(
          'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]',
          {
            element(el) {
              el.setAttribute('content', meta.description);
            },
          }
        );
      }
    }

    return rewriter.transform(response);
  } catch (err) {
    // Im Zweifel lieber die Originalseite als eine kaputte Seite.
    return response;
  }
}
