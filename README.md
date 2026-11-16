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

## Mise à jour : cinémas de toute la France
- `functions/api/cinemas.js` : recherche de cinémas (`/api/cinemas?q=…`), cinémas d'un département avec leur position (`?dep=91`, pour « Près de moi ») ou d'une ville AlloCiné (`?ville=…`). Listes gardées 30 jours dans la mémoire KV.
- `functions/api/seances.js` : si TMDB ne trouve pas de bande-annonce, recherche YouTube « titre bande annonce année » quand la variable secrète `YOUTUBE_KEY` est réglée (facultatif).
- `public/manifest.webmanifest` et `public/icons/` : Pot'corn s'installe sur l'écran d'accueil.
- `public/confidentialite.html` : page de confidentialité.
- `public/og-image.jpg` : l'image d'aperçu affichée quand on partage un lien Pot'corn (WhatsApp, Messenger…).
