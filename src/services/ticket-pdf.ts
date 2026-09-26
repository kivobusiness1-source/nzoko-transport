// ============================================================
// OCÉAN DU NORD — Billet PDF (V3)
// Génération A4 imprimable avec pdf-lib (serverless-friendly) :
// logo, passager, voyage, agence (adresse), siège, montant,
// statut paiement, numéro d'embarquement, QR code, instructions,
// conditions. Le token reste le seul secret exposé.
// ============================================================

import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { formatDateTime } from "@/lib/format";

// Palette Océan du Nord (cohérente avec l'UI Tailwind)
const INK = rgb(0.09, 0.11, 0.14); // #171C22
const MUTED = rgb(0.42, 0.45, 0.5);
const PRIMARY = rgb(0.05, 0.45, 0.36); // vert Océan du Nord
const PRIMARY_LIGHT = rgb(0.91, 0.96, 0.94);
const LINE = rgb(0.85, 0.87, 0.89);
const DANGER = rgb(0.75, 0.15, 0.12);
const WHITE = rgb(1, 1, 1);

let logoCache: Uint8Array | null = null;
async function loadLogo(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "public", "icons", "icon-192.png")));
    return logoCache;
  } catch {
    return null; // logo optionnel — le PDF reste valide sans
  }
}

function money(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}

const PAYMENT_LABELS: Record<string, string> = {
  MTN_MOMO: "MTN Mobile Money",
  AIRTEL_MONEY: "Airtel Money",
  CASH: "Espèces (guichet)",
  CARD: "Carte bancaire",
  BANK_TRANSFER: "Virement bancaire",
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En cours",
  SUCCESS: "PAYÉ",
  FAILED: "Échoué",
  CANCELLED: "Annulé",
  REFUNDED: "Remboursé",
};
const TICKET_STATUS_LABELS: Record<string, string> = {
  VALID: "VALIDE",
  USED: "UTILISÉ",
  CANCELLED: "ANNULÉ",
};

function label(font: PDFFont, text: string, x: number, y: number, size = 8, color = MUTED): void {
  pageDrawText(font, text.toUpperCase(), x, y, size, color);
}
let currentPage: PDFPage | null = null;
function pageDrawText(font: PDFFont, text: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>): void {
  currentPage?.drawText(sanitize(text), { x, y, size, font, color });
}
// WinAnsi ne connaît pas certains caractères → substitution sûre
function sanitize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\x7F\u00C0-\u00FF]/g, "");
}

/**
 * Génère le PDF A4 du billet. Accès par token (secret du billet) —
 * aucune donnée sensible n'est incluse au-delà de ce qui figure sur le
 * billet imprimé remis au passager.
 */
