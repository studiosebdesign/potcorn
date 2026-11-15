/* =====================================================================
   Fonction serveur Cloudflare Pages : séances d'un cinéma
   Adresse : /api/seances?cinema=B1139   (ajouter &debug=1 pour tester)
   Réglages nécessaires dans Cloudflare :
   - un espace KV relié sous le nom SEANCES (la mémoire) ;
   - facultatif : la variable TMDB_TOKEN (bandes-annonces).

   Fonctionnement :
   1. Si le programme du cinéma est déjà en mémoire et encore valable,
      on le renvoie tout de suite (AlloCiné n'est pas contacté).
   2. Sinon on récupère sur AlloCiné les séances d'aujourd'hui à J+7,
      on ajoute les bandes-annonces (TMDB, si la clé est configurée),
      on garde le tout en mémoire et on le renvoie.

   Durée de validité de la mémoire :
   - jusqu'au lundi soir 23 h 59 (heure de Paris) ;
   - exception le mardi : tant que les séances du mercredi n'apparaissent
     pas encore, la mémoire ne vaut qu'une heure. Rien ne tourne tout seul :
     la vérification n'a lieu que si quelqu'un consulte ce cinéma.
   ===================================================================== */

const ALLO = 'https://www.allocine.fr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TZ = 'Europe/Paris';
const RECHECK_MS = 60 * 60 * 1000;   // le mardi, au plus une vérification par heure
const DAYS = 8;                      // aujourd'hui + 7 jours
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const CACHE_VERSION = 'v2';
// Offre gratuite Cloudflare : 50 appels externes maximum par visite. On en garde 4 de marge.
const BUDGET = 46;
const ALLO_MAX = 30;                       // part réservée à AlloCiné (8 jours + pages en plus)                // à changer si le format des données change

/* ---------- Dates à l'heure de Paris ---------- */
function parisDate(now = new Date(), addDays = 0) {
  const d = new Date(now.getTime() + addDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function parisDow(now = new Date()) {
  const w = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}
function parisOffset(dateStr) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).format(new Date(dateStr + 'T12:00:00Z'));
  const m = s.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : '+01:00';
}
function endOfMonday(now = new Date()) {
  const daysToMonday = (1 - parisDow(now) + 7) % 7;      // lundi -> 0 (ce soir)
  const monday = parisDate(now, daysToMonday);
  return Date.parse(`${monday}T23:59:59${parisOffset(monday)}`);
}
function computeExpiry(now, films) {
  if (parisDow(now) === 2) {                              // mardi
    const wednesday = parisDate(now, 1);
    const ready = films.some(f => f.s.some(x => x.d === wednesday));
    if (!ready) return now.getTime() + RECHECK_MS;
  }
  return endOfMonday(now);
}

