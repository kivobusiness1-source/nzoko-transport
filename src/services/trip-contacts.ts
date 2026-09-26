// ============================================================
// OCÉAN DU NORD — Contacts passagers d'un voyage annulé
// Objectif : permettre à l'agence de PRÉVENIR chaque client
// (WhatsApp wa.me pré-rempli en français, ou appel tel:) et de
// traiter les remboursements des billets payés.
//
// Sécurité :
//  - accès réservé trip:manage + scope agence (route API),
//    consultation journalisée (données personnelles) ;
//  - aucun secret ici : seules des données de voyage/réservation ;
//  - URLs wa.me/tel: construites côté serveur (E.164 vérifié +
//    texte encodeURIComponent) — jamais de HTML.
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import type { BookingStatus } from "@/lib/constants";
import type { TripContactPassengerDTO, TripContactsDTO, TripContactPaymentState } from "@/types";

// ------------------------------------------------------------
// Normalisation téléphone « douce » (ne lève jamais) :
// 06 123 45 67 → 24261234567 ; +242… / 00 242… → 242…
// Retourne un E.164 SANS « + » (format wa.me) ou null si
// le numéro est inexploitable. Les numéros étrangers valides
// (10–15 chiffres) passent tels quels.
// ------------------------------------------------------------
function normalizePhoneSoft(raw: string): string | null {
  if (!raw) return null;
  let v = raw.replace(/[\s.\-()]/g, "");
  if (v.startsWith("00")) v = v.slice(2);
  if (v.startsWith("+")) v = v.slice(1);
  if (v.length === 0) return null;
  if (!v.startsWith("242")) {
    if (v.startsWith("0")) v = "242" + v.slice(1);
    else if (/^\d{8,9}$/.test(v)) v = "242" + v; // numéro local sans le 0
  }
  return /^\d{10,15}$/.test(v) ? v : null;
}

