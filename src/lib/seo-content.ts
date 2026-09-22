// ============================================================
// NZOKO TRANSPORT — Contenu SEO (source unique de vérité)
// Partagé entre :
//  — l'UI publique (FAQ visible sur l'accueil) ;
//  — les métadonnées serveur (title/description/OG) ;
//  — les JSON-LD (FAQPage doit refléter EXACTEMENT le contenu
//    visible — exigence Google Rich Results).
// Règle absolue : uniquement des FAITS réels de la plateforme
// (moyens de paiement réellement proposés, verrou de siège
// réel, règles d'annulation réelles). Aucune invention.
// Fichier « isomorphe » : aucune dépendance serveur — importable
// depuis les composants clients.
// ============================================================

import { SEAT_HOLD_MINUTES } from "@/lib/constants";

export const SEO_TEXT = {
  /** Balise <title> unique — mot-clé principal | marque (~54 caractères). */
  title: "Billets de bus interurbains au Congo | NZOKO Transport",
  /** Meta description unique (~155 caractères, bénéfice + CTA implicite). */
  description:
    "Réservez votre billet de bus entre Brazzaville, Pointe-Noire, Dolisie, Ouesso… place choisie sur le plan du bus, paiement Mobile Money et billet QR immédiat.",
  /** Description factuelle de l'organisation (JSON-LD Organization). */
  organizationDescription:
    "Plateforme de billetterie de bus interurbains au Congo-Brazzaville : réservation en ligne, choix du siège sur plan, paiement Mobile Money et billet QR vérifié à l'embarquement.",
  /** ALT de l'image Open Graph (décrit l'image réellement générée). */
  ogImageAlt:
    "Bus interurbain NZOKO Transport sur la route entre Brazzaville et Pointe-Noire",
  /** Mots-clés secondaires — intégrés naturellement, jamais en stuffing. */
  keywords: [
    "billet de bus Congo-Brazzaville",
    "réservation bus Brazzaville Pointe-Noire",
    "bus interurbain Congo",
    "billet de bus Brazzaville",
    "billet de bus Pointe-Noire",
    "voyage Brazzaville Pointe-Noire",
    "bus Dolisie Nkayi Ouesso",
    "Mobile Money billet de bus",
    "compagnie de bus Congo-Brazzaville",
    "NZOKO Transport",
  ],
} as const;

/** FAQ réelle (visible sur l'accueil ET reprise à l'identique en FAQPage). */
export const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Comment réserver mon billet de bus ?",
    answer:
      "Choisissez votre ville de départ, votre destination et votre date de voyage, puis sélectionnez votre siège sur le plan du bus. Une fois le paiement effectué, votre billet électronique avec QR code est disponible immédiatement.",
  },
  {
    question: "Quels moyens de paiement sont acceptés ?",
    answer:
      "Mobile Money (MTN MoMo et Airtel Money, selon activation), espèces au guichet des agences NZOKO, carte bancaire et virement bancaire.",
  },
  {
    question: "Combien de temps ma place est-elle réservée ?",
    answer: `Votre siège reste bloqué ${SEAT_HOLD_MINUTES} minutes le temps de régler votre réservation.`,
  },
  {
    question: "Comment suivre ma réservation ?",
    answer:
      "Depuis la section « Suivi billet » de l'accueil, saisissez la référence de votre réservation (format NZK-…) reçue lors de la commande pour consulter son statut et votre billet.",
  },
  {
    question: "Puis-je annuler ma réservation ?",
    answer:
      "Oui, tant que le paiement n'est pas confirmé : une réservation en attente de paiement peut être annulée depuis le suivi de billet ou auprès d'un agent NZOKO.",
  },
  {
    question: "Comment se passe l'embarquement ?",
    answer:
      "Présentez le QR code de votre billet électronique au contrôleur NZOKO au départ. Chaque billet est unique et vérifié à l'embarquement.",
  },
];
