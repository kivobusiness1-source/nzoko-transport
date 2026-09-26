---
Task ID: repo-nzoko-46
Agent: Z.ai Code (orchestrateur principal)
Task: Accès au dépôt GitHub kivobusiness1-source/nzoko-transport (PAT lecture seule) + implémentation « mot de passe oublié » (doc Neon Auth password-reset / plugin Email OTP).

Work Log:
- Clone du dépôt (2e fois — rollback sandbox + avance du HEAD amont : V6/V7/V8 poussées entre-temps par un autre atelier), .env sandbox reconstruit (mode local, OTP_DEBUG), bun install + db:push + seed.
- Implémentation complète du flux « mot de passe oublié » double moteur : route /api/auth/password-reset (Neon email-otp forget-password en prod / bcrypt+PasswordResetCode en sandbox), canonisation identifiants staff (short-ID + legacy), PasswordResetCode dans les 2 schémas Prisma, delivery.passwordResetEmailContent, api-client + types, UI auth-screen 2 étapes avec lien « Mot de passe oublié ? », anti-énumération, rate limits, audit, révocation sessions.
- VALIDÉ : tsc 0, lint 0, cycle E2E API complet (ancien mdp rejeté, nouveau accepté, usage unique, anti-énum), navigateur agent-browser desktop+mobile sans erreur console, captures dans /home/z/nzoko-transport/agent-ctx/. Mots de passe seed restaurés après tests.
- COMMIT LOCAL d9b45e3..HEAD : commit créé dans le clone (/home/z/nzoko-transport) — NON poussé (PAT lecture seule, push 403 vérifié). Travail consigné dans le worklog du dépôt (Task ID: 46-mdp-oublie).

Stage Summary:
- Le dépôt nzoko-transport est cloné opérationnellement à /home/z/nzoko-transport (dev server : bun run dev, port 3000, log dev.log).
- Fonctionnalité « mot de passe oublié » livrée et validée en sandbox, commitée localement — en attente de push (nécessite un PAT avec Contents: Read & Write) puis déploiement Vercel + validation E2E prod (webhook send.otp → EMAIL_PROVIDER réel).
- Reste : push (token en écriture), éventuellement réinitialisation par SMS pour comptes téléphone (non supporté par Neon forget-password à ce jour).
---
Task ID: 49-fix-auth-forms-mobile-superadmin
Agent: Z.ai Code (orchestrateur principal)
Task: Signalement utilisateur — (1) formulaire d'inscription refuse la saisie du numéro de téléphone ; (2) le code d'authentification refuse les chiffres ; (3) superadmin non responsive sous mobile.

