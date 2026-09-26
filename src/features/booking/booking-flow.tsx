"use client";

// ============================================================
// Océan du Nord — Tunnel de réservation (LE CŒUR) : 6 étapes
// 1 Trajet → 2 Voyage → 3 Siège → 4 Passager → 5 Paiement → 6 Billet
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { CalendarSearch, ChevronLeft, Check, Search, Ticket, XCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentStep } from "@/features/booking/payment-step";
import { PassengerStep } from "@/features/booking/passenger-step";
import { SearchForm } from "@/features/booking/search-form";
import { AgencyFinder } from "@/features/booking/agency-finder";
import { SeatMap } from "@/features/booking/seat-map";
import { TicketCard } from "@/features/booking/ticket-card";
import { TripCard } from "@/features/booking/trip-card";
import { api, ApiClientError } from "@/lib/api-client";
import { addDaysStr, todayStr } from "@/lib/dates";
import { formatDayLabel, formatTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { BookingDTO, BookingDetailDTO, CityDTO, NearbyAgencyDTO, PassengerInput, SeatMapDTO, TripSearchDTO } from "@/types";
import { cn } from "@/lib/utils";

const STEPS = ["Trajet", "Voyage", "Siège", "Passager", "Paiement", "Billet"] as const;

const BACK_LABELS: Record<number, string> = {
  2: "Modifier la recherche",
  3: "Autre voyage",
  4: "Changer de siège",
  5: "Annuler et recommencer",
};

function errMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Une erreur est survenue.";
}

