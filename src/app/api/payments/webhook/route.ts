// POST /api/payments/webhook — contrat API centrale §11 : webhook de paiement.
// Trois canaux authentifiés, dispatchés automatiquement :
//  1. Callback MTN MoMo officiel (non signé → JAMAIS pris sur parole :
//     re-vérification systématique GET requesttopay) ;
//  2. Webhook fournisseur interne signé HMAC (X-Nzoko-Signature) ;
//  3. Appel service-à-serveur du SITE AGENCES (Bearer CENTRAL_API_SECRET) —
//     les agents de guichet déclarent un encaissement : même exigence
//     d'idempotence, un doublon ne crée JAMAIS deux tickets (§11/§16).
//
// Idempotence garantie par confirmPaymentAndIssueTicket (payment SUCCESS
// re-confirmé = no-op ; providerTransactionId unique côté base).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES, isServiceAuth } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { handleMomoWebhook, handlePaymentWebhook } from "@/services/payment";
import { toPaymentDTO } from "@/services/payment-mappers";
import { db } from "@/lib/db";
import { z } from "zod";

const serviceSchema = z.object({
  bookingId: z.string().trim().min(1, "Réservation requise."),
  provider: z.enum(["MTN_MOMO", "AIRTEL_MONEY", "CASH", "CARD", "BANK_TRANSFER"], "Mode de paiement invalide."),
  providerTransactionId: z.string().trim().min(4).max(120),
  amount: z.number().int().positive("Montant invalide."),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    enforceRateLimit(`paywebhook:${ip}`, RATE_LIMITS.momoWebhook.limit, RATE_LIMITS.momoWebhook.windowMs);

    const rawBody = await req.text();
    const signature = req.headers.get("x-nzoko-signature");

    // 1) Webhook interne signé HMAC → chemin historique.
    if (signature) {
      const result = await handlePaymentWebhook(rawBody, signature, ip);
      return ok(result);
    }

    // Parsing JSON sûr (corps potentiellement invalide — webhook externe).
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }

    // 2) Callback MoMo (POST sans signature, corps referenceId/status).
    if (parsed && typeof parsed === "object" && "referenceId" in (parsed as Record<string, unknown>)) {
      const result = await handleMomoWebhook(rawBody, ip);
      return ok(result);
    }

    // 3) Service-à-service (SITE AGENCES) : déclaration d'encaissement
    //    (ex. CASH guichet) → paiement créé PUIS confirmé idempotemment.
    if (isServiceAuth(req)) {
      const payload = serviceSchema.parse(parsed);
      // Identifiant souple : id interne OU référence publique NZK-2026-… (§3.7).
      const isRef = payload.bookingId.startsWith("NZK-");
      const booking = await db.booking.findUnique({
        where: isRef ? { bookingReference: payload.bookingId } : { id: payload.bookingId },
        include: { payment: true },
      });
      if (!booking) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable.");
      if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette réservation ne peut plus être payée.");
      }
      // Idempotence : providerTransactionId @unique — un doublon du MÊME
      // booking renvoie le paiement existant (no-op idempotent). Une référence
      // déjà utilisée par UNE AUTRE réservation est rejetée (409) : jamais de
      // confirmation croisée entre réservations.
      const existing = await db.payment.findUnique({ where: { providerTransactionId: payload.providerTransactionId } });
      if (existing && existing.bookingId !== booking.id) {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Référence de transaction déjà utilisée pour une autre réservation.");
      }
      // §11 — une réservation DÉJÀ PAYÉE ne peut pas l'être une seconde fois :
      //   • replay du MÊME encaissement (même providerTransactionId, déjà
      //     SUCCESS) → réponse idempotente duplicate:true ;
      //   • NOUVELLE référence de transaction sur une réservation confirmée
      //     → 409. Jamais 2 paiements SUCCESS / 2 écritures comptables pour
      //     la même réservation (le billet, lui, reste unique de toute façon).
      if (booking.status === "CONFIRMED") {
        const confirmed = booking.payment.find((p) => p.status === "SUCCESS");
        if (existing && confirmed && existing.id === confirmed.id) {
          const full = await db.payment.findUnique({
            where: { id: confirmed.id },
            include: { booking: true, createdBy: true },
          });
          if (full) return ok({ received: true, duplicate: true, payment: toPaymentDTO(full) }, 200);
        }
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette réservation est déjà payée — un seul encaissement possible.");
      }
      const payment =
        existing ??
        (await db.payment.create({
          data: {
            bookingId: booking.id,
            provider: payload.provider,
            providerTransactionId: payload.providerTransactionId,
            amount: payload.amount,
            status: "PENDING",
          },
        }));
      if (payment.amount !== payload.amount) {
        throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Montant divergent — paiement bloqué.");
      }
      if (payload.amount !== booking.amount) {
        throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, `Montant attendu ${booking.amount} XAF (reçu ${payload.amount}).`);
      }
      const { confirmPaymentAndIssueTicket } = await import("@/services/payment");
      const { payment: dto, alreadyConfirmed } = await confirmPaymentAndIssueTicket(payment.id, null, ip);
      return ok({ received: true, duplicate: alreadyConfirmed, payment: dto }, alreadyConfirmed ? 200 : 201);
    }

    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Webhook non authentifié (signature ou Bearer requis).");
  } catch (err) {
    return routeError(err, "POST /api/payments/webhook");
  }
}