Work Log:
- Sandbox restaurée après rollback : re-clone du dépôt (HEAD 6f24f31), .env local (OTP_DEBUG, providers log), db:push + seed, dev server port 3000.
- DIAGNOSTIC (bug 1 et 2 — même cause racine) : react-hook-form v7.71 `_registerProps = useRef(control.register(...))` n'est initialisé qu'UNE FOIS par fibre. Les <Form> du même écran (login/inscription e-mail ; demande/vérification du code « mot de passe oublié ») rendent au même endroit JSX → React réutilise les fibres de Controller avec le câblage de l'ANCIEN formulaire → frappes écrites dans le mauvais store (phantom key) + input contrôlé réécrit à vide. Reproduit via agent-browser (événements input capturés, valeur réinitialisée entre chaque frappe, _formValues.phone resté vide). Le champ code OTP « mot de passe oublié » réutilisait la fibre du champ identifiant — exactement le « refuse de rentrer des chiffres » rapporté.
- FIX AUTH : key unique sur les 8 <Form> de auth-screen.tsx ; sanitisation chiffres-seulement (6 max) sur les 3 champs code ; inscription mode Neon : champ Téléphone ajouté (il n'existait PAS en production — bug distinct) ; POST /api/neon-auth/exchange accepte { phone } → normalizePhone E.164, unicité serveur (409 clair si numéro déjà lié), liaison après vérification e-mail via pendingPhoneRef consommé à la première connexion.
- DIAGNOSTIC (bug 3) : grilles « grid gap-3 md:grid-cols-2 » sans grid-cols-1 de base → piste implicite auto dimensionnée au contenu le plus large : 62 px de débordement horizontal, badges de rôle coupés (onglet Utilisateurs). Audit des 13 onglets à 390×844 via agent-browser (overflow page + captures).
- FIX MOBILE : grid-cols-1 explicite sur 13 grilles (admin-users, admin-ai-questions, agency-departures/agency-bookings, admin-fleet-agencies, admin-trips, client-favorites/overview, driver-view, finance-summary, nzoko-skeletons, nzoko-bookings-browser, auth-screen) + flex-wrap/ml-auto sur la rangée nom/badge admin-users.
- VALIDATION E2E agent-browser : inscription avec téléphone (desktop+mobile, « Bienvenue » + phone normalisé 242… vérifié en base), connexion OTP téléphone, mot de passe oublié complet (code saisi au clavier, sanitizeur « 12ab34cd56 » → « 123456 », nouveau mot de passe + reconnexion OK), 13 onglets admin 0 px de débordement, dialogues Nouveau bus / Nouveau voyage bien dimensionnés. tsc 0, lint 0. Mots de passe seed restaurés, comptes de test supprimés.
- COMMIT local 6be9188 (15 fichiers) — PUSH EN ATTENTE : sandbox restaurée sans identifiants GitHub (PAT classique perdu au rollback), push à effectuer dès que le token est re-fourni, puis Redeploy Vercel.

Stage Summary:
- Les 3 problèmes signalés sont corrigés et vérifiés E2E : saisie téléphone + code OTP opérationnels partout ; inscription Neon avec téléphone (normalisé, unicité, liaison) ; superadmin responsive à 390 px (0 débordement).
- En attente : push GitHub (token) → déploiement Vercel automatique. Le correctif est commité (6be9188) dans /home/z/nzoko-transport.
- Risque connu : le mode Neon (production) ne peut pas être reproduit en sandbox — la branche Neon du champ téléphone est validée par tsc + revue de code ; à surveiller au premier test en production.
---
Task ID: 55-multi-sites-api-centrale
Agent: Z.ai Code (session principale)
Task: Préparer le dialogue multi-sites — le déploiement devient le SITE CLIENT ; l'autre IA développe le SITE AGENCES ; les deux communiquent exclusivement via l'API centrale (contrat §1-§25 du prompt multi-sites).

Work Log:
- ANALYSE (§23) : stack confirmée (Next.js 16 + TS + Prisma + Neon Auth, double schéma SQLite sandbox / Postgres Vercel). MAPPING : SeatOccupancy ≡ TripSeat (unique tripId+seatId ✓, hold 10 min ✓, purge paresseuse ✓, webhook paiement idempotent ✓) ; écarts traités : multi-sièges, statuts contractuels, agencyId client, Idempotency-Key, DomainEvent, endpoints §17 exacts, auth service-à-service.
- SCHÉMA (SQLite + Postgres synchrones, db:push OK, validate Postgres OK) : SeatOccupancy.bookingId @unique → index (multi-sièges = N lignes/booking) ; Booking.idempotencyKey @unique ; NOUVEAU model DomainEvent (type/aggregate/tripId/bookingId/payload JSON sans PII, index curseur). Relation Booking.occupancy? → occupancies[] (zéro usager métier impacté).
- MOTEUR (booking.ts) : createBooking multi-sièges (seatIds 1..6, createMany verrous, rollback complet du groupe en P2002 → 409 SEAT_ALREADY_TAKEN), idempotence par clé (replay = réservation d'origine), agencyId validé existant+ACTIVE (canal de vente, ne possède PAS la place), customer{name,phone} OU passenger complet, promo × nb places, événements post-transaction ; purge des expirés émet SEAT_RELEASED + BOOKING_EXPIRED ; annulation capture les places AVANT la transaction puis émet BOOKING_CANCELLED/SEAT_RELEASED/TICKET_CANCELLED.
- PAIEMENTS (payment.ts) : confirmPaymentAndIssueTicket émet PAYMENT_SUCCESS/BOOKING_CONFIRMED/SEAT_PAID×N/TICKET_CREATED ; webhook interne émet PAYMENT_FAILED ; tickets.ts : scanAndBoard émet TICKET_BOARDED.
- ROUTES §17 : agencies(+/{id}) publics ; trips(+/{id}) ; trips/{id}/seats enrichi (tripId/total/number/status 5 valeurs, BOARDED dérivé du ticket USED) ; bookings/hold ; bookings/{idOrRef}/confirm (409 PAYMENT_REQUIRED sans paiement SUCCESS) ; payments/webhook (3 canaux dispatchés : MoMo re-vérifié GET / HMAC X-Nzoko-Signature / Bearer guichet — réf. inter-réservations → 409, jamais de confirm croisé) ; tickets/{token|id|boardingNumber} JSON ; events/client (polling à curseur, filtres tripId/bookingId/types/since) ; cancel accepte POST + canal service.
- AUTH SERVICE : isServiceAuth() — Bearer CENTRAL_API_SECRET ≥32 car. (temps constant), bypass anti-CSRF (pas de cookies) ; secret JAMAIS NEXT_PUBLIC_ ; .env.example documenté (génération openssl).
- FRONTEND : seat-map multi-sélection (max 6, toggle) + légende 🟢 disponible/VIP/🟡 hold/🔴 payé/⚫ embarqué + statuts serveur ; booking-flow : seatIds[], Idempotency-Key useRef par commande, hold → /api/bookings/hold, polling events 5 s pendant le plan → rechargement GET seats (jamais de delta local) ; passenger-step : places ×2 total ; payment-step/ticket-card/booking-detail : toutes les places.
- CONTRAT DOC : docs/api-centrale-contract.md — référence partagée pour l'IA du SITE AGENCES (endpoints, statuts, erreurs, idempotence, cycle de vie, règles métier documentées : CANCELLED → AVAILABLE immédiat, PENDING ≡ HELD, BookingSeat fusionné dans SeatOccupancy, Tests §21 couverts).
- E2E API (§21) : 27/27 ✓ — hold 201 HELD+holdExpiresAt ; 409 SEAT_ALREADY_TAKEN ; RACE 2 clients parallèles même place = 1×201 + 1×409 ; idempotence replay = même id ; agence inconnue 400 AGENCY_UNAVAILABLE ; confirm sans paiement 409 PAYMENT_REQUIRED ; encaissement service → SUCCESS + ticket ; webhook ×2 → duplicate:true + 1 ticket ; events BOOKING_CREATED/SEAT_HELD/PAYMENT_SUCCESS/BOOKING_CONFIRMED/TICKET_CREATED/SEAT_RELEASED/TICKET_CANCELLED ; expiry forcée → place reprise + EXPIRED ; passager 403 sur billet payé ; service cancel 200.
- E2E NAVIGATEUR : recherche PN→BZV +2j → plan multi-sélection (01+02 « Continuer avec 2 places (01, 02) ») → passager (Places 01, 02 · 20 000 ×2 = 40 000) → hold « 2 places réservées ! » + compte à rebours 9:37 → paiement via service (simule SITE AGENCES) → Suivi billet NZK-2026-5XGR5V « Confirmée » + timeline Réservée→Payée→Billet émis + QR + n° embarquement + PDF ; retour au plan : places 01/02 🔴 « déjà réservé / payé » [disabled] ; mobile 390 px : grille 2+2 + légende propres, 0 débordement ; 0 erreur console (2 warnings React Select préexistants) ; tsc 0, lint 0.
- BUGS CORRIGÉS EN ROUTE : (1) P2003 FK au remboursement service (createdById « service… » inconnu) → actorUserId || null ; (2) SEAT_RELEASED émis avec [] (places capturées après suppression) → capture avant transaction ; (3) confirm croisé possible via providerTransactionId d'une autre réservation → 409 CONFLICT.
- COMMIT 43ea720 poussé (ab625c8..43ea720 main) — déploiement Vercel auto.

Stage Summary:
- L'API CENTRALE DU CONTRAT §17 EST EN LIGNE DANS CE DÉPLOIEMENT, documentée dans docs/api-centrale-contract.md : l'IA du SITE AGENCES peut coder contre ce contrat — lecture publics (agencies/trips/seats), mutations (hold/confirm/cancel/payments/webhook) accessibles cookie-web OU Bearer CENTRAL_API_SECRET, idempotence et anti-concurrence vérifiées E2E 27/27.
- POUR L'EXPLOITANT : définir CENTRAL_API_SECRET (même valeur) dans Vercel (ce site) ET côté SITE AGENCES ; donner le chemin du doc de contrat à l'autre IA. Aucune autre config nécessaire.
- RESTE (prochaines sessions) : (1) validation en prod Vercel après deploy (contrat §21 re-jouable via /tmp/e2e_contract.py adapté à l'URL de prod) ; (2) events SSE si volumétrie (polling 5 s retenu) ; (3) multi-passagers nommés par place (v1 = 1 acheteur pour N places) ; (4) webhook SITE AGENCES ↔ events (l'autre site peut poller /api/events/client ?types=… dès maintenant).
