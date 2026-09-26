# API CENTRALE OCÉAN DU NORD — CONTRAT D'INTERFACE MULTI-SITES

> **Document de référence pour le dialogue SITE CLIENT ↔ SITE AGENCES.**
> Base : spécification « Projet Océan du Nord — Site Client » (§1 à §25).
> Déploiement : https://nzoko-transport-eight.vercel.app (l'API centrale est
> hébergée par le déploiement du SITE CLIENT — mêmes routes, même contrat ;
> si l'API est extraite dans un service dédié plus tard, les chemins,
> statuts et formats RESTENT IDENTIQUES).

---

## 0. Principes

1. **Neon PostgreSQL = source unique de vérité.** Aucun site ne garde un
   état local des places. Le frontend ne parle JAMAIS à la base directement.
2. **Les deux sites ne communiquent JAMAIS entre eux directement.** Tout
   passe par cette API (`SITE AGENCES → API centrale → Neon`).
3. **Une place appartient à un BUS ; son état appartient à un VOYAGE.**
   Table `SeatOccupancy` — fusion documentée de `TripSeat` + `BookingSeat` :
   - clé unique `(@@unique([tripId, seatId]))` = anti double réservation
     garantie PAR LA BASE (aucun SELECT puis UPDATE non protégé) ;
   - `bookingId` relie la place à sa réservation (N lignes par réservation
     multi-sièges) ;
   - `status` interne : `HELD` (verrou) | `BOOKED` (confirmé).
4. **Identifiants exposés** : le `seatId` utilisé par le contrat est l'id du
   siège physique du bus (`Seat.id`, stable, propre au bus). L'état est
   TOUJOURS relatif au voyage (`GET /api/trips/{id}/seats`). Le couple
   `(tripId, seatId)` EST le TripSeat.
5. **Statuts des places exposés (§4, STRICT)** :
   `AVAILABLE | HELD | PAID | CANCELLED | BOARDED`
   - `AVAILABLE` : aucune occupation active (verrou expiré → redevenue libre)
   - `HELD` : verrou temporaire 10 min en cours
   - `PAID` : réservation confirmée/payée
   - `CANCELLED` : transition d'annulation ; **règle métier** : une place
     annulée REDEVIENT immédiatement `AVAILABLE` (pas de stock mort)
   - `BOARDED` : ticket scanné (passager embarqué)
6. **Statuts de réservation exposés** : `HELD | CONFIRMED | CANCELLED |
   EXPIRED` (champ `contractStatus`). Statuts internes complémentaires
   (champ `status`) : `PENDING ≡ HELD`, `COMPLETED ≡ CONFIRMED`.
7. **Idempotence (§16)** : header `Idempotency-Key: <uuid>` sur
   `POST /api/bookings/hold` et `POST /api/payments/webhook`. Rejouer la
   même clé renvoie la ressource d'origine — jamais de doublon. Clé réutilisée
   avec un corps différent → `409 CONFLICT`.
8. **Jamais sur parole du navigateur (§18)** : tripId, agencyId, seatIds,
   client, montant et statuts sont revalidés côté serveur (Zod + règles métier).

---

## 1. Authentification

| Profil | Mécanisme |
|---|---|
| Navigateur SITE CLIENT (public + sessions) | Cookies de session + en-tête anti-CSRF `x-requested-with: nzoko` (posé automatiquement par le frontend) |
| **SITE AGENCES (serveur-à-serveur)** | `Authorization: Bearer ${CENTRAL_API_SECRET}` (≥ 32 caractères, comparaison à temps constant) |

- `CENTRAL_API_SECRET` vit UNIQUEMENT côté serveur des deux sites.
  Jamais `NEXT_PUBLIC_*`. Jamais en base.
- Un appel Bearer est exempt d'anti-CSRF (pas de cookies = pas de CSRF).
- Rate limiting par IP sur toutes les routes (public 60/min, hold
  10/min, sièges 20/min…). Le SITE AGENCES DOIT gérer les `429`.