export async function renderTicketPdf(token: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const ticket = await db.ticket.findUnique({
    where: { token },
    include: {
      booking: {
        include: {
          trip: {
            include: {
              route: { include: { originCity: true, destinationCity: true } },
              bus: true,
              agency: true,
            },
          },
          seat: true,
          passenger: true,
          agency: true,
          payment: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });

  if (!ticket || !ticket.booking) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Billet introuvable.");
  }

  const b = ticket.booking;
  const trip = b.trip;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Billet ${b.bookingReference} — Océan du Nord`);
  pdf.setAuthor("Océan du Nord");
  pdf.setCreator("Océan du Nord — plateforme officielle");

  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  currentPage = page;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.CourierBold);

  const M = 40; // marge
  const W = page.getWidth() - M * 2;

  // ---------- Bandeau supérieur ----------
  page.drawRectangle({ x: 0, y: page.getHeight() - 92, width: page.getWidth(), height: 92, color: PRIMARY });
  const logoBytes = await loadLogo();
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try {
      logo = await pdf.embedPng(logoBytes);
    } catch {
      logo = null;
    }
  }
  if (logo) {
    page.drawImage(logo, { x: M, y: page.getHeight() - 74, width: 44, height: 44 });
  }
  pageDrawText(bold, "OCÉAN DU NORD", x0(logo), page.getHeight() - 56, 20, WHITE);
  pageDrawText(font, "Compagnie de transport interurbain — Congo-Brazzaville", x0(logo), page.getHeight() - 72, 9, rgb(0.88, 0.96, 0.93));
  pageDrawText(font, "BILLET ÉLECTRONIQUE / BOARDING PASS", M, page.getHeight() - 108, 10, PRIMARY);

  function x0(l: PDFImage | null): number {
    return l ? M + 56 : M;
  }

  // ---------- Statut ----------
  const statusLabel = TICKET_STATUS_LABELS[ticket.status] ?? ticket.status;
  const statusColor = ticket.status === "VALID" ? PRIMARY : ticket.status === "USED" ? MUTED : DANGER;
  page.drawRectangle({ x: page.getWidth() - M - 110, y: page.getHeight() - 126, width: 110, height: 22, color: statusColor });
  pageDrawText(bold, statusLabel, page.getWidth() - M - 100, page.getHeight() - 120, 11, WHITE);

  // ---------- Bloc principal : trajet ----------
  let y = page.getHeight() - 160;
  page.drawRectangle({ x: M, y: y - 132, width: W, height: 140, color: PRIMARY_LIGHT });
  label(font, "Départ", M + 16, y - 14);
  pageDrawText(bold, trip.route.originCity.name, M + 16, y - 40, 17, INK);
  label(font, "Destination", M + 200, y - 14);
  pageDrawText(bold, trip.route.destinationCity.name, M + 200, y - 40, 17, INK);
  label(font, "Date et heure de départ", M + 380, y - 14);
  pageDrawText(bold, formatDateTime(trip.departureTime), M + 380, y - 40, 11, INK);
  pageDrawText(font, "→", M + 160, y - 40, 16, PRIMARY);

  const row2 = y - 76;
  label(font, "Voyage", M + 16, row2);
  pageDrawText(font, `${trip.code} · ${trip.route.originCity.name} → ${trip.route.destinationCity.name}`, M + 16, row2 - 16, 10, INK);
  label(font, "Bus", M + 200, row2);
  pageDrawText(font, `${trip.bus.registrationNumber} (${trip.bus.brand} ${trip.bus.model})`, M + 200, row2 - 16, 10, INK);
  label(font, "Siège", M + 380, row2);
  pageDrawText(bold, `N° ${b.seat.seatNumber} (${b.seat.type})`, M + 380, row2 - 16, 11, INK);

  // ---------- Passager ----------
  y -= 160;
  label(font, "Passager", M, y);
  pageDrawText(bold, `${b.passenger.firstName} ${b.passenger.lastName}`, M, y - 18, 14, INK);
  label(font, "Téléphone", M + 200, y);
  pageDrawText(font, b.passenger.phone, M + 200, y - 18, 11, INK);
  label(font, "Référence réservation", M + 380, y);
  pageDrawText(bold, b.bookingReference, M + 380, y - 18, 11, INK);

  // ---------- Agence de départ ----------
  y -= 60;
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: page.getWidth() - M, y: y + 12 }, thickness: 0.7, color: LINE });
  const depAgency = b.agency ?? trip.agency;
  label(font, "Agence de départ (présentez-vous ici)", M, y - 8);
  pageDrawText(bold, depAgency.name, M, y - 26, 12, INK);
  const agencyLine = [depAgency.address, depAgency.phone ? `Tél. ${depAgency.phone}` : null]
    .filter(Boolean)
    .join(" · ");
  pageDrawText(font, agencyLine, M, y - 42, 9, MUTED);
  if (depAgency.openingTime && depAgency.closingTime) {
    pageDrawText(font, `Horaires : ${depAgency.openingTime} — ${depAgency.closingTime}`, M, y - 56, 9, MUTED);
  }

  // ---------- Paiement ----------
  y -= 84;
  const mainPayment = b.payment.find((p) => p.status === "SUCCESS") ?? b.payment[0] ?? null;
  label(font, "Montant", M, y);
  pageDrawText(bold, money(b.amount), M, y - 20, 14, INK);
  label(font, "Paiement", M + 160, y);
  pageDrawText(
    font,
    mainPayment
      ? `${PAYMENT_LABELS[mainPayment.provider] ?? mainPayment.provider} — ${PAYMENT_STATUS_LABELS[mainPayment.status] ?? mainPayment.status}`
      : "À régler",
    M + 160,
    y - 20,
    10,
    mainPayment?.status === "SUCCESS" ? PRIMARY : INK
  );
  label(font, "Numéro d'embarquement", M + 380, y);
  pageDrawText(mono, ticket.boardingNumber ?? "—", M + 380, y - 22, 14, PRIMARY);

  // ---------- QR + instructions ----------
  y -= 64;
  page.drawLine({ start: { x: M, y: y + 10 }, end: { x: page.getWidth() - M, y: y + 10 }, thickness: 0.7, color: LINE });
  const qrPng = await QRCode.toBuffer(ticket.token, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  const qrImage = await pdf.embedPng(new Uint8Array(qrPng));
  const qrSize = 118;
  page.drawImage(qrImage, { x: M, y: y - qrSize - 26, width: qrSize, height: qrSize });
  pageDrawText(font, "Scannez ce QR au contrôle", M + 8, y - qrSize - 40, 7.5, MUTED);

  const ix = M + qrSize + 24;
  label(font, "Instructions d'embarquement", ix, y - 6);
  const instructions = [
    "Présentez-vous à l'agence de départ au moins 30 minutes avant le départ.",
    "Gardez ce billet (imprimé ou sur téléphone) : le QR code fait foi à l'embarquement.",
    "En cas de téléphone déchargé, communiquez votre numéro d'embarquement au contrôleur.",
    "Le QR ne peut être utilisé qu'une seule fois : toute réutilisation est détectée.",
  ];
  let iy = y - 24;
  for (const line of instructions) {
    wrapText(font, `• ${line}`, ix, iy, page.getWidth() - M - ix, 9, INK, 12);
    iy -= 22;
  }

  // ---------- Conditions ----------
  y = 150;
  label(font, "Conditions importantes", M, y);
  const conditions = [
    "Billet nominatif, non cessible sans accord de l'agence émettrice.",
    "Annulation possible avant le départ via « Suivi billet » ; remboursement selon le moyen de paiement d'origine.",
    "La compagnie décline toute responsabilité pour les retards dus à des causes externes (état des routes, contrôles).",
    "Franchise bagages : 1 bagage à main (10 kg) + 1 bagage en soute (30 kg).",
    "En cas de litige, la référence de réservation et le numéro d'embarquement font foi.",
  ];
  let cy = y - 18;
  for (const line of conditions) {
    wrapText(font, `• ${line}`, M, cy, W, 8, MUTED, 10.5);
    cy -= 13;
  }

  // ---------- Pied de page ----------
  page.drawLine({ start: { x: M, y: 64 }, end: { x: page.getWidth() - M, y: 64 }, thickness: 0.7, color: LINE });
  pageDrawText(font, "Océan du Nord — Pointe-Noire · Brazzaville · Dolisie · Nkayi · Ouesso", M, 50, 8, MUTED);
  pageDrawText(font, `Émis le ${formatDateTime(ticket.issuedAt)} — Document généré électroniquement.`, M, 38, 8, MUTED);
  pageDrawText(mono, b.bookingReference, page.getWidth() - M - 150, 50, 10, MUTED);

  currentPage = null;
  const bytes = await pdf.save();
  return {
    bytes,
    fileName: `nzoko-billet-${b.bookingReference}.pdf`,
  };
}

/** Texte multi-lignes simple (largeur max en points). */
function wrapText(
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  color: ReturnType<typeof rgb>,
  lineHeight: number
): void {
  const words = sanitize(text).split(" ");
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      pageDrawText(font, line, x, cursorY, size, color);
      cursorY -= lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) pageDrawText(font, line, x, cursorY, size, color);
}
