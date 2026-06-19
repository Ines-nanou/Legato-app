# Générateur de contrats Legato SA — Guide de mise en ligne

Ce dossier contient une application web complète. Le directeur de travaux dépose un devis PDF, et l'application génère automatiquement un PDF complet : page de garde + contrat d'entreprise (×2) + conditions générales Legato + devis original (×2), prêt à imprimer.

Suis ces étapes dans l'ordre. Compte 30 à 40 minutes la première fois.

---

## CE QU'IL TE FAUT AVANT DE COMMENCER

1. Une clé API Anthropic (créée sur console.anthropic.com — voir Étape A)
2. Un compte Vercel gratuit (voir Étape C)
3. Ce dossier de fichiers (que Claude t'a fourni)

---

## ÉTAPE A — Créer ta clé API Anthropic (15 min)

1. Va sur **console.anthropic.com** et crée un compte (ou connecte-toi).
2. Dans le menu, ouvre **Billing** (Facturation) et ajoute un moyen de paiement, puis mets un petit crédit (5 à 10 CHF suffisent pour des mois).
3. Ouvre **API Keys**, clique **Create Key**, donne-lui un nom (ex : "Legato contrats").
4. **Copie la clé immédiatement** (elle commence par `sk-ant-...`) et garde-la dans un endroit sûr. Tu ne pourras plus la revoir ensuite.

⚠️ Ne partage JAMAIS cette clé. Elle ne sera mise QUE sur Vercel (jamais dans un email, jamais dans le code visible).

---

## ÉTAPE B — Préparer le dossier

Tu as ce dossier `legato-app` avec, à l'intérieur :
- `api/generer.js` — le moteur (extraction IA + génération + fusion PDF)
- `public/index.html` — la page que verront les directeurs de travaux
- `assets/conditions_generales.pdf` — tes CG (déjà intégrées)
- `package.json`, `vercel.json` — la configuration

Tu n'as RIEN à modifier dans ces fichiers.

---

## ÉTAPE C — Mettre en ligne sur Vercel (15 min)

La méthode la plus simple, sans rien installer sur ton ordinateur :

### C.1 — Crée un compte Vercel
1. Va sur **vercel.com**, clique **Sign Up**.
2. Le plus simple : inscris-toi avec ton email ou un compte GitHub.

### C.2 — Importe le projet
Option simple (glisser-déposer) :
1. Sur le tableau de bord Vercel, cherche l'option **"Deploy"** ou installe l'outil en ligne de commande (voir C.3 si tu préfères).
2. Si tu as un compte GitHub : dépose le dossier `legato-app` dans un nouveau dépôt GitHub, puis sur Vercel clique **Add New → Project → Import** ton dépôt.

### C.3 — Méthode ligne de commande (alternative, si à l'aise)
Sur ton Mac, ouvre le Terminal et tape :
```
npm install -g vercel
cd chemin/vers/legato-app
vercel
```
Suis les questions (login, nom du projet). À la fin, Vercel te donne un lien.

### C.4 — Ajoute ta clé API (CRUCIAL)
1. Dans Vercel, ouvre ton projet → **Settings → Environment Variables**.
2. Crée une variable :
   - **Name** : `ANTHROPIC_API_KEY`
   - **Value** : colle ta clé `sk-ant-...`
3. Sauvegarde, puis va dans **Deployments** et clique **Redeploy** (pour que la clé soit prise en compte).

---

## ÉTAPE D — Tester

1. Ouvre le lien que Vercel t'a donné (ex : `legato-contrats.vercel.app`).
2. Dépose un devis PDF, clique **Générer le contrat**.
3. Le PDF complet se télécharge. Vérifie les montants et la mise en page.

---

## ÉTAPE E — Partager

Donne simplement le lien Vercel à tes directeurs de travaux. Ils ouvrent, déposent, impriment. C'est tout.

---

## COÛT

- Vercel : gratuit pour cet usage.
- API Anthropic : quelques centimes par contrat généré. Ton crédit de 5-10 CHF dure très longtemps.

## EN CAS DE PROBLÈME

- "Erreur serveur" → vérifie que la variable `ANTHROPIC_API_KEY` est bien configurée et que tu as redéployé.
- Devis non lu → assure-toi que le PDF contient du texte (pas un scan image pur).
- Besoin d'ajuster un texte du contrat → c'est dans `api/generer.js`, Claude peut te guider.