## 2. Enveloppe de réponse (toutes les routes)

```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": { "code": "SEAT_ALREADY_TAKEN", "message": "Cette place vient d'être réservée. Veuillez choisir une autre place." } }
```

Codes d'erreur : `VALIDATION_ERROR` (400), `NOT_FOUND` (404),
`SEAT_ALREADY_TAKEN` / `SEAT_UNAVAILABLE` / `TRIP_UNAVAILABLE` /
`AGENCY_UNAVAILABLE` / `PAYMENT_REQUIRED` / `CONFLICT` (409),
`FORBIDDEN` (403), `UNAUTHORIZED` (401), `RATE_LIMITED` (429).

---

## 3. Endpoints (§17)

### 3.1 `GET /api/agencies` — liste des agences actives (public, cache OK)
`data: [{ id, code, name, city:{id,name,slug}, neighborhood:{id,name}|null,
address, phone, email, description, latitude, longitude, openingTime,
closingTime, isActive }]`

### 3.2 `GET /api/agencies/{id}` — détail d'une agence (id OU code, ex `PNR-001`)
Même forme (objet unique). 404 si inactive/inconnue.

### 3.3 `GET /api/trips?from={cityId}&to={cityId}&date=YYYY-MM-DD&agencyId=`
Recherche publique (routes directes ET via arrêts). Triés par départ.
`data: [{ id, code, originCityId, originCityName, destinationCityId,
destinationCityName, stops:[{cityName,minutesFromStart}], departureTime,
estimatedArrivalTime, price, status, busRegistration, busBrand, busModel,
seatLayoutId, totalSeats, availableSeats, agencyName, durationMinutes }]`

### 3.4 `GET /api/trips/{id}` — détail d'un voyage (+ `reservable: boolean`)

### 3.5 `GET /api/trips/{id}/seats` — plan de sièges (§6)
```json
{
  "tripId": "…",
  "trip": { "id", "code", "originCityName", "destinationCityName", "departureTime",
            "estimatedArrivalTime", "price", "status", "busRegistration", "agencyName" },
  "layout": { "rows", "columns", "aisleAfter", "name" },
  "seats": [ { "id": "seatId", "number": "12", "seatNumber": "12", "row": 3,
               "column": "B", "type": "STANDARD|VIP", "status": "AVAILABLE|HELD|PAID|CANCELLED|BOARDED" } ],
  "availableSeats": 37,
  "total": 40,
  "holdMinutes": 10
}
```
`status` est CALCULÉ SERVEUR (verrous actifs + tickets) — le frontend
n'applique JAMAIS d'état local définitif.

### 3.6 `POST /api/bookings/hold` — réservation temporaire (§7/§8/§9)
Header recommandé : `Idempotency-Key: <uuid>`.
```json
{
  "tripId": "…",
  "seatIds": ["seatId1", "seatId2"],        // 1..6 places
  "agencyId": "agency_001",                  // §5 agence choisie (canal de vente)
  "customer": { "name": "Jean Mbala", "phone": "+242 06 123 45 67", "email": "…" },
  "promoCode": "ONC-FID-…",                  // optionnel
  "dropOffNeighborhoodId": "…"               // optionnel (quartier de la ville de destination)
}
```
- `customer` (contrat minimal) OU `passenger` complet
  `{firstName, lastName, phone, email?, documentNumber?}` — les deux acceptés.
- **Extension documentée §24 — `passengers[]` (multi-passagers nommés)** :
  tableau aligné par index sur `seatIds`, chaque élément
  `{firstName, lastName, phone?, email?, documentNumber?}`. Le téléphone de
  l'acheteur sert de contact de repli. Réponse : `seats[i].passenger = {firstName, lastName}`.
  Si `passengers` est absent, toutes les places portent le passager acheteur
  (comportement §7 strict).
