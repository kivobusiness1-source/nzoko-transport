# Architecture « 3 bases de données » — Océan du Nord

> Demande exploitant (Task 54) : séparer physiquement les données en **trois bases**
> pour ne pas surcharger la base principale : (1) agences & équipes, (2) comptes
> clients, (3) villes / GPS / quartiers / lignes.

## État déployé (2026-09-26)

Trois bases PostgreSQL **réelles** existent désormais sur le projet Neon, avec le
schéma applicatif complet poussé dans chacune (`prisma/schema.postgres.prisma`)
et les données de production copiées selon le découpage par domaine :

| Base | Domaine propriétaire | Tables principales (propriétaires) |
|---|---|---|
| `ocean_geo` | Géographie | `City`, `Neighborhood`, `Route`, `RouteStop` |
| `ocean_clients` | Identité & clients | `User`, `Session`, `Role`, `Permission`, `RolePermission`, `Notification`, `OtpCode`, `LoyaltyAccount`, `LoyaltyTransaction`, `FavoriteRoute`, `Complaint`, `ComplaintMessage`, `RedemptionRequest` |
| `ocean_agences` | Exploitation & agences | `Agency`, `SeatLayout`, `Seat`, `Bus`, `Driver`, `Trip`, `Passenger`, `Booking`, `SeatOccupancy`, `Payment`, `Ticket`, `Transaction`, `Expense`, `TrackingSession`, `GpsPoint`, `TrackingEvent`, `TripRating`, `PromoCode`, `KnowledgeBase`, `AIQuestionLog`, `AuditLog`, `SecurityLog` |

Les autres tables présentes dans chaque base sont des **copies de référence**
(villes, agences, utilisateurs…) maintenues uniquement pour l'intégrité des clés
étrangères PostgreSQL — une FK ne peut pas pointer vers une autre base.

Vérification du 2026-09-26 : toutes les tables propriétaires ont un nombre de
lignes identique à la base principale (ex. `Agency` 9, `User` 14, `Trip` 138,
`Booking` 28, `Payment` 26, `AuditLog` 118, `Session` 121 — 100 % ✓).

## Base principale (application en production)

L'application tourne **toujours** sur la base principale (`DATABASE_URL` Vercel) :
aucune interruption, aucun risque pris sur la production. Les trois bases
constituent la **cible** d'une bascule progressive.

## Plan de bascule (phase suivante — « on va continuer »)

1. **Géo d'abord** (faible risque, tables quasi statiques) : connecter la lecture
   des villes/quartiers/lignes à `ocean_geo` (client Prisma dédié ou réplication),
   garder la base principale en source de vérité pendant la période de confiance.
2. **Clients** ensuite (`User`, fidélité, notifications) — attention : Neon Auth
   reste la source de vérité de l'identité (schéma `neon_auth`) ; seule la
   table miroir `User` bascule.
3. **Exploitation** en dernier (agences, bus, voyages, réservations) — le domaine
   le plus dense en FK croisées (Booking → User + Trip + City), la bascule se fera
   domaine par domaine avec double-écriture temporaire.
4. Chaque bascule : variables Vercel dédiées (`OCEAN_GEO_DATABASE_URL`,
   `OCEAN_CLIENTS_DATABASE_URL`, `OCEAN_AGENCES_DATABASE_URL` — JAMAIS de secret
   dans le code), redéploiement, vérification E2E, rollback possible en 1 minute
   (repointer vers la base principale).

## Connexion

Mêmes identifiants que la base principale (rôle `neondb_owner` du projet) — les
URLs suivent le format Vercel existant, seul le nom de base change :
`postgresql://<owner>:<motdepasse>@<hôte-pooler>/<ocean_geo|ocean_clients|ocean_agences>?sslmode=require`.
⚠️ Aucune chaîne de connexion dans ce dépôt (politique Secrets Management).

## Scripts (hors dépôt, scratch `/home/z/neonq`)

- `create-dbs.ts` — création des 3 bases (hôte direct, `CREATE DATABASE`)
- `copy.ts` — copie topologique des données (dépendance circulaire
  `Agency.managerId` ↔ `User.agencyId` gérée en 2 passes : Agency sans manager,
  puis User, puis restauration du manager)
- `verify.ts` — comparaison des compteurs source ↔ 3 bases