/* ---------- Lecture des données AlloCiné ---------- */
function minutes(rt) {
  if (rt == null || rt === '') return 0;
  if (typeof rt === 'number') return rt > 600 ? Math.round(rt / 60) : rt;
  const s = String(rt);
  let m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (m && (m[1] || m[2])) return (+(m[1] || 0)) * 60 + (+(m[2] || 0));
  m = s.match(/(\d+)\s*h\s*(\d+)?/i);
  if (m) return (+m[1]) * 60 + (+(m[2] || 0));
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : (n > 600 ? Math.round(n / 60) : n);
}
// AlloCiné : original / original_st / original_sme = version originale sous-titrée,
// multiple / multiple_st / multiple_sme = version française.
function version(key, st) {
  const k = String(key).toLowerCase();
  const dv = String(st?.diffusionVersion || '').toUpperCase();
  if (k.startsWith('original') || dv.startsWith('ORIGINAL')) return 'VOST';
  return 'VF';
}
function bookingUrl(st) {
  const t = st?.data?.ticketing || st?.ticketing;
  if (!Array.isArray(t)) return null;
  const order = ['default', 'fr'];
  const sorted = [...t].sort((a, b) => {
    const ia = order.indexOf(a?.provider), ib = order.indexOf(b?.provider);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  for (const x of sorted) { const u = x?.urls?.[0] || x?.url; if (u && /^https:\/\//.test(u)) return u; }
  return null;
}
function parseResults(pages) {
  const films = new Map();
  for (const data of pages) {
    for (const res of (data?.results || [])) {
      const m = res?.movie || {};
      const key = String(m.internalId || m.id || m.title || '');
      if (!key) continue;
      let f = films.get(key);
      if (!f) {
        const genres = (m.genres || []).map(g => typeof g === 'string' ? g : (g?.translate || g?.name || g?.tag)).filter(Boolean);
        f = {
          id: key,
          t: m.title || m.originalTitle || 'Film',
          d: minutes(m.runtime),
          g: genres.slice(0, 2).join(', '),
          poster: m.poster?.url || m.poster?.path || null,
          sortie: m.releases?.[0]?.releaseDate?.date || null,
          allo: m.internalId ? `${ALLO}/film/fichefilm_gen_cfilm=${m.internalId}.html` : `${ALLO}/rechercher/?q=${encodeURIComponent(m.title || '')}`,
          s: []
        };
        films.set(key, f);
      }
      const groups = res?.showtimes || {};
      for (const [gk, arr] of Object.entries(groups)) {
        if (!Array.isArray(arr)) continue;
        for (const st of arr) {
          const at = st?.startsAt; if (!at || at.length < 16) continue;
          f.s.push({ d: at.slice(0, 10), h: at.slice(11, 16), v: version(gk, st), book: bookingUrl(st), ap: st?.isPreview === true });
        }
      }
    }
  }
  const out = [...films.values()].map(f => {
    const seen = new Set();
    f.s = f.s.filter(x => { const k = x.d + x.h + x.v; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a.d + a.h).localeCompare(b.d + b.h));
    return f;
  }).filter(f => f.s.length);
  return out;
}

/* ---------- Appels réseau ---------- */
async function get(url, headers = {}, ms = 7000, ctx = null) {
  if (ctx) { if (ctx.used >= BUDGET) throw new Error('budget'); ctx.used++; }
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { headers, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
function alloHeaders(id) {
  return {
    'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9', 'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${ALLO}/seance/salle_gen_csalle=${id}.html`
  };
}
async function fetchDay(id, date, ctx) {
  const base = `${ALLO}/_/showtimes/theater-${id}/d-${date}/`;
  const r = await get(base, alloHeaders(id), 7000, ctx);
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.includes('json')) {
    const text = (await r.text()).slice(0, 300);
    const err = new Error(`AlloCiné ${r.status} (${type}) pour ${date}`); err.info = { url: base, status: r.status, type, debut: text }; throw err;
  }
  const first = await r.json();
  const pages = [first];
  const total = Math.min(Number(first?.pagination?.totalPages || 1), 5);
  for (let p = 2; p <= total; p++) {
    if (ctx.used >= ALLO_MAX) break;
    const rp = await get(`${base}p-${p}/`, alloHeaders(id), 7000, ctx);
    if (rp.ok) pages.push(await rp.json());
  }
  return { date, url: base, status: r.status, pages };
}

/* ---------- Bandes-annonces TMDB (facultatif) ---------- */
function tmdbRequest(path, token, params = {}, ctx = null) {
  const u = new URL('https://api.themoviedb.org/3' + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (token.length > 40) headers.Authorization = 'Bearer ' + token; else u.searchParams.set('api_key', token);
  return get(u.toString(), headers, 6000, ctx).then(r => r.ok ? r.json() : null);
}
function pickTrailer(list) {
  const yt = (list || []).filter(v => v.site === 'YouTube' && v.key);
  return (yt.find(v => v.type === 'Trailer' && v.official) || yt.find(v => v.type === 'Trailer') || yt.find(v => v.type === 'Teaser') || yt[0] || null)?.key || null;
}
// Cherche la bande-annonce d'un film (3 appels TMDB au plus). Renvoie null si le budget
// d'appels de cette visite est épuisé : le film sera traité à la visite suivante.
async function tmdbFor(f, token, store, ctx) {
  const key = 'film2-' + f.id;   // « film2 » : ignore les recherches ratées enregistrées par l'ancienne version
  if (store) { const c = await store.get(key).catch(() => null); if (c && Date.now() - c.at < 7 * 86400000) return c; }
  try {
    const year = f.sortie ? String(f.sortie).slice(0, 4) : '';
    let found = await tmdbRequest('/search/movie', token, { query: f.t, language: 'fr-FR', region: 'FR', include_adult: 'false', primary_release_year: year }, ctx);
    if (!found?.results?.length && year) found = await tmdbRequest('/search/movie', token, { query: f.t, language: 'fr-FR', include_adult: 'false' }, ctx);
    const m = found?.results?.[0];
    const info = { at: Date.now(), yt: null, backdrop: null, poster: null };
    if (m) {
      info.backdrop = m.backdrop_path ? TMDB_IMG + 'w780' + m.backdrop_path : null;
      info.poster = m.poster_path ? TMDB_IMG + 'w500' + m.poster_path : null;
      const fr = await tmdbRequest(`/movie/${m.id}/videos`, token, { language: 'fr-FR' }, ctx);
      info.yt = pickTrailer(fr?.results);
      if (!info.yt) { const en = await tmdbRequest(`/movie/${m.id}/videos`, token, { language: 'en-US' }, ctx); info.yt = pickTrailer(en?.results); }
    }
    if (store) await store.setJSON(key, info).catch(() => {});
    return info;
  } catch (e) { return null; }   // budget épuisé ou TMDB indisponible
}
// Ajoute les bandes-annonces aux films qui n'en ont pas encore été cherchées, tant que le budget le permet.
async function enrich(films, token, store, ctx) {
  const todo = films.filter(f => !f.tmdbDone);
  while (todo.length) {
    const size = Math.min(5, Math.floor((BUDGET - ctx.used) / 3), todo.length);
    if (size < 1) break;
    const batch = todo.splice(0, size);
    const infos = await Promise.all(batch.map(f => tmdbFor(f, token, store, ctx)));
    batch.forEach((f, i) => {
      const info = infos[i]; if (!info) return;
      f.yt = info.yt || null; f.backdrop = info.backdrop || null; f.poster = f.poster || info.poster || null; f.tmdbDone = true;
    });
    if (infos.some(x => !x)) break;
  }
  return films;
}

/* ---------- Réponse ---------- */
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
// Mémoire Cloudflare KV, présentée comme le stockage Netlify (get / setJSON)
function kvStore(env, prefix) {
  const ns = env && env.SEANCES;
  if (!ns) return null;
  return {
    get: (k) => ns.get(prefix + k, 'json'),
    setJSON: (k, v, ttlSec) => ns.put(prefix + k, JSON.stringify(v), { expirationTtl: Math.max(60, Math.round(ttlSec || 8 * 86400)) })
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('cinema') || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]{3,6}$/.test(id)) return json({ error: 'Identifiant de cinéma invalide' }, 400);
  const debug = url.searchParams.get('debug') === '1';
  const now = new Date();
  const store = kvStore(env, 'seances-');
  const key = `${id}-${CACHE_VERSION}`;

  const ctx = { used: 0 };
  const token = env.TMDB_TOKEN;
  if (store && !debug) {
    const c = await store.get(key).catch(() => null);
    if (c && c.expires > now.getTime()) {
      // Programme en mémoire : s'il manque encore des bandes-annonces, on continue à les chercher
      // (sans recontacter AlloCiné), puis on met la mémoire à jour.
      if (token && c.films.some(f => !f.tmdbDone)) {
        await enrich(c.films, token, kvStore(env, 'tmdb-'), ctx);
        c.pending = c.films.some(f => !f.tmdbDone); c.tmdb = !c.pending;
        await store.setJSON(key, c, (c.expires - now.getTime()) / 1000 + 7 * 86400).catch(() => {});
        return json({ ...c, fromCache: true });
      }
      return json({ ...c, fromCache: true });
    }
  }

  try {
    const dates = [...Array(DAYS)].map((_, i) => parisDate(now, i));
    const days = await Promise.all(dates.map(d => fetchDay(id, d, ctx)));
    let films = parseResults(days.flatMap(x => x.pages));

    if (debug) {
      const p0 = days[0].pages[0] || {};
      const r0 = (p0.results || [])[0] || {};
      return json({
        test: 'OK — AlloCiné répond',
        hebergeur: 'Cloudflare',
        memoire: store ? 'KV SEANCES reliée' : 'KV SEANCES absente (à relier dans les réglages)',
        jours: days.map(x => ({ date: x.date, statut: x.status, films: (x.pages[0]?.results || []).length })),
        cles_film: Object.keys(r0.movie || {}),
        cles_seances: Object.keys(r0.showtimes || {}),
        films_lus: films.length,
        premier_film: films[0] || null,
        tmdb: env.TMDB_TOKEN ? 'clé présente' : 'pas de clé',
        appels_utilises: ctx.used + ' / 50'
      });
    }

    if (token && films.length) films = await enrich(films, token, kvStore(env, 'tmdb-'), ctx);
    const pending = !!token && films.some(f => !f.tmdbDone);
    const theater = days.flatMap(x => x.pages).find(p => p?.theater?.name)?.theater?.name || null;
    const payload = { cinema: id, theater, fetchedAt: now.toISOString(), expires: computeExpiry(now, films), tmdb: !!token && !pending, pending, films };
    // gardé en mémoire 7 jours de plus que sa validité, pour servir de secours si AlloCiné ne répond pas
    if (store) await store.setJSON(key, payload, (payload.expires - now.getTime()) / 1000 + 7 * 86400).catch(() => {});
    return json(payload);
  } catch (e) {
    if (debug) return json({ test: 'ÉCHEC', hebergeur: 'Cloudflare', erreur: String(e.message || e), details: e.info || null }, 502);
    if (store) {
      const c = await store.get(key).catch(() => null);
      if (c) return json({ ...c, fromCache: true, stale: true });
    }
    return json({ error: 'AlloCiné ne répond pas pour le moment.' }, 502);
  }
}