- **Validations serveur (§7.1-9)** : voyage existant + réservable ;
  agence existante + ACTIVE ; places appartenant au bus du voyage ;
  disponibilité ; idempotence ; téléphone normalisé E.164.
- **Verrou concurrent (§8)** : contrainte unique `(tripId, seatId)` en base.
  Deux clients sur la même place → UN `201`, l'autre :
  `409 SEAT_ALREADY_TAKEN` « Cette place vient d'être réservée. Veuillez
  choisir une autre place. » — rollback COMPLET du groupe (toutes les places
  du hold concurrent sont libérées).
- `201` → détail complet (§3.7) : `status:"PENDING"`,
  `contractStatus:"HELD"`, `holdExpiresAt` (ISO, +10 min), `seats:[…]`,
  `amount` (prix unitaire × nombre de places, promo déduite), `payments:[]`,
  `ticket:null`.

### 3.7 `GET /api/bookings/{idOrRef}` — détail d'une réservation
`{idOrRef}` = id interne OU référence `ONC-…`/`NZK-…` (insensible casse).
Inclut `seats[]`, `payments[]`, `ticket{…}`, `contractStatus`, `holdExpiresAt`.

### 3.8 `POST /api/bookings/{idOrRef}/confirm` — confirmation (§12)
- Renvoie le détail si déjà `CONFIRMED` (idempotent).
- Exige UN paiement `SUCCESS` en base, sinon `409 PAYMENT_REQUIRED`
  (« Le paiement n'a pas été confirmé côté serveur… »).
- À la confirmation : `Booking=CONFIRMED`, `TripSeat=PAID`,
  `Ticket=CREATED` (idempotent — un seul ticket par réservation).

### 3.9 `POST /api/bookings/{idOrRef}/cancel` — annulation
Session client/agent OU service Bearer. Libère les places
(`SEAT_RELEASED`), annule le ticket, rembourse les paiements `SUCCESS`
(statut `REFUNDED` + écriture comptable). Idempotent par statut.

### 3.10 `POST /api/payments` — initier un paiement
```json
{ "bookingId": "…", "provider": "MTN_MOMO|AIRTEL_MONEY|CASH|CARD|BANK_TRANSFER", "momoPhone": "+242…", "senderName": "…" }
```
`201 → PaymentDTO { id, status:"PENDING"|"PROCESSING", providerTransactionId, … }`.
MTN MoMo : Request to Pay réel (sandbox : simulation `PAYMENTS_SIMULATION`).
Suivi : `POST /api/payments/momo/status` (polling, idempotent).

### 3.11 `POST /api/payments/webhook` — webhook de paiement (§11)
Trois canaux authentifiés, dispatchés automatiquement :
1. **Callback MTN MoMo** (non signé) → JAMAIS pris sur parole : le statut
   est RE-VÉRIFIÉ par `GET requesttopay` auprès de MTN ;
2. **Webhook interne signé** : `X-Nzoko-Signature: hex(HMAC-SHA256(body, WEBHOOK_SECRET))`,
   payload `{ provider, providerTransactionId, status: "SUCCESS|FAILED|CANCELLED", amount? }` ;
3. **SITE AGENCES (Bearer)** : déclaration d'encaissement guichet —
   `{ bookingId, provider, providerTransactionId, amount }` → paiement
   créé PUIS confirmé idempotemment.

Garanties : authentifié, validé (montant divergent → 409 + SecurityLog),
**idempotent** (providerTransactionId unique ; re-confirmer un SUCCESS =
no-op) — **un webhook reçu deux fois ne crée JAMAIS deux tickets** (§21-T6).
**Réservation déjà CONFIRMED** (durcissement §11) : replay du MÊME
encaissement (même providerTransactionId déjà SUCCESS) → `200 duplicate:true` ;
NOUVELLE référence de transaction sur la même réservation → **409 CONFLICT**
(« Cette réservation est déjà payée — un seul encaissement possible. ») :
jamais 2 paiements SUCCESS ni 2 écritures comptables pour la même réservation.

### 3.12 `GET /api/tickets/{tokenOrIdOrBoardingNumber}` — consultation billet
```json
{ "id", "token", "boardingNumber", "status": "VALID|USED|CANCELLED",
  "issuedAt", "checkedAt", "checkedByName",
  "booking": { "id", "bookingReference", "status", "amount",
               "seats": ["12","13"], "passenger": "Jean Mbala",
               "trip": {…}, "agencyName" },
  "qrUrl": "/api/tickets/{token}/qr", "pdfUrl": "/api/tickets/{token}/pdf" }
```

### 3.13 `GET /api/events/client` — événements (§14/§15)
Polling à curseur (fiable serverless). Params : `tripId=`, `bookingId=`
(id OU référence), `types=A,B`, `since=<cursor précédent>`.
```json
{ "events": [ { "id", "type", "aggregateType", "aggregateId",
                "tripId", "bookingId", "payload": {}, "createdAt" } ],
  "cursor": "…", "hasMore": false, "pollAfterMs": 4000 }
```
Vocabulaire : `SEAT_HELD, SEAT_RELEASED, SEAT_PAID, SEAT_CANCELLED,
BOOKING_CREATED, BOOKING_CONFIRMED, BOOKING_CANCELLED, BOOKING_EXPIRED,
PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_REFUNDED, TICKET_CREATED,
TICKET_CANCELLED, TICKET_BOARDED, TRIP_CANCELLED`.
**Stratégie §15** : à réception d'un événement concerné, le site appelle
`GET /api/trips/{id}/seats` (ou `GET /api/bookings/{id}`) et affiche
l'état renvoyé — jamais d'application locale des deltas. Payloads SANS PII.

### 3.14 `GET /api/payments/methods` — méthodes de paiement disponibles (public)
NOUVEAU (extension documentée §24 AVANT usage — lecteurs : SITE CLIENT + SITE AGENCES).
Disponibilité HONNÊTE calculée côté serveur (aucun secret exposé) : le site
n'affiche JAMAIS une méthode qui échouerait systématiquement (503) et
n'accumule donc pas de paiements « FAILED » dans les historiques.
```json
{ "methods": [ { "provider": "MTN_MOMO", "label": "MTN Mobile Money",
                 "available": false, "kind": "instant",
                 "note": "Paiement Mobile Money en cours d'activation…" },
               { "provider": "CASH", "label": "Espèces (guichet)",
                 "available": true, "kind": "manual", "note": null } ] }
```
`kind` : `instant` = confirmation automatique (MoMo) · `manual` = confirmation
humaine (guichet/comptable, via §3.11 canal service). Le SITE AGENCES peut
interroger ce endpoint avant d'initier un paiement (§3.10/§3.11) pour ne
proposer à ses guichets que les canaux réellement actifs.

### 3.15 `GET /api/events/client/stream` — flux SSE des événements (§14/§15)
NOUVEAU (extension documentée §24 AVANT usage — lecteurs : SITE CLIENT + SITE AGENCES).
Variante Server-Sent Events de §3.13, MÊMES filtres (`tripId=`, `bookingId=`
id OU référence, `types=A,B`) et MÊME modèle de sécurité (payloads SANS PII).
Le polling §3.13 RESTE LA RÉFÉRENCE : le SSE est un ajout optionnel — tout
consommateur doit savoir retomber sur §3.13 si le flux échoue.

```
GET /api/events/client/stream?tripId=…&types=SEAT_HELD,SEAT_PAID
Accept: text/event-stream          (implicite avec EventSource)
```
Réponse `200` `Content-Type: text/event-stream; charset=utf-8` :
```
retry: 5000                          ← délai de reconnexion conseillé
data: {"type":"RESYNC","at":"…"}     ← envoyé À CHAQUE (re)connexion
data: {…événement §3.13…}            ← 1 frame par événement
: ping                               ← heartbeat ~15 s
```
- **Frames SANS champ `event:`** (data-only) : consommables avec
  `EventSource.onmessage` ; le JSON porte `type` (vocabulaire §3.13).
- **Curseur** : chaque frame d'événement porte `id:` = id BDD ; à la
  reconnexion, `Last-Event-ID` est repris automatiquement comme curseur
  (équivalent de `since=` §3.13).
- **RESYNC** : après toute ouverture/reconnexion, recharger la vérité
  serveur (`GET /api/trips/{id}/seats` / `GET /api/bookings/{id}`) — règle
  §15 inchangée : JAMAIS d'application locale des deltas.
- **Cycle de vie** : le serveur ferme le flux après ~4 min (propre, fin de
  stream) ; EventSource se reconnecte seul (`retry: 5000`). Heartbeats
  `: ping` toutes les ~15 s (anti-timeout proxy). Latence de poussée ≤ ~3 s.
- **Compatibilité** : `Cache-Control: no-cache, no-transform`,
  `X-Accel-Buffering: no` (proxies). Si le flux ne s'ouvre pas (proxy
  restrictif, réseau d'entreprise), utiliser §3.13 — comportement identique.
- **Usage typique SITE CLIENT** : plan de sièges temps réel (étape siège) et
  écran « paiement en attente au guichet » — `PAYMENT_SUCCESS` fait avancer
  le client à son billet sans manipulation (canal §3.11).

---

## 4. Cycle de vie (§4/§10/§12)

```
AVAILABLE → HELD (hold 10 min) ─┬→ PAID (paiement SUCCESS serveur) → BOARDED (scan)
                                ├→ EXPIRED (purge) → AVAILABLE + SEAT_RELEASED
                                └→ annulée → AVAILABLE + SEAT_RELEASED
PAID → CANCELLED (annulation + remboursement) → AVAILABLE
```
Paiement : `PENDING → SUCCESS | FAILED` — confirmé UNIQUEMENT côté serveur
(MTN re-vérifié par GET, webhook HMAC, ou encaissement guichet authentifié).
Le bouton « J'ai payé » n'est JAMAIS une preuve.

### 4.1 Annulation d'un VOYAGE par l'exploitant (extension §24 documentée)
Quand un voyage passe `CANCELLED` (PATCH admin), le serveur annule TOUTES les
réservations actives du voyage — PENDING **et CONFIRMED** :
- places libérées (`SEAT_RELEASED ×N`, redeviennent `AVAILABLE` — un client
  peut réserver sur un voyage de remplacement) ;
- billets VOID (`TICKET_CANCELLED`) — le scan checker renvoie TRIP_CANCELLED ;
- `BOOKING_CANCELLED` par réservation (`payload.reason = "TRIP_CANCELLED"`) ;
- un événement `TRIP_CANCELLED` (payload `{cancelledBookings}`) ;
- notifications in-app aux clients concernés.
**Remboursements** : les paiements des réservations CONFIRMED restent `SUCCESS`
(l'argent est réellement encaissé) — l'agence traite chaque remboursement via
sa liste de contacts d'annulation puis l'enregistre : le paiement passe alors
`REFUNDED` (écriture comptable `REFUND` + événement `PAYMENT_REFUNDED`
payload `{provider, amount, mode}` + notification client). Le SITE AGENCES
doit s'abonner à `PAYMENT_REFUNDED` (§3.13/§3.15) pour répercuter l'état
« remboursé » sur les ventes de son canal.

## 5. Tests imposés (§21) — couverts et VÉRIFIÉS en E2E

| # | Scénario | Résultat exigé | Statut |
|---|---|---|---|
| 1 | hold place disponible | 201 + HELD | ✓ E2E |
| 2 | hold place payée | 409 SEAT_ALREADY_TAKEN | ✓ E2E |
| 3 | 2 clients même place simultanément | 1×201 + 1×409 | ✓ E2E (race parallèle) |
| 4 | hold expire | HELD → AVAILABLE (+ BOOKING_EXPIRED) | ✓ E2E (purge forcée) |
| 5 | paiement réussi | Payment SUCCESS + CONFIRMED + PAID + Ticket | ✓ E2E |
| 6 | webhook ×2 | 1 seul paiement confirmé + 1 seul ticket | ✓ E2E (idempotence) |
| 7 | agence sélectionnée | `booking.agencyId = Agency A` | ✓ E2E |
| 8 | agence inactive/inconnue | 400 AGENCY_UNAVAILABLE (§18 : revalidation serveur) | ✓ E2E |

## 6. Compatibilité SITE AGENCES (§22/§24)

- Mêmes concepts : `Trip, Bus, Seat (BusSeat), SeatOccupancy (TripSeat +
  BookingSeat fusionnés), Booking, Payment, Ticket, Agency, DomainEvent`.
- Mêmes statuts de places et de réservations (cf. §0.5/§0.6).
- Le SITE AGENCES doit utiliser LES MÊMES endpoints (jamais un accès direct
  à Neon écrit par ses soins) et gérer `409 SEAT_ALREADY_TAKEN`.
- Toute modification de ce contrat (tables, statuts, endpoints, JSON)
  DOIT être documentée dans ce fichier et validée par les deux équipes.
- Incompatibilité détectée → signaler, ne JAMAIS inventer une solution locale.

### 6.1 Extension documentée — embarquement PAR PLACE (passagers nommés, §24)

> Extension rétro-compatible, en vigueur à compter de la version de ce
> document. Aucun champ existant n'est supprimé ni renommé.

- **`SeatOccupancy.boardedAt`** (datetime, nullable) : horizon d'embarquement
  de LA place. `null` = passager pas encore monté à bord. Le statut
  contractuel `BOARDED` d'une place est désormais dérivé de `boardedAt`
  (fallback héritage : ticket `USED` pour les groupes embarqués avant
  l'extension — les deux sites doivent appliquer le MÊME fallback).
- **`POST /api/checker/scan`** (endpoint interne checker, auth cookie
  agent + `checker:scan`, rate-limité) accepte deux options optionnelles :
  - `preview: true` → exécute TOUTES les vérifications (agence, billet,
    paiement, voyage) SANS aucune mutation ; répond `VALID` + `preview:true`
    avec la liste des places. Un groupe déjà entièrement embarqué répond
    `ALREADY_USED`.
  - `seatNumbers: ["01","03"]` → n'embarque QUE ces places (les autres
    restent `PAID`, embarquables plus tard en rescannant le même billet,
    même si le ticket est déjà `USED`). Absent = tout le groupe embarque
    (comportement historique).
- **`ScanResultDTO.ticket.seats[]`** (nouveau champ, toujours présent) :
  `{ seatNumber, seatType, passengerName, isBuyer, boardedAt }[]` — LE
  passager de CHAQUE place (extension passagers nommés §7). Les champs
  historiques `passengerName`/`seatNumber` restent = acheteur + place
  principale (compat SITE AGENCES).
- **`GET /api/bookings/{id}`** : `seats[].boardedAt` (datetime|null, champ
  additionnel) ajouté à chaque place du groupe — brut, sans repli ; le
  client applique le même fallback héritage que l'API (ticket `USED` et
  aucune place datée = groupe embarqué).
- **Événements** : un `TICKET_BOARDED` est émis PAR PLACE embarquée
  (payload `{ reference, seatNumber }`) — le plan de sièges temps réel des
  deux sites reflète chaque passager individuellement.

## 7. Variables d'environnement

| Variable | Rôle |
|---|---|
| `CENTRAL_API_SECRET` | Secret service-à-server (≥ 32 car.) — les DEUX sites |
| `WEBHOOK_SECRET` | HMAC du webhook interne (route signée) |
| `DATABASE_URL` | Neon PostgreSQL (pooler) — serveur uniquement |
| `PAYMENTS_SIMULATION` | `true` en sandbox : MoMo simulé (aucun appel MTN) |
