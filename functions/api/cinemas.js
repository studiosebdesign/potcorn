/* =====================================================================
   POT'CORN – recherche de cinémas (Cloudflare Pages Function)
   /api/cinemas?q=evry        → recherche AlloCiné (cinémas et villes) par nom, ville ou code postal
   /api/cinemas?dep=91        → tous les cinémas d'un département, avec leur position (pour « Près de moi »)
   /api/cinemas?ville=115755  → tous les cinémas d'une ville AlloCiné, avec leur position
   Les listes sont gardées 30 jours dans la mémoire KV (SEANCES) : AlloCiné n'est contacté
   qu'une fois par mois et par département.
   Positions : service public de géocodage de l'IGN (Géoplateforme), gratuit et sans clé.
   ===================================================================== */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LIST_TTL = 30 * 86400;   // listes de cinémas : 30 jours
const SEARCH_TTL = 7 * 86400;  // recherches : 7 jours
const VERSION = 'v1';

/* Pages AlloCiné de chaque département (code INSEE → pages « salle/cinema/… »).
   Paris, Lyon et Marseille ont aussi leur page « ville ». Correspondance reprise du projet libre Cinemap (licence MIT). */
const DEPS = {
  '01': ['departement-83191'], '02': ['departement-83178'], '03': ['departement-83111'], '04': ['departement-83185'],
  '05': ['departement-83186'], '06': ['departement-83187'], '07': ['departement-83192'], '08': ['departement-83129'],
  '09': ['departement-83150'], '10': ['departement-83130'], '11': ['departement-83138'], '12': ['departement-83151'],
  '13': ['departement-83188', 'ville-87914'], '14': ['departement-83160'], '15': ['departement-83112'], '16': ['departement-83181'],
  '17': ['departement-83182'], '18': ['departement-83123'], '19': ['departement-83143'], '2A': ['departement-265496'],
  '2B': ['departement-83133'], '21': ['departement-83115'], '22': ['departement-83119'], '23': ['departement-83144'],
  '24': ['departement-83106'], '25': ['departement-83134'], '26': ['departement-83193'], '27': ['departement-83163'],
  '28': ['departement-83124'], '29': ['departement-83120'], '30': ['departement-83139'], '31': ['departement-83152'],
  '32': ['departement-83153'], '33': ['departement-83107'], '34': ['departement-83140'], '35': ['departement-83121'],
  '36': ['departement-83125'], '37': ['departement-83126'], '38': ['departement-83194'], '39': ['departement-83135'],
  '40': ['departement-83108'], '41': ['departement-83127'], '42': ['departement-83195'], '43': ['departement-83113'],
  '44': ['departement-83173'], '45': ['departement-83128'], '46': ['departement-83154'], '47': ['departement-83109'],
  '48': ['departement-83141'], '49': ['departement-83174'], '50': ['departement-83161'], '51': ['departement-83131'],
  '52': ['departement-83132'], '53': ['departement-83175'], '54': ['departement-83146'], '55': ['departement-83147'],
  '56': ['departement-83122'], '57': ['departement-83148'], '58': ['departement-83116'], '59': ['departement-83158'],
  '60': ['departement-83179'], '61': ['departement-83162'], '62': ['departement-83159'], '63': ['departement-83114'],
  '64': ['departement-83110'], '65': ['departement-83155'], '66': ['departement-83142'], '67': ['departement-83104'],
  '68': ['departement-83105'], '69': ['departement-83196', 'ville-113315'], '70': ['departement-83136'], '71': ['departement-83117'],
  '72': ['departement-83176'], '73': ['departement-83197'], '74': ['departement-83198'], '75': ['ville-115755'],
  '76': ['departement-83164'], '77': ['departement-83166'], '78': ['departement-83167'], '79': ['departement-83183'],
  '80': ['departement-83180'], '81': ['departement-83156'], '82': ['departement-83157'], '83': ['departement-83189'],
  '84': ['departement-83190'], '85': ['departement-83177'], '86': ['departement-83184'], '87': ['departement-83145'],
  '88': ['departement-83149'], '89': ['departement-83118'], '90': ['departement-83137'], '91': ['departement-83168'],
  '92': ['departement-83169'], '93': ['departement-83170'], '94': ['departement-83171'], '95': ['departement-83172'],
  '971': ['departement-83199'], '972': ['departement-83200'], '973': ['departement-83201'], '974': ['departement-83202']
};