// ------------------------------------------------------------
// Date « jj/mm/aaaa à HH:MM » au fuseau Congo (UTC+1 fixe,
// sans DST — aucun Intl requis côté serveur).
// ------------------------------------------------------------
function fmtCongoFr(d: Date): string {
  const t = new Date(d.getTime() + 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} à ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function formatMoneyXaf(amount: number): string {
  // Formateur manuel (espace insécable fine «  ») — 100 % portable,
  // sans dépendre des données ICU de l'environnement d'exécution.
  const s = String(amount);
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return `${parts.join(" ")} FCFA`;
}

// ------------------------------------------------------------
// Statut de remboursement d'une réservation, dérivé des
// paiements réels (jamais de la mémoire du client) :
//   REFUNDED ≥ un paiement REFUNDED ;
//   PAID     ≥ un paiement SUCCESS (non remboursé) ;
//   UNPAID   sinon (rien / en cours / échoué).
// ------------------------------------------------------------
type PaymentLite = { status: string; createdAt: Date };

function paymentStateOf(payments: PaymentLite[]): TripContactPaymentState {
  if (payments.some((p) => p.status === "REFUNDED")) return "REFUNDED";
  if (payments.some((p) => p.status === "SUCCESS")) return "PAID";
  return "UNPAID";
}

const ORDER: Record<TripContactPaymentState, number> = { PAID: 0, UNPAID: 1, REFUNDED: 2 };

// ------------------------------------------------------------
// Message WhatsApp pré-rempli, personnalisé par passager.
// ------------------------------------------------------------
function buildContactMessage(input: {
  firstName: string;
  origin: string;
  destination: string;
  departureFr: string;
  reference: string;
  seatLabel: string | null;
  amount: number;
  paymentState: TripContactPaymentState;
  agencyName: string;
  agencyPhone: string | null;
}): string {
  const refundLine =
    input.paymentState === "PAID"
      ? `Un remboursement de ${formatMoneyXaf(input.amount)} sera effectué sur votre compte Mobile Money.`
      : input.paymentState === "REFUNDED"
        ? `Votre remboursement de ${formatMoneyXaf(input.amount)} a déjà été effectué.`
        : "Aucun montant n'a été débité de votre compte.";

  const contactLine = input.agencyPhone
    ? `Renseignements : ${input.agencyName} au ${input.agencyPhone}.`
    : "Renseignements : votre agence Océan du Nord.";

  return (
    `Bonjour ${input.firstName}, Océan du Nord vous informe que votre voyage ` +
    `${input.origin} → ${input.destination} du ${input.departureFr} ` +
    `(réservation ${input.reference}${input.seatLabel ? `, siège ${input.seatLabel}` : ""}) a été annulé. ` +
    `${refundLine} Nous vous prions de nous excuser pour la gêne occasionnée. ${contactLine} — OCÉAN DU NORD`
  );
}

// ------------------------------------------------------------
// API publique : liste de contacts d'un voyage (annulé ou sur
// le point de l'être). Les réservations passagers-annulées ne
// sont incluses QUE si le voyage est déjà annulé (elles ont été
// basculées automatiquement par l'annulation).
// ------------------------------------------------------------
export async function getTripCancellationContacts(tripId: string): Promise<TripContactsDTO> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      route: { include: { originCity: true, destinationCity: true } },
      agency: true,
      bus: true,
    },
  });
  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");

  const isCancelled = trip.status === "CANCELLED";
  const bookingStatuses: BookingStatus[] = isCancelled
    ? ["PENDING", "CONFIRMED", "CANCELLED"]
    : ["PENDING", "CONFIRMED"];

  const bookings = await db.booking.findMany({
    where: { tripId, status: { in: bookingStatuses } },
    include: {
      passenger: true,
      seat: true,
      payment: { select: { status: true, createdAt: true }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { bookingReference: "asc" },
  });

  const departureFr = fmtCongoFr(trip.departureTime);
  const origin = trip.route.originCity.name;
  const destination = trip.route.destinationCity.name;

  const contacts: TripContactPassengerDTO[] = bookings.map((b) => {
    const paymentState = paymentStateOf(b.payment);
    const phoneE164 = normalizePhoneSoft(b.passenger.phone ?? "");
    const seatLabel = b.seat?.seatNumber ?? null;

    const message = buildContactMessage({
      firstName: b.passenger.firstName,
      origin,
      destination,
      departureFr,
      reference: b.bookingReference,
      seatLabel,
      amount: b.amount,
      paymentState,
      agencyName: trip.agency.name,
      agencyPhone: trip.agency.phone ?? null,
    });

    return {
      bookingId: b.id,
      bookingReference: b.bookingReference,
      bookingStatus: b.status as BookingStatus,
      passengerName: `${b.passenger.firstName} ${b.passenger.lastName}`.trim(),
      phoneE164,
      rawPhone: b.passenger.phone ?? "",
      seatLabel,
      amount: b.amount,
      paymentState,
      whatsappUrl: phoneE164 ? `https://wa.me/${phoneE164}?text=${encodeURIComponent(message)}` : null,
      telUrl: phoneE164 ? `tel:+${phoneE164}` : null,
    };
  });

  // Priorité aux remboursements à traiter (PAID), puis non payés, puis déjà remboursés.
  contacts.sort((a, b) => ORDER[a.paymentState] - ORDER[b.paymentState]);

  const paid = contacts.filter((c) => c.paymentState === "PAID");
  const refunded = contacts.filter((c) => c.paymentState === "REFUNDED");
  const unpaid = contacts.filter((c) => c.paymentState === "UNPAID");

  const contactLine = trip.agency.phone
    ? `Merci de contacter l'agence ${trip.agency.name} au ${trip.agency.phone}.`
    : "Merci de contacter votre agence Océan du Nord.";

  const broadcastMessage =
    `Bonjour, Océan du Nord informe les passagers du voyage ${trip.code} ` +
    `${origin} → ${destination} du ${departureFr} que ce départ a été annulé. ` +
    `Les passagers ayant réglé leur billet seront remboursés sur leur compte Mobile Money. ` +
    `${contactLine} Nous présentons nos excuses pour la gêne occasionnée. — OCÉAN DU NORD`;

  return {
    trip: {
      id: trip.id,
      code: trip.code,
      originCityName: origin,
      destinationCityName: destination,
      departureTime: trip.departureTime.toISOString(),
      status: trip.status as TripContactsDTO["trip"]["status"],
      busRegistration: trip.bus.registrationNumber,
      agencyName: trip.agency.name,
      agencyPhone: trip.agency.phone ?? null,
    },
    contacts,
    summary: {
      total: contacts.length,
      paid: paid.length,
      refunded: refunded.length,
      unpaid: unpaid.length,
      refundDue: paid.reduce((sum, c) => sum + c.amount, 0),
      withPhone: contacts.filter((c) => c.phoneE164 !== null).length,
    },
    broadcastMessage,
  };
}
