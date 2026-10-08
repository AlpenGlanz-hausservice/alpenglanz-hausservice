/**
 * Liefert die im CMS hochgeladenen Bilder aus dem KV aus.
 * Endpoint: GET /cms-media/<dateiname>
 *
 * Hochgeladene Dateien bekommen beim Speichern einen eindeutigen Namen und
 * werden nie überschrieben. Deshalb dürfen sie dauerhaft gecacht werden.
 * Tauscht der Kunde ein Bild aus, entsteht ein neuer Name und damit eine
 * neue URL — der alte Cache steht dem also nie im Weg.
 */

const KV_BINDING = 'CMS';

const TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function onRequestGet({ params, env }) {
  const kv = env[KV_BINDING];
  if (!kv) return new Response('Not found', { status: 404 });

  // [[key]] liefert die Pfadsegmente. Unterordner gibt es hier nicht.
  const raw = Array.isArray(params.key) ? params.key.join('/') : String(params.key || '');
  const name = raw.split('/').pop() || '';

  // Nur die selbst vergebenen Namen zulassen: Kleinbuchstaben, Ziffern,
  // Bindestrich, eine Endung. Damit sind Pfad-Tricks ausgeschlossen.
  if (!/^[a-z0-9-]{1,64}\.(jpg|jpeg|png|webp)$/.test(name)) {
    return new Response('Not found', { status: 404 });
  }

  const data = await kv.get('media:' + name, { type: 'arrayBuffer' });
  if (!data) return new Response('Not found', { status: 404 });

  const ext = name.split('.').pop();
  return new Response(data, {
    headers: {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
