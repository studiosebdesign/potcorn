/* =====================================================================
   POT'CORN – CONFIGURATION FIREBASE (mode « Choisir entre potes »)

   Remplace la ligne « const firebaseConfig = null; » ci-dessous par le bloc
   donné par Firebase, qui commence par « const firebaseConfig = { »
   et finit par « }; ». Ne colle pas les lignes « import … » ni
   « const app = initializeApp(… ) » : seulement ce bloc.

   Ces informations ne sont pas secrètes : elles servent juste à dire au
   site quel projet Firebase utiliser. La protection vient des règles
   Firestore et des domaines autorisés.
   ===================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyB721WlQnZcDlwji_5FqTb5UXIbhiYLNVI",
  authDomain: "potcorn.firebaseapp.com",
  projectId: "potcorn",
  storageBucket: "potcorn.firebasestorage.app",
  messagingSenderId: "1083825272670",
  appId: "1:1083825272670:web:342d0f4bd55772ac1681cf",
  measurementId: "G-35X55FTC53"
};