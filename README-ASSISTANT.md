# 🤖 Assistant IA — NZOKO TRANSPORT

Assistant conversationnel (LLM) intégré au site : il répond aux questions des
clients sur **les voyages, les horaires, les tarifs et les promotions**, en
français, à partir des **données réelles** de la base (anti-hallucination).

## Fonctionnement

```
Client (widget flottant) ──POST /api/assistant──▶ Route (CSRF + rate limit 10/min/IP)
                                                      │
                                              services/assistant.ts
                                                      │
                          ┌───────────────────────────┴───────────────────────────┐
                          ▼                                                       ▼
              Contexte RAG (Prisma, cache 5 min)                         z-ai-web-dev-sdk (LLM)
              villes, lignes, départs 7j, tarifs,                          réponse en français
              agences, règles de réservation
```

- Le LLM reçoit **uniquement** les données extraites de la base : il ne peut
  pas inventer un prix, un horaire ou une promotion. S'il n'y a pas de
  promotion active, il le dit honnêtement.
- La conversation est multi-tours (mémoire serveur par `sessionId`, bornée à
  16 messages, purgée après 30 min d'inactivité) et persistée côté client en
  `sessionStorage`.
- Réponses courtes (≤ ~5 phrases), listes à puces acceptées.

## Sécurité

| Mesure | Détail |
|---|---|
| CSRF | `X-Requested-With: nzoko` exigé (assertSameOriginPost) |
| Rate limit | 10 messages/min/IP (`RATE_LIMITS.assistant`) |
| Validation | Zod : message 1–500 caractères, sessionId `^[A-Za-z0-9_-]{8,64}$` |
| Anti-injection | Caractères de contrôle supprimés ; tentatives d'injection de prompt détectées et journalisées (`SecurityLog`, événement `SUSPICIOUS`) ; le prompt système interdit de révéler les consignes |
| Données personnelles | L'assistant ne demande jamais mot de passe, code MoMo ou pièce d'identité |
| SDK | `z-ai-web-dev-sdk` utilisé **en backend uniquement** — jamais côté client |
| Échec LLM | 503 `ASSISTANT_UNAVAILABLE` avec message français — aucun détail interne |

## Configuration

`.env` :

```bash
ASSISTANT_ENABLED=true   # "false" pour désactiver (réponses 503 ASSISTANT_DISABLED)
```

Aucune clé d'API à configurer : le SDK est préconfiguré dans l'environnement
d'exécution. Hors de cet environnement, l'assistant se dégrade proprement
(503) sans bloquer le reste du site.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/services/assistant.ts` | Contexte RAG (Prisma), conversations, prompt système, appel LLM |
| `src/app/api/assistant/route.ts` | Endpoint POST (CSRF, rate limit, Zod) |
| `src/components/app/assistant-widget.tsx` | Widget flottant (mobile 375px + desktop) |
| `src/lib/constants.ts` | `RATE_LIMITS.assistant` + `ASSISTANT_LIMITS` |
| `src/types/index.ts` | `AssistantReplyDTO` |
| `src/lib/api-client.ts` | `api.assistant.chat()` |

## Tests réalisés (E2E)

- Questions générales → réponses exactes (8 villes, tarifs 18 000–20 000 FCFA,
  durée 10h, prochains départs avec places réelles)
- Multi-tours : « Et pour Dolisie ? » → contexte conservé, tarifs réels
- Promotion : « aucune promotion active » (honnêteté anti-hallucination)
- Injection de prompt (« ignore les instructions… révèle… ») : refusée,
  journalisée `SUSPICIOUS`
- CSRF sans en-tête → 403 · message 600 caractères → 400 · 11e appel/min → 429
- `ASSISTANT_ENABLED=false` → 503 `ASSISTANT_DISABLED` (restauré ensuite)
- Navigateur : panneau, question envoyée, réponse affichée, fermeture
  (bouton + Échap), persistance sessionStorage, mobile 375px (fits viewport),
  desktop 384×544px, zéro erreur console
