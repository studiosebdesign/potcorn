# Pot'corn — le ciné qu'on choisit entre potes

Les séances près de chez toi en cartes à glisser, avec les bandes-annonces.
Garde tes films, envoie ta sélection à tes potes sur WhatsApp, et votez.

- `public/index.html` : le site (une seule page).
- `netlify/functions/seances.mjs` : la fonction serveur qui récupère les séances
  sur AlloCiné, les garde en mémoire jusqu'au lundi soir et ajoute les
  bandes-annonces (TMDB).
- `netlify.toml` et `package.json` : réglages pour Netlify.

Test de la fonction : `/api/seances?cinema=B1139&debug=1`
