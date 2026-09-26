"use client";

// ============================================================
// Océan du Nord — Panneau détail d'une réservation (suivi public + guichet agent)
// Timeline : réservée → payée → billet émis → embarquée
// ============================================================

import { Bus, Calendar, CheckCircle2, Clock, CreditCard, MapPin, Phone, Ticket as TicketIcon, User, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/shared/nzoko-badge";
import { NzokoCopyButton } from "@/components/shared/nzoko-copy-button";
import { NzokoQr } from "@/components/shared/nzoko-qr";
import { PAYMENT_PROVIDER_LABELS } from "@/lib/constants";
import type { BookingDetailDTO } from "@/types";
import { arrivesNextDay } from "@/lib/dates";
import { formatDateTime, formatMoney, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface NzokoBookingDetailProps {
  detail: BookingDetailDTO;
  /** Affiche le bouton d'annulation (le parent gère l'appel API) */
  onCancel?: () => void;
  cancelLoading?: boolean;
  className?: string;
}

// ------------------------------------------------------------
// Embarquement PAR PLACE (contrat §6.1) — même règle de repli que l'API :
// données par place font foi ; fallback héritage (ticket USED) UNIQUEMENT
// si AUCUNE place n'est datée (groupe embarqué avant l'extension).
// ------------------------------------------------------------

function seatBoarded(detail: BookingDetailDTO, boardedAt: string | null): boolean {
  if (boardedAt !== null) return true;
  if (detail.ticket?.status !== "USED") return false;
  return !(detail.seats ?? []).some((s) => s.boardedAt !== null);
}

/** Liste des voyageurs du groupe avec leur statut d'embarquement individuel. */
function BoardingRoster({ detail }: { detail: BookingDetailDTO }) {
  const showBoarding = detail.ticket !== null && detail.ticket.status !== "CANCELLED";
  return (
    <ul className="space-y-1" aria-label="Voyageurs et embarquement">
      {(detail.seats ?? []).map((s) => {
        const boarded = seatBoarded(detail, s.boardedAt);
        const isBuyer =
          s.passenger?.firstName === detail.passenger.firstName &&
          s.passenger?.lastName === detail.passenger.lastName;
        return (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors",
              boarded ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "bg-background"
            )}
          >
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[11px] font-bold",
                boarded ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"
              )}
            >
              {s.seatNumber}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium" title={`${s.passenger?.firstName ?? ""} ${s.passenger?.lastName ?? ""}`}>
              {s.passenger?.firstName} {s.passenger?.lastName}
              {isBuyer && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(acheteur·e)</span>}
            </span>
            {showBoarding &&
              (boarded ? (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  À bord{s.boardedAt ? ` ${formatTime(s.boardedAt)}` : ""}
                  <span className="sr-only"> — passager embarqué</span>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden />
                  En attente
                  <span className="sr-only"> — passager non encore embarqué</span>
                </span>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

function Timeline({ detail }: { detail: BookingDetailDTO }) {
  const paid =
    detail.payments.some((p) => p.status === "SUCCESS") ||
    detail.status === "CONFIRMED" ||
    detail.status === "COMPLETED";
  const ticketIssued = detail.ticket !== null && detail.ticket.status !== "CANCELLED";
  // Embarquée = TOUTES les places à bord (§6.1, même repli que l'API).
  const boarded = detail.ticket?.status === "USED" && (detail.seats ?? []).every((s) => seatBoarded(detail, s.boardedAt));
  const dead = detail.status === "CANCELLED" || detail.status === "EXPIRED";

  const steps = [
    { key: "reserved", label: "Réservée", done: true },
    { key: "paid", label: "Payée", done: paid },
    { key: "ticket", label: "Billet émis", done: ticketIssued },
    { key: "boarded", label: "Embarquée", done: boarded },
  ];
  // Embarquement partiel : badge « k/N à bord » sous l'étape 4 (§6.1).
  const groupSeats = detail.seats ?? [];
  const boardedCount = groupSeats.filter((s) => seatBoarded(detail, s.boardedAt)).length;
  const partialBoarding = ticketIssued && boardedCount > 0 && boardedCount < groupSeats.length;

  return (
    <ol className="flex items-start" aria-label="Progression de la réservation">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={s.key} className={cn("flex items-start", !isLast && "flex-1")}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold",
                  dead
                    ? "border-red-300 bg-red-50 text-red-500"
                    : s.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-zinc-300 bg-background text-zinc-400"
                )}
                aria-hidden
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "text-center text-[10px] leading-tight",
                  s.done ? "font-semibold text-foreground" : "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
              {s.key === "boarded" && partialBoarding && (
                <span
                  className={cn(
                    "rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
                    dead && "hidden"
                  )}
                >
                  {boardedCount}/{groupSeats.length} à bord
                </span>
              )}
              <span className="sr-only">{s.done ? "étape atteinte" : "étape non atteinte"}</span>
            </div>
            {!isLast && (
              <span
                className={cn(
                  "mx-1 mt-[11px] h-0.5 flex-1 self-start rounded",
                  s.done && steps[i + 1]?.done ? "bg-primary" : "bg-zinc-200"
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: typeof Bus; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm font-medium", mono && "font-mono")}>{value}</p>
      </div>
    </div>
  );
}

export function NzokoBookingDetail({ detail, onCancel, cancelLoading, className }: NzokoBookingDetailProps) {
  const canCancel =
    typeof onCancel === "function" && (detail.status === "PENDING" || detail.status === "CONFIRMED");

  return (
    <div className={cn("space-y-5", className)}>
      {/* Référence + statut */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold tracking-wide">{detail.bookingReference}</span>
          <NzokoCopyButton value={detail.bookingReference} label="Copier" size="sm" />
        </div>
        <BookingStatusBadge status={detail.status} />
      </div>

      {/* Timeline */}
      <div className="rounded-xl border bg-muted/30 px-4 py-4">
        <Timeline detail={detail} />
      </div>

      {/* Voyage */}
      <section aria-label="Voyage">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Voyage</h3>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="truncate">{detail.trip.originCityName}</span>
          <span className="text-primary" aria-hidden>→</span>
          <span className="truncate">{detail.trip.destinationCityName}</span>
        </div>
        <div className="mt-2 space-y-0">
          <InfoRow icon={Calendar} label="Départ" value={formatDateTime(detail.trip.departureTime)} />
          <InfoRow
            icon={Clock}
            label="Arrivée estimée"
            // Voyage de nuit traversant minuit → mention explicite du jour +1
            // (comparaison des JOURS CALENDAIRES Congo, via arrivesNextDay).
            value={
              arrivesNextDay(detail.trip.departureTime, detail.trip.estimatedArrivalTime)
                ? `${formatTime(detail.trip.estimatedArrivalTime)} (J+1)`
                : formatTime(detail.trip.estimatedArrivalTime)
            }
          />
          <InfoRow icon={Bus} label="Bus" value={`${detail.trip.busRegistration} · ${detail.trip.agencyName}`} />
        </div>
      </section>

      <Separator />

      {/* Passager + siège */}
      <section aria-label="Passager et siège">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {detail.seats && detail.seats.length > 1 ? "Passagers" : "Passager"}
        </h3>
        {detail.seats && detail.seats.length > 1 ? (
          // Multi-passagers nommés : chaque place porte SON voyageur (§24)
          // + statut d'embarquement individuel (§6.1, fallback ticket USED).
          <BoardingRoster detail={detail} />
        ) : (
          <InfoRow icon={User} label="Nom" value={`${detail.passenger.firstName} ${detail.passenger.lastName}`} />
        )}
        <InfoRow icon={Phone} label="Téléphone" value={detail.passenger.phone} />
        <InfoRow
          icon={TicketIcon}
          label={detail.seats && detail.seats.length > 1 ? "Places" : "Siège"}
          value={`${detail.seats.map((s) => s.seatNumber).join(", ")} (${detail.seat.type === "VIP" ? "VIP" : "Standard"})`}
        />
        {detail.dropOffNeighborhood && (
          <InfoRow icon={MapPin} label="Arrêt demandé" value={`${detail.dropOffNeighborhood.name} (${detail.dropOffNeighborhood.cityName})`} />
        )}
      </section>

      <Separator />

      {/* Paiements */}
      <section aria-label="Paiements">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paiement(s)</h3>
        {detail.payments.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="h-4 w-4" aria-hidden /> Aucun paiement enregistré.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{PAYMENT_PROVIDER_LABELS[p.provider]}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(p.createdAt)} · {formatMoney(p.amount)}</p>
                </div>
                <PaymentStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Billet + QR */}
      {detail.ticket && detail.ticket.status !== "CANCELLED" && (
        <>
          <Separator />
          <section aria-label="Billet électronique" className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <TicketIcon className="h-4 w-4 text-primary" aria-hidden /> Billet {detail.ticket.status === "USED" ? "utilisé" : "valide"}
            </p>
            {detail.ticket.status === "VALID" ? (
              <>
                <NzokoQr token={detail.ticket.token} size={132} />
                <p className="text-center text-xs text-muted-foreground">Présentez ce QR code au contrôleur à l&apos;embarquement.</p>
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {detail.ticket.checkedAt
                  ? `Utilisé le ${formatDateTime(detail.ticket.checkedAt)}${detail.ticket.checkedByName ? ` par ${detail.ticket.checkedByName}` : ""}.`
                  : "Billet utilisé."}
              </p>
            )}
          </section>
        </>
      )}

      {/* Annulation */}
      {canCancel && (
        <Button variant="destructive" className="w-full" onClick={onCancel} disabled={cancelLoading}>
          <XCircle className="h-4 w-4" aria-hidden />
          {cancelLoading ? "Annulation…" : "Annuler cette réservation"}
        </Button>
      )}
    </div>
  );
}
