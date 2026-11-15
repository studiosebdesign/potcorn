# Pot'corn — le ciné qu'on choisit entre potes

Les séances près de chez toi en cartes à glisser, avec les bandes-annonces.
Garde tes films, envoie ta sélection à tes potes sur WhatsApp, et votez.

- `public/index.html` : le site (une seule page).
- `functions/api/seances.js` : fonction serveur pour **Cloudflare Pages**
  (mémoire KV reliée sous le nom `SEANCES`, variable facultative `TMDB_TOKEN`).
- `netlify/functions/seances.mjs` + `netlify.toml` : la même fonction pour Netlify.

La fonction récupère les séances sur AlloCiné, les garde en mémoire jusqu'au
lundi soir 23 h 59 (heure de Paris) et ajoute les bandes-annonces (TMDB).

Test : `/api/seances?cinema=B1139&debug=1`