export default function BookingFlow({ channel }: { channel: "WEB" | "AGENT" }) {
  const bookingSearch = useApp((s) => s.bookingSearch);

  const [step, setStep] = useState<number>(1);
  const [search, setSearch] = useState<{ from: string; to: string; date: string }>(
    bookingSearch ?? { from: "", to: "", date: todayStr() }
  );

  const [cities, setCities] = useState<CityDTO[] | null>(null);
  const [trips, setTrips] = useState<TripSearchDTO[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Agence de départ choisie via « Trouver mon agence » (filtre GPS optionnel)
  const [agency, setAgency] = useState<NearbyAgencyDTO | null>(null);

  const [trip, setTrip] = useState<TripSearchDTO | null>(null);
  const [seatMap, setSeatMap] = useState<SeatMapDTO | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  // Multi-sièges (contrat §6/§7) : le client sélectionne 1..6 places.
  const [seatIds, setSeatIds] = useState<string[]>([]);
  // Idempotency-Key (contrat §16) : générée UNE FOIS par commande, réutilisée
  // à chaque tentative d'envoi — un retry réseau ne crée JAMAIS deux holds.
  const holdIdempotencyKeyRef = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : "");

  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<BookingDTO | null>(null);
  const [detail, setDetail] = useState<BookingDetailDTO | null>(null);
  const [resetting, setResetting] = useState(false);

  // Villes pour le formulaire de l'étape 1
  useEffect(() => {
    let cancelled = false;
    api.cities()
      .then((list) => {
        if (!cancelled) setCities(list);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // L'agence choisie doit rester cohérente avec la ville de départ :
  // si le client change de ville de départ, on retire silencieusement le filtre.
  useEffect(() => {
    setAgency((prev) => (prev && search.from && prev.cityId !== search.from ? null : prev));
  }, [search.from]);

  // Scroll top à chaque changement d'étape
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const resetAll = useCallback(
    (message?: string) => {
      setStep(1);
      setTrips(null);
      setTrip(null);
      setSeatMap(null);
      setSeatIds([]);
      setBooking(null);
      setDetail(null);
      setSearchError(null);
      setAgency(null);
      holdIdempotencyKeyRef.current = typeof crypto !== "undefined" ? crypto.randomUUID() : "";
      if (message) toast.info(message);
    },
    []
  );

  const runSearch = useCallback(
    async (params: { from: string; to: string; date: string }, agencyFilter?: NearbyAgencyDTO | null) => {
      // agencyFilter explicite (changement d'agence à chaud) sinon filtre courant
      const filter = agencyFilter === undefined ? agency : agencyFilter;
      setSearch(params);
      setSearching(true);
      setSearchError(null);
      try {
        const results = await api.trips.search(params.from, params.to, params.date, filter?.id);
        results.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
        setTrips(results);
        setStep(2);
      } catch (err) {
        setSearchError(errMessage(err));
      } finally {
        setSearching(false);
      }
    },
    [agency]
  );

  // Sélection / retrait de l'agence de départ (filtre « Trouver mon agence ») :
  // si des résultats sont déjà affichés, on relance la recherche filtrée.
  const handleAgencyChange = useCallback(
    (next: NearbyAgencyDTO | null) => {
      setAgency(next);
      if (step === 2 && search.from && search.to && search.date) {
        void runSearch(search, next);
      }
    },
    [step, search, runSearch]
  );

  const loadSeatMap = useCallback(async (tripId: string) => {
    setSeatLoading(true);
    try {
      setSeatMap(await api.trips.seats(tripId));
    } catch (err) {
      toast.error(errMessage(err));
      setSeatMap(null);
    } finally {
      setSeatLoading(false);
    }
  }, []);

  const chooseTrip = useCallback(
    (t: TripSearchDTO) => {
      setTrip(t);
      setSeatIds([]);
      setStep(3);
      loadSeatMap(t.id);
    },
    [loadSeatMap]
  );

  // Toggle d'une place (multi-sélection, max 6 — contrat §7).
  const toggleSeat = useCallback(
    (seat: { id: string; status: string }) => {
      if (seat.status !== "AVAILABLE" && seat.status !== "CANCELLED") return;
      setSeatIds((prev) => {
        if (prev.includes(seat.id)) return prev.filter((id) => id !== seat.id);
        if (prev.length >= 6) {
          toast.info("Maximum 6 places par réservation.");
          return prev;
        }
        return [...prev, seat.id];
      });
    },
    []
  );

  // ---------- TEMPS RÉEL (contrat §15) ----------
  // Tant que le plan de sièges est affiché, on écoute les événements du
  // voyage : tout changement serveur (hold, paiement, annulation, embarquement
  // d'un autre client) déclenche un rechargement du plan — le SERVEUR reste
  // la source de vérité, jamais le cache frontend.
  useEffect(() => {
    if (step !== 3 || !trip) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cursor: string | undefined;
    const poll = async () => {
      try {
        const res = await api.events.list({
          tripId: trip.id,
          since: cursor,
          types: ["SEAT_HELD", "SEAT_RELEASED", "SEAT_PAID", "SEAT_CANCELLED", "BOOKING_CREATED", "BOOKING_CANCELLED", "TICKET_BOARDED"],
        });
        if (cancelled) return;
        cursor = res.cursor ?? cursor;
        if (res.events.length > 0) {
          // On recharge la vérité serveur (GET /api/trips/{id}/seats) —
          // JAMAIS d'application locale des deltas (§15).
          setSeatMap(await api.trips.seats(trip.id));
        }
      } catch {
        // réseau/polling : silencieux, la prochaine itération réessaie
      } finally {
        if (!cancelled) timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [step, trip, trip?.id]);

  const createBooking = useCallback(
    async (passengers: PassengerInput[], dropOffNeighborhoodId?: string) => {
      if (!trip || seatIds.length === 0 || passengers.length === 0) return;
      setSubmitting(true);
      try {
        // Contrat §7 : hold multi-sièges + agence choisie (filtre « Trouver
        // mon agence » = canal de vente de la réservation) + clé idempotente.
        // Extension §24 : passagers nommés par place (passengers[0] = acheteur).
        const created = await api.bookings.hold(
          {
            tripId: trip.id,
            seatIds,
            agencyId: agency?.id,
            passenger: passengers[0],
            passengers,
            dropOffNeighborhoodId,
          },
          holdIdempotencyKeyRef.current
        );
        setBooking(created);
        setSeatMap((prev) =>
          prev
            ? {
                ...prev,
                availableSeats: Math.max(prev.availableSeats - seatIds.length, 0),
                seats: prev.seats.map((s) => (seatIds.includes(s.id) ? { ...s, status: "HELD" as const } : s)),
              }
            : prev
        );
        toast.success(
          created.seats.length > 1
            ? `${created.seats.length} places réservées ! Vous avez 10 minutes pour finaliser le paiement.`
            : "Siège réservé ! Vous avez 10 minutes pour finaliser le paiement."
        );
        setStep(5);
      } catch (err) {
        if (
          err instanceof ApiClientError &&
          (err.code === "SEAT_UNAVAILABLE" || err.code === "SEAT_HELD" || err.code === "SEAT_ALREADY_TAKEN")
        ) {
          // Contrat §8 : la place vient d'être prise → retour au plan + vérité serveur.
          toast.error(err.message);
          setSeatIds([]);
          setStep(3);
          loadSeatMap(trip.id);
        } else {
          toast.error(errMessage(err));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [trip, seatIds, agency, loadSeatMap]
  );

  const handlePaid = useCallback((d: BookingDetailDTO) => {
    setDetail(d);
    setStep(6);
    toast.success("Paiement confirmé — votre billet est prêt !");
  }, []);

  const cancelAndRestart = useCallback(async () => {
    if (!booking) {
      resetAll();
      return;
    }
    setResetting(true);
    try {
      await api.bookings.cancel(booking.bookingReference);
      resetAll("Réservation annulée. Vous pouvez recommencer.");
    } catch {
      // Le verrou expirera seul — on repart simplement au début.
      resetAll("Retour au départ de la réservation (la réservation en cours expirera automatiquement).");
    } finally {
      setResetting(false);
    }
  }, [booking, resetAll]);

  const progress = ((Math.min(step, 6) - 1) / (STEPS.length - 1)) * 100;

  const stepTitle =
    step === 1
      ? channel === "AGENT" ? "Nouvelle vente — trajet" : "Rechercher votre voyage"
      : step === 2
        ? "Voyages disponibles"
        : step === 3
          ? "Plan des sièges"
          : step === 4
            ? "Passager"
            : step === 5
              ? "Paiement"
              : "Votre billet";

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6" aria-label="Tunnel de réservation">
      {/* ---------- Fil d'Ariane + progression ---------- */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
            <Ticket className="size-5 text-primary" aria-hidden />
            {stepTitle}
          </h1>
          {channel === "AGENT" && (
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
              Guichet
            </span>
          )}
        </div>

        <Progress value={progress} className="mt-3 h-1.5" aria-label={`Étape ${step} sur ${STEPS.length}`} />

        <ol className="mt-2 flex items-center gap-0.5 overflow-x-auto nzoko-scroll pb-1" aria-label="Étapes de réservation">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const current = step === n;
            return (
              <li key={label} className="flex shrink-0 items-center gap-0.5">
                <span
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
                    current
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                  )}
                  aria-current={current ? "step" : undefined}
                >
                  {done ? <Check className="size-3" aria-hidden /> : <span aria-hidden>{n}</span>}
                  <span className={cn(current ? "inline" : "hidden sm:inline")}>{label}</span>
                </span>
                {i < STEPS.length - 1 && <span className="h-0.5 w-2 rounded bg-muted" aria-hidden />}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ---------- Bouton retour ---------- */}
      {step > 1 && step < 5 && (
        <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} className="mb-3 -ml-2 gap-1">
          <ChevronLeft className="size-4" aria-hidden /> {BACK_LABELS[step] ?? "Retour"}
        </Button>
      )}
      {step === 5 && booking && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="mb-3 -ml-2 gap-1 text-muted-foreground">
              <ChevronLeft className="size-4" aria-hidden /> {BACK_LABELS[5]}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Annuler cette réservation ?</AlertDialogTitle>
              <AlertDialogDescription>
                {booking.seats.length > 1
                  ? `Les places ${booking.seats.map((s) => s.seatNumber).join(", ")} seront libérées et la réservation ${booking.bookingReference} annulée.`
                  : `Le siège ${booking.seat.seatNumber} sera libéré et la réservation ${booking.bookingReference} annulée.`}
                {" "}Vous devrez recommencer la réservation depuis le début.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuer le paiement</AlertDialogCancel>
              <AlertDialogAction onClick={cancelAndRestart} disabled={resetting} className="bg-destructive text-white hover:bg-destructive/90">
                {resetting ? "Annulation…" : "Annuler et recommencer"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ---------- Contenu de l'étape ---------- */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {step === 1 && (
            <div className="space-y-4">
              <SearchForm
                cities={cities}
                from={search.from}
                to={search.to}
                date={search.date}
                onFromChange={(v) => setSearch((prev) => ({ ...prev, from: v }))}
                onToChange={(v) => setSearch((prev) => ({ ...prev, to: v }))}
                onDateChange={(v) => setSearch((prev) => ({ ...prev, date: v }))}
                onSearch={runSearch}
                submitLabel="Rechercher les voyages"
                loading={searching}
              />
              {searchError && (
                <Card>
                  <CardContent className="flex items-start gap-2 p-4 text-sm text-red-700 dark:text-red-300">
                    <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {searchError}
                  </CardContent>
                </Card>
              )}

              {/* Trouver mon agence — GPS optionnel, repliable (étape « GPS / agence ») */}
              <AgencyFinder
                cities={cities}
                from={search.from}
                to={search.to}
                date={search.date}
                selectedAgency={agency}
                onAgencyChange={handleAgencyChange}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/30 px-4 py-3">
                <p className="text-sm font-semibold">
                  {trips && trips.length > 0 ? tripRouteLabel(search, cities) : "Recherche"}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarSearch className="size-3.5 shrink-0" aria-hidden />
                  {formatDayLabel(`${search.date}T12:00:00`)}
                  {trips && <span className="ml-1">· {trips.length} voyage{trips.length > 1 ? "s" : ""}</span>}
                </p>
              </div>

              {/* Filtre agence (GPS) — bandeau « Agence : X — Modifier » + panneau repliable */}
              <AgencyFinder
                compact
                cities={cities}
                from={search.from}
                to={search.to}
                date={search.date}
                selectedAgency={agency}
                onAgencyChange={handleAgencyChange}
              />

              {searching ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-40 rounded-xl" />
                  ))}
                </div>
              ) : searchError ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                    <XCircle className="size-8 text-red-500" aria-hidden />
                    <p className="text-sm text-red-700 dark:text-red-300">{searchError}</p>
                    <Button variant="outline" onClick={() => setStep(1)}>
                      <ChevronLeft className="size-4" aria-hidden /> Modifier la recherche
                    </Button>
                  </CardContent>
                </Card>
              ) : trips === null || trips.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                    <CalendarSearch className="size-10 text-muted-foreground" aria-hidden />
                    <div>
                      <p className="font-semibold">Aucun voyage ce jour-là.</p>
                      <p className="mt-1 text-sm text-muted-foreground">Essayez une autre date ou un autre trajet.</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {[
                        { label: "Demain", date: addDaysStr(search.date, 1) },
                        { label: "Après-demain", date: addDaysStr(search.date, 2) },
                      ].map((d) => (
                        <Button
                          key={d.date}
                          variant="outline"
                          size="sm"
                          onClick={() => runSearch({ ...search, date: d.date })}
                          className="min-h-[40px]"
                        >
                          <CalendarSearch className="size-3.5" aria-hidden /> {d.label}
                        </Button>
                      ))}
                      <Button variant="secondary" size="sm" onClick={() => setStep(1)} className="min-h-[40px]">
                        <Search className="size-3.5" aria-hidden /> Changer le trajet
                      </Button>
                      {agency && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAgencyChange(null)}
                          className="min-h-[40px]"
                        >
                          <XCircle className="size-3.5" aria-hidden /> Retirer le filtre d&apos;agence
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {trips.map((t) => (
                    <TripCard key={t.id} trip={t} onSelect={chooseTrip} />
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {trip && (
                <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm">
                  <p className="font-semibold">
                    {trip.originCityName} → {trip.destinationCityName} · départ {formatTime(trip.departureTime)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {trip.busRegistration} · {trip.busBrand} {trip.busModel}
                  </p>
                </div>
              )}
              <SeatMap
                seatMap={seatMap}
                loading={seatLoading}
                selectedSeatIds={seatIds}
                onSelect={toggleSeat}
                onRefresh={trip ? () => loadSeatMap(trip.id) : undefined}
              />
              <Button
                size="lg"
                className="h-12 w-full"
                disabled={seatIds.length === 0}
                onClick={() => {
                  // Nouvelle commande → nouvelle clé d'idempotence (contrat §16).
                  holdIdempotencyKeyRef.current = crypto.randomUUID();
                  setStep(4);
                }}
              >
                {seatIds.length > 0
                  ? `Continuer avec ${seatIds.length} place${seatIds.length > 1 ? "s" : ""} (${seatIds.length > 0 && seatMap ? seatMap.seats.filter((s) => seatIds.includes(s.id)).map((s) => s.seatNumber).join(", ") : ""})`
                  : "Sélectionnez au moins un siège pour continuer"}
              </Button>
            </div>
          )}

          {step === 4 && trip && seatMap && (
            <PassengerStep trip={trip} seatMap={seatMap} seatIds={seatIds} submitting={submitting} onSubmit={createBooking} />
          )}

          {step === 5 && booking && (
            <PaymentStep channel={channel} booking={booking} onPaid={handlePaid} />
          )}

          {step === 6 && detail && (
            <TicketCard detail={detail} channel={channel} onNewBooking={() => resetAll()} />
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function tripRouteLabel(search: { from: string; to: string }, cities: CityDTO[] | null): string {
  const from = cities?.find((c) => c.id === search.from)?.name;
  const to = cities?.find((c) => c.id === search.to)?.name;
  if (from && to) return `${from} → ${to}`;
  return "Votre trajet";
}