const json = (obj, status = 200, maxAge = 0) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' }
});
const decode = s => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
async function fetchWithTimeout(url, opts = {}, ms = 9000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}
const alloHeaders = { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', Referer: 'https://www.allocine.fr/salle/' };

/* ----- Une page de liste AlloCiné → cinémas ----- */
function parseListing(html) {
  const out = [];
  for (const chunk of html.split(/class="theater-card[\s"]/).slice(1)) {
    const m = chunk.match(/data-theater="([^"]+)"/); if (!m) continue;
    let d; try { d = JSON.parse(decode(m[1])); } catch (e) { continue; }
    if (!d || !d.id) continue;
    const a = chunk.match(/<address[^>]*>([\s\S]*?)<\/address>/);
    const addr = a ? decode(a[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
    const am = addr.match(/^(.*?)\s*(\d{5})\s+(.+)$/);
    const sc = chunk.match(/screen-number">\s*(\d+)\s*[Ss]alle/);
    out.push({ id: String(d.id), name: String(d.name || '').trim(), address: am ? am[1].trim() : addr, zip: am ? am[2] : '', city: am ? am[3].trim() : '', screens: sc ? Number(sc[1]) : null });
  }
  return out;
}
const pageCount = html => { let n = 1; for (const m of html.matchAll(/[?&]page=(\d+)/g)) n = Math.max(n, Number(m[1])); return Math.min(n, 20); };
async function fetchListing(path) {
  const url = `https://www.allocine.fr/salle/cinema/${path}/`;
  const first = await fetchWithTimeout(url, { headers: alloHeaders });
  if (!first.ok) throw new Error(`AlloCiné ${first.status} pour ${path}`);
  const html = await first.text();
  let list = parseListing(html);
  const pages = pageCount(html);
  for (let p = 2; p <= pages; p += 4) {   // pages suivantes, 4 à la fois
    const batch = [];
    for (let q = p; q < p + 4 && q <= pages; q++) batch.push(fetchWithTimeout(`${url}?page=${q}`, { headers: alloHeaders }).then(r => r.ok ? r.text() : '').catch(() => ''));
    for (const h of await Promise.all(batch)) list = list.concat(parseListing(h));
  }
  return list;
}

/* ----- Positions (géocodage IGN par lot) ----- */
function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const csvCell = s => '"' + String(s || '').replace(/"/g, '""') + '"';
async function geocode(items) {   // items : [{ id, adresse, postcode }] → { id: [lat, lon] }
  if (!items.length) return {};
  const csv = 'id,adresse,postcode\n' + items.map(x => [x.id, x.adresse, x.postcode].map(csvCell).join(',')).join('\n') + '\n';
  const form = new FormData();
  form.append('data', new Blob([csv], { type: 'text/csv' }), 'cinemas.csv');
  form.append('columns', 'adresse');
  form.append('postcode', 'postcode');
  const r = await fetchWithTimeout('https://data.geopf.fr/geocodage/search/csv', { method: 'POST', body: form }, 15000);
  if (!r.ok) return {};
  const rows = csvRows(await r.text()); const head = rows.shift() || [];
  const col = n => head.indexOf(n);
  const iId = col('id'), iLat = col('latitude'), iLon = col('longitude'), iSt = col('result_status'), iSc = col('result_score');
  const out = {};
  for (const row of rows) {
    const lat = parseFloat(row[iLat]), lon = parseFloat(row[iLon]);
    if (row[iSt] === 'ok' && !isNaN(lat) && !isNaN(lon) && (iSc < 0 || parseFloat(row[iSc]) >= 0.35)) out[row[iId]] = [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
  }
  return out;
}
async function withPositions(list) {
  const pos = await geocode(list.map(c => ({ id: c.id, adresse: [c.address, c.zip, c.city].filter(Boolean).join(' '), postcode: c.zip })));
  // Adresse introuvable : on se contente du centre de la commune
  const miss = list.filter(c => !pos[c.id] && (c.zip || c.city));
  Object.assign(pos, await geocode(miss.map(c => ({ id: c.id, adresse: `${c.zip} ${c.city}`.trim(), postcode: c.zip }))));
  return list.map(c => pos[c.id] ? { ...c, lat: pos[c.id][0], lon: pos[c.id][1] } : c);
}
function dedupe(list) { const seen = new Set(); return list.filter(c => !seen.has(c.id) && seen.add(c.id)); }

function kv(env) {
  const ns = env && env.SEANCES; if (!ns) return null;
  return {
    get: k => ns.get('cinemas-' + k, 'json').catch(() => null),
    put: (k, v, ttl) => ns.put('cinemas-' + k, JSON.stringify(v), { expirationTtl: ttl }).catch(() => {})
  };
}
async function cached(env, key, ttl, build) {
  const store = kv(env);
  if (store) { const c = await store.get(key); if (c) return { ...c, fromCache: true }; }
  const v = await build();
  if (store && v && (v.cinemas ? v.cinemas.length : true)) await store.put(key, v, ttl);
  return v;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const dep = (url.searchParams.get('dep') || '').toUpperCase().trim();
  const ville = (url.searchParams.get('ville') || '').trim();
  try {
    if (dep) {
      const paths = DEPS[dep];
      if (!paths) return json({ error: 'Département inconnu' }, 400);
      const v = await cached(env, `dep-${dep}-${VERSION}`, LIST_TTL, async () => {
        let list = [];
        for (const p of paths) list = list.concat(await fetchListing(p));
        return { dep, cinemas: await withPositions(dedupe(list)) };
      });
      return json(v, 200, 3600);
    }
    if (ville) {
      if (!/^\d{3,7}$/.test(ville)) return json({ error: 'Ville inconnue' }, 400);
      const v = await cached(env, `ville-${ville}-${VERSION}`, LIST_TTL, async () => ({ ville, cinemas: await withPositions(dedupe(await fetchListing('ville-' + ville))) }));
      return json(v, 200, 3600);
    }
    if (q.length >= 2 && q.length <= 50) {
      const norm = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
      if (norm.length < 2) return json({ cities: [], theaters: [] });
      const v = await cached(env, `q-${norm}`, SEARCH_TTL, async () => {
        const r = await fetchWithTimeout(`https://www.allocine.fr/_/localization_city/${encodeURIComponent(norm)}`, { headers: { ...alloHeaders, Accept: 'application/json' } });
        if (!r.ok) throw new Error('AlloCiné ' + r.status);
        const j = await r.json();
        const vals = (j && j.values) || {};
        return {
          cities: (vals.cities || []).map(x => x.node || x).filter(x => x && x.id).slice(0, 8).map(x => ({ id: String(x.id), name: x.name, zip: x.zip || '' })),
          theaters: (vals.theaters || []).map(x => x.node || x).filter(x => x && x.internalId).slice(0, 25)
            .map(x => ({ id: x.internalId, name: x.name, zip: (x.location && x.location.zip) || '', city: (x.location && x.location.city) || '' }))
        };
      });
      return json(v, 200, 3600);
    }
    return json({ error: 'Paramètre manquant : q, dep ou ville' }, 400);
  } catch (e) {
    return json({ error: 'AlloCiné ne répond pas pour le moment.', detail: String(e.message || e) }, 502);
  }
}
