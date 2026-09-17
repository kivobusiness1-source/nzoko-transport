# 🚌 NZOKO TRANSPORT — Plateforme de gestion de transport interurbain

Application complète de réservation et de gestion de bus au **Congo-Brazzaville** :
réservation en ligne, paiement **MTN Mobile Money** (API officielle), billets QR,
espaces agents / contrôleurs / chauffeurs / comptabilité, assistant IA, PWA.

## 🚀 Installation locale (mode production)

**Prérequis : [Bun](https://bun.sh) ≥ 1.1** (`curl -fsSL https://bun.sh/install | bash`)

```bash
# 1. Installer les dépendances
bun install

# 2. Créer votre configuration (AUCUN secret n'est fourni dans cette archive)
cp .env.example .env
#   → Éditez .env : WEBHOOK_SECRET (openssl rand -hex 32), clés MOMO_* si activées

# 3. Créer la base + les données opérationnelles initiales
bun run db:push
bun prisma/seed.ts

# 4. Démarrer
bun run dev          # développement, http://localhost:3000
# ou en production :
bun run build && bun run start
```

## 👥 Comptes initiaux (⚠️ changez les mots de passe dès la 1re connexion)

| Compte | Mot de passe | Rôle |
|---|---|---|
| superadmin@nzoko.cg | Nzoko@2026! | Super admin |
| admin@nzoko.cg | Admin@2026! | Administrateur |
| manager.pn@nzoko.cg | Manager@2026! | Resp. agence Pointe-Noire |
| agent.pn@nzoko.cg | Agent@2026! | Agent de guichet |
| checker.pn@nzoko.cg | Checker@2026! | Contrôleur embarquement |
| comptable@nzoko.cg | Compta@2026! | Comptable |
| chauffeur.jean@nzoko.cg | Chauffeur@2026! | Chauffeur |
| support@nzoko.cg | Support@2026! | Support client |

## 💳 Paiements MTN Mobile Money

La collecte (paiement des billets) et l'envoi de fonds (remboursements) utilisent
l'**API officielle MTN MoMo**. Sans clés configurées, l'application répond une
erreur explicite (503) — aucun paiement simulé.

➡️ **Guide d'obtention et de configuration des clés : [README-MOMO.md](./README-MOMO.md)**

## 🤖 Assistant IA

Réponses aux questions clients (horaires, tarifs, promotions) **uniquement à
partir des données réelles de la base** (anti-hallucination).
➡️ **[README-ASSISTANT.md](./README-ASSISTANT.md)**

## 📣 Annulation de voyage & information des passagers

Quand un voyage est annulé (menu Voyages → Annuler), la plateforme :
- annule les réservations en attente et libère les sièges ;
- ouvre automatiquement la **liste des passagers à prévenir** : message
  **WhatsApp pré-rempli** (wa.me, personnalisé : trajet, siège, remboursement),
  bouton d'appel (`tel:`) et **message de diffusion** copiable pour les groupes ;
- met en avant les **remboursements à traiter** (billets payés) pour relance
  MoMo (cf. README-MOMO.md) ; l'accès aux téléphones est journalisé (audit).

## 🛡️ Sécurité incluse

- Sessions opaques HttpOnly + `__Host-` cookies, bcrypt cost 12
- **CSP à nonces** : un nonce aléatoire par requête (`src/proxy.ts`) marque
  chaque script — en production `script-src 'nonce-…' 'strict-dynamic'`
  (aucun script inline non-autorisé n'est exécutable) ; en développement seul
  `'unsafe-eval'` est ajouté (HMR de Next.js). La CSP vit UNIQUEMENT dans
  `src/proxy.ts` (ne la dupliquez jamais dans `next.config.ts`).
- 7 autres en-têtes de sécurité HTTP (HSTS, X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy, COOP…) — la caméra est autorisée
  (`camera=(self)`) pour le scanner QR des contrôleurs
- Rate limiting sur toutes les routes sensibles (publiques et admin)
- CSRF sur les mutations (header `x-requested-with: nzoko`)
- Webhooks signés HMAC + re-vérification systématique côté MTN
- Journalisation audit/sécurité
- **Zéro secret dans cette archive** : toutes les clés restent dans votre `.env`
- **Gardes-fous qualité armés** : `noImplicitAny` + build bloqué sur erreur
  TypeScript (`ignoreBuildErrors: false`) + ESLint strict (règles de bugs,
  `no-explicit-any`, `no-non-null-assertion`, `no-unused-vars`…) — `bun run lint`
  doit rester à **0 erreur / 0 avertissement** avant tout déploiement.

## 🧰 Runbook opérations ( exploitation quotidienne )

| Situation | Action |
|---|---|
| Démarrer | `bun run dev` (dev) / `bun run build && bun run start` (prod) |
| Santé | `curl -s http://localhost:3000/api/cities` → `{"success":true,…}` |
| Logs | Console du process (dev : terminal ; prod : systemd/Docker logs) |
| Sauvegarde DB | `cp db/custom.db db/custom-$(date +%F).db` — SQLite = un fichier ; à faire **quotidiennement** (fichiers `.db`, pas le dossier `node_modules`) |
| Restaurer | Arrêter le serveur → remplacer `db/custom.db` → redémarrer |
| Rotation secrets | Régénérer `WEBHOOK_SECRET` (`openssl rand -hex 32`) → mettre à jour `.env` → redémarrer → **re-signaler la nouvelle valeur au fournisseur webhook** |
| Rotation clés MoMo | Régénérer l'API Key sur le portail MTN → MAJ `MOMO_*` → redémarrer (les tokens en cache expirent en ≤ 24 h) |
| Verrous sièges bloqués | Aucune action : purge automatique (30 s max) ; en cas de doute, vérifier `SeatOccupancy` en base |
| Incident paiement MoMo | Onglet Paiements (admin) → carte MoMo : soldes + état de configuration ; vérifier les audits `MOMO_*` / `REFUND_*` |
| Compte compromis | Admin → Utilisateurs → désactiver, puis changer le mot de passe ; les sessions sont opaques en base (suppression = déconnexion immédiate) |
| Montée en charge | L'état en mémoire (rate limits, tokens MoMo, conversations assistant) est **mono-instance** : rester sur 1 instance Node ou planifier un store partagé (Redis) |
| Mise à jour du code | `bun install` → `bun run db:push` (migrations additives) → `bun run lint` (0 erreur requis) → redémarrer |

## 📁 Structure

```
src/app/          → routes API + page unique (SPA /)
src/proxy.ts      → CSP à nonces + en-têtes de requête (convention Next 16)
src/services/     → logique métier (paiements, MoMo, billets, assistant…)
src/features/     → vues client / admin / agent / chauffeur (espaces pro chargés à la demande)
prisma/           → schéma + seed opérationnel
public/           → PWA (manifest, service worker, icônes) + sitemap/robots
```

## ⚡ Performance incluse

- Espaces professionnels **chargés à la demande** (code-splitting) : le bundle
  public initial ne contient que l'accueil + le tunnel de réservation.
- Statistiques : **agrégats SQL** (SUM indexés) pour les KPI jour/mois ;
  purge des verrous de sièges **débouncée** (30 s) et regroupée en une transaction.
- Index Prisma sur toutes les colonnes de filtrage (statuts, dates, agences).

## 🌍 Mise en production

1. Renseignez `MOMO_*` (clés production MTN Congo, XAF, `mtncongo`)
2. Adaptez `NEXT_PUBLIC_SITE_URL` à votre domaine
3. `bun run build && bun run start` derrière un proxy HTTPS (HSTS actif)
4. Changez les mots de passe des comptes
5. Planifiez la sauvegarde quotidienne de `db/custom.db` (cf. runbook)
