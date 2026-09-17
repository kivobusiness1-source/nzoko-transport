# Task 2-b — full-stack-developer (frontend réservation)

## Mission
Remplacement des 5 stubs frontend de la plateforme NZOKO TRANSPORT (mobile-first, FR) :
accueil public, tunnel de réservation 6 étapes, connexion, suivi de billet, scanner
d'embarquement (CHECKER), guichet agent (AGENT). Codé CONTRE le contrat `src/lib/api-client.ts`
+ `src/types/index.ts` — aucun fichier `src/app/api/**`, `src/services/**`, `src/lib/**` modifié.

## Fichiers livrés

### Booking (cœur)
- `src/features/booking/home-view.tsx` — accueil : hero `.nzoko-hero`, recherche, "comment ça marche"
  (4 étapes), chips destinations cliquables (pré-sélection via formulaire contrôlé), bandeau confiance
  (QR sécurisé, MoMo MTN/Airtel « mode démo », sièges garantis 10 min, agences officielles).
- `src/features/booking/search-form.tsx` — formulaire CONTRÔLÉ (props from/to/date + onChange),
  validation FR (from≠to, date ≥ aujourd'hui), swap ArrowLeftRight, skeletons villes.
- `src/features/booking/booking-flow.tsx` — orchestrateur 6 étapes : Progress + chips étapes,
  fil d'Ariane, bouton retour à chaque étape (étape 5 = AlertDialog "Annuler et recommencer"),
  scroll top à chaque step, AnimatePresence (framer-motion) entre étapes, gestion
  SEAT_UNAVAILABLE (retour étape 3 + refresh seatmap), reset propre à l'expiration.
- `src/features/booking/trip-card.tsx` — carte voyage : horaires, durée, villes, arrêts (dots),
  bus, badge places (vert >10 / ambre 1-10 / rouge 0 « Complet »), prix, bouton Choisir.
- `src/features/booking/seat-map.tsx` — plan interactif généré depuis layout {rows, columns,
  aisleAfter} : sièges 40×40, couloir w-3/w-4, VIP orange, sélectionné `bg-primary nzoko-pulse`,
  occupé gris strikethrough disabled, légende + compteur + note verrou, refresh.
- `src/features/booking/passenger-step.tsx` — react-hook-form + Zod (prénom, nom, téléphone
  +242/06, email optionnel, CNI optionnelle) → onSubmit délègue à `api.bookings.create`.
- `src/features/booking/payment-step.tsx` — récap + RadioGroup (MTN MoMo, Airtel, Espèces,
  Carte, Virement), champ momo si MTN/Airtel, `api.payments.create` puis :
  isSimulation → encart ambre + « Valider le paiement (démo) » (`api.payments.simulate`) ;
  CASH + permission payment:cash-collect → « Encaisser et émettre le billet »
  (`api.payments.confirmCash`) ; instructions provider affichées ; NzokoCountdown sur
  expiresAt (alerte <2 min, expiration → reset). Succès → fetch BookingDetailDTO → étape 6.
- `src/features/booking/ticket-card.tsx` — billet électronique : bandeau vert NZOKO, trajet,
  siège XXL, référence mono copiable, QR (fond blanc), « Présentez ce QR au contrôleur »,
  impression via fenêtre dédiée (HTML autonome + window.print), « Suivre ce billet »
  (sessionStorage `nzoko-track-ref` → vue tracking), « Nouvelle réservation » (reset),
  variantes AGENT (copie réf + retour guichet).

### Auth / Tracking / Checker / Agent
- `src/features/auth/login-view.tsx` — Card centrée, RHF+Zod, toast bienvenue, message rouge,
  Collapsible « Comptes de démonstration » (8 comptes seed + bouton Utiliser + avertissement).
- `src/features/tracking/tracking-view.tsx` — recherche par référence, pré-remplissage via
  sessionStorage, 404 → message FR, rendu `NzokoBookingDetail` + rappel paiement si PENDING,
  AlertDialog d'annulation → `api.bookings.cancel`.
- `src/features/checker/checker-view.tsx` — saisie mono auto-focus (Entrée = valider),
  caméra via `window.BarcodeDetector` (Dialog + <video> + détection continue, fallback
  manuel TOUJOURS visible), résultat plein cadre par code (VALID/ALREADY_USED/INVALID/
  PAYMENT_NOT_CONFIRMED/TRIP_CANCELLED/WRONG_AGENCY), historique 20 scans en mémoire,
  429 → toast « Trop de scans ». `scan-result.tsx` + `trips-board.tsx` (Progress embarquement).
- `src/features/agent/agent-desk.tsx` — Tabs : « Nouvelle vente » (réutilise `<BookingFlow
  channel="AGENT" />` — import default), « Réservations » (`agency-bookings-tab.tsx` :
  recherche debounce, filtre statut, pagination, dialog détail + annulation si
  booking:manage), « Paiements en attente » (`pending-payments-tab.tsx` : chrono par
  booking, encaissement CASH create→confirmCash, MoMo démo create→simulate).

### Composants partagés (src/components/shared, préfixe nzoko-)
- `nzoko-badge.tsx` (BookingStatusBadge/PaymentStatusBadge/TripStatusBadge, couleurs constants)
- `nzoko-qr.tsx` (QR data URL, fond blanc, skeleton, état indexé par token)
- `nzoko-copy-button.tsx` (clipboard + fallback execCommand)
- `nzoko-countdown.tsx` (mm:ss, critique <2 min, onExpire déclenché une fois)
- `nzoko-booking-detail.tsx` (timeline réservée→payée→billet→embarquée, voyage, passager,
  paiements, QR, bouton annulation conditionnel)

## Points d'attention intégration
- Import de `PaymentProvider` depuis `@/lib/constants` (types/index.ts ne le ré-exporte pas).
- `agent-desk.tsx` importe `BookingFlow` en DEFAULT import (le stub est default export).
- L'icône lucide `Schedule` n'existe pas en 0.525 → remplacée par `CalendarClock`.
- ESLint React Compiler interdit setState synchrone dans les effects → fetchs en `.then`
  et formulaire de recherche contrôlé par le parent (pas d'effects de synchro).
- ERREURS `GET / 500` passées dans dev.log : Schedule + import nommé BookingFlow (miens,
  corrigés) puis modules admin manquants (agent parallèle, résolus par lui).
- Le serveur dev s'était arrêté (crash hors de mon périmètre) — relancé détaché
  (double-fork setsid) : `GET /` 200 stable. Aucune modification de prisma/api/services/lib.
