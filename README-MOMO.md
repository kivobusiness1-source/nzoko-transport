# 💳 MTN Mobile Money — Guide d'intégration (NZOKO TRANSPORT)

Intégration officielle des API **MTN MoMo Open API** pour :
- **Collecte** (Collections → *Request to Pay*) : paiement des billets par les clients ;
- **Envoi de fonds** (Disbursements → *Transfer* / *Refund*) : remboursement des clients.

Documentation officielle : https://momodeveloper.mtn.com/api-documentation

---

## 1. Obtenir vos clés (portail MTN Developer)

1. **Créez un compte** sur https://momodeveloper.mtn.com (lien d'activation valable 24 h).
2. **Souscrivez aux produits** sur la page *Products* :
   - `Collection` — collecte des paiements ;
   - `Disbursement` — envoi de fonds / remboursements.
   Chaque souscription fournit une **Primary Key** et une **Secondary Key**
   (= en-tête `Ocp-Apim-Subscription-Key`).
3. **Provisionnez un API User + API Key** :
   - **Sandbox** : via la *Sandbox Provisioning API* (voir ci-dessous) ;
   - **Production** : via le portail partenaire MTN (clés fournies au go-live).

### Provisioning sandbox (à faire une fois par produit)

```bash
SUB_KEY_COLLECTION="<votre Ocp-Apim-Subscription-Key Collections>"

# 1) Créer l'API User — X-Reference-Id = UUID v4 que VOUS choisissez
UUID=$(uuidgen | tr 'A-Z' 'a-z')
curl -s -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" \
  -H "X-Reference-Id: $UUID" \
  -H "Ocp-Apim-Subscription-Key: $SUB_KEY_COLLECTION" \
  -H "Content-Type: application/json" \
  -d '{"providerCallbackHost": "votre-domaine.com"}'
# → 201 Created.  $UUID = MOMO_COLLECTION_API_USER

# 2) Créer l'API Key
curl -s -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/$UUID/apikey" \
  -H "Ocp-Apim-Subscription-Key: $SUB_KEY_COLLECTION"
# → 200 { "apiKey": "..." } = MOMO_COLLECTION_API_KEY
```

Répétez pour **Disbursement** avec la souscription correspondante.

---

## 2. Configuration (`.env`)

```bash
MOMO_ENVIRONMENT=sandbox                  # sandbox | production
# MOMO_BASE_URL=                          # défaut : https://sandbox.momodeveloper.mtn.com
# MOMO_TARGET_ENVIRONMENT=                # défaut : sandbox (prod Congo : mtncongo)
# MOMO_CURRENCY=                          # défaut : EUR en sandbox, XAF en production

# Collections — paiement des billets
MOMO_COLLECTION_SUBSCRIPTION_KEY=...
MOMO_COLLECTION_API_USER=...
MOMO_COLLECTION_API_KEY=...

# Disbursements — remboursements / envoi de fonds
MOMO_DISBURSEMENT_SUBSCRIPTION_KEY=...
MOMO_DISBURSEMENT_API_USER=...
MOMO_DISBURSEMENT_API_KEY=...

# Callback optionnel (HTTPS obligatoire, domaine = providerCallbackHost)
# MOMO_CALLBACK_URL=https://votre-domaine.com/api/webhooks/momo
```

> ⚠️ **Sécurité** : ces clés restent **strictement locales** (`.env`, jamais versionné,
> jamais inclus dans le ZIP distribuable). Toute clé exposée doit être **régénérée**
> immédiatement depuis le portail MTN.

Sans clés : le paiement MTN MoMo renvoie une erreur explicite « non configuré » ;
le mode simulation reste disponible via `PAYMENTS_SIMULATION=true`.

---

## 3. Fonctionnement

### Collecte — achat d'un billet (Request to Pay)

```
Client → POST /api/payments {provider: MTN_MOMO, momoPhone}
       → NZOKO appelle POST /collection/v1_0/requesttopay (X-Reference-Id = UUID)
       → 202 Accepted : paiement PROCESSING
Client approuve sur son téléphone (app MoMo / USSD)
Interface → POST /api/payments/momo/status {paymentId}   (polling auto 5 s, 3 min)
       → GET /collection/v1_0/requesttopay/{referenceId} chez MTN
       → SUCCESSFUL → billet émis + écriture comptable (idempotent)
       → FAILED     → motif affiché au client (solde insuffisant, refus, expiration…)
```

Le statut est **toujours re-vérifié côté serveur auprès de MTN** — jamais sur parole
du client. Callback optionnel : `POST|PUT /api/webhooks/momo` (le corps reçu n'est
qu'un signal ; le statut est re-confirmé par GET).

### Remboursement — envoi de fonds au client (permission `payment:manage`)

Trois modes depuis l'espace admin (onglet Paiements) :

| Mode | API MTN | Usage |
|---|---|---|
| `MOMO_REFUND` | `POST /disbursement/v1_0/refund` | Rembourse **automatiquement** la transaction d'origine vers le compte ayant payé |
| `MOMO_TRANSFER` | `POST /disbursement/v1_0/transfer` | Envoie les fonds vers **un numéro choisi** (ex : autre compte du client) |
| `CASH` | — | Espèces rendues au guichet (finalisation immédiate) |

Les opérations MoMo sont asynchrones (202) : l'interface suit automatiquement le
statut (`GET /disbursement/v1_0/{refund|transfer}/{referenceId}`) et finalise
(paiement `REFUNDED` + transaction comptable `REFUND`) dès le `SUCCESSFUL`.

### Soldes (permission `finance:read`)

`GET /api/admin/momo/overview` — état de configuration + soldes des comptes
`collection` et `disbursement` (aucun secret n'est exposé).

---

## 4. Tests sandbox — numéros préprogrammés MTN

| Numéro | Résultat simulé |
|---|---|
| `46733123450` | Échec (payer failed) |
| `46733123451` | Refusé par le payeur |
| `46733123452` | Expiré |
| `46733123453` | Toujours en attente (ongoing) |
| `46733123454` | Retardé |
| `46733123455` | Introuvable / fonds insuffisants (transfert) |
| `46733123456` | Plafond atteint (transfert) |
| **tout autre numéro** | ✅ Succès |

Devise sandbox : **EUR**. Environnement cible : `sandbox`.

---

## 5. Implémentation technique (référence rapide)

| Fichier | Rôle |
|---|---|
| `src/services/momo.ts` | Client MTN officiel : tokens OAuth (cache), Request to Pay, Transfer, Refund, soldes, validation MSISDN E.164, normalisation d'erreurs FR |
| `src/services/payment.ts` | Provider `MTN_MOMO` réel + polling public + remboursements + vue d'ensemble |
| `src/app/api/payments/momo/status` | Polling public (rate limit 15/min/IP) |
| `src/app/api/webhooks/momo` | Callback officiel MTN (POST/PUT, re-vérifié par GET, rate limit 60/min) |
| `src/app/api/admin/payments/[id]/refund` | POST initier / GET suivre un remboursement (`payment:manage`, 10/min) |
| `src/app/api/admin/momo/overview` | Configuration + soldes (`finance:read`) |

Aucune modification du schéma Prisma : l'état MoMo vit dans
`Payment.providerTransactionId` (UUID X-Reference-Id) + `Payment.metadata` (JSON),
et l'écriture comptable `Transaction { type: "REFUND" }`.
