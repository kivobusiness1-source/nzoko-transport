"use client";

// ============================================================
// Océan du Nord — Étape 4 : informations passagers (react-hook-form + Zod)
// MULTI-PLACES : 1 carte acheteur (formulaire complet) + 1 carte compacte
// par place supplémentaire (passager nommé — extension contrat §24).
// La création de la réservation (verrou des sièges) est déléguée au parent.
// ============================================================

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Bus, IdCard, Lock, Mail, MapPin, Phone, Sparkles, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { formatMoney, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { PassengerInput, PublicNeighborhoodDTO, SeatMapDTO, TripSearchDTO } from "@/types";

const passengerSchema = z.object({
  firstName: z.string().trim().min(2, "Le prénom est requis (2 caractères minimum)."),
  lastName: z.string().trim().min(2, "Le nom est requis (2 caractères minimum)."),
  phone: z
    .string()
    .trim()
    .refine(
      (v) => /^(\+?242)?0?\d{8,9}$/.test(v.replace(/[\s.\-()]/g, "")),
      "Numéro invalide. Ex : 06 123 45 67 ou +242 06 123 45 67."
    ),
  email: z
    .string()
    .trim()
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Adresse e-mail invalide.")
    .optional(),
  documentNumber: z.string().trim().optional(),
});

type PassengerFormValues = z.infer<typeof passengerSchema>;

/** E-mail synthétique (local part = numéro de téléphone) → non pré-rempli. */
const isSyntheticEmail = (email: string) => /^\d+@/.test(email.trim());

interface PassengerStepProps {
  trip: TripSearchDTO;
  seatMap: SeatMapDTO;
  /** Places sélectionnées (multi-sièges, contrat §7). */
  seatIds: string[];
  submitting: boolean;
  /** Passagers NOMMÉS par place (index 0 = acheteur, extension §24). */
  onSubmit: (passengers: PassengerInput[], dropOffNeighborhoodId?: string) => void;
}

export function PassengerStep({ trip, seatMap, seatIds, submitting, onSubmit }: PassengerStepProps) {
  const selectedSeats = seatMap.seats.filter((s) => seatIds.includes(s.id));
  const total = trip.price * selectedSeats.length;
  const seatsLabel = selectedSeats.map((s) => s.seatNumber).join(", ");
  const session = useApp((s) => s.session);
  // Passagers nommés des places 2..N (la place 1 = l'acheteur). Tél. acheteur
  // = contact de repli côté serveur — pas besoin de le ressaisir ici.
  // Initialisé AU MONTAGE avec le bon nombre de cartes (seatCount - 1).
  const [extras, setExtras] = useState<{ firstName: string; lastName: string }[]>(() =>
    Array.from({ length: Math.max(0, selectedSeats.length - 1) }, () => ({ firstName: "", lastName: "" }))
  );
  const [extraErrors, setExtraErrors] = useState<Record<number, string>>({});

  // Réinitialisation des cartes si le nombre de places change — pattern React
  // officiel « ajuster l'état pendant le rendu » (même pattern que les quartiers).
  const seatCount = selectedSeats.length;
  const [lastSeatCount, setLastSeatCount] = useState(seatCount);
  if (lastSeatCount !== seatCount) {
    setLastSeatCount(seatCount);
    setExtras((prev) =>
      Array.from({ length: Math.max(0, seatCount - 1) }, (_, i) => prev[i] ?? { firstName: "", lastName: "" })
    );
    setExtraErrors({});
  }

  // Client connecté : formulaire pré-rempli (éditable) depuis la session.
  const connectedClient = session?.role === "PASSENGER" ? session : null;

  // Quartiers d'arrêt de la ville de DESTINATION (config admin). null =
  // chargement en cours, [] = aucun quartier configuré (sélecteur caché).
  const [neighborhoods, setNeighborhoods] = useState<PublicNeighborhoodDTO[] | null>(null);
  const [neighborhoodId, setNeighborhoodId] = useState<string>("");

  // Réinitialisation au changement de voyage — pattern React officiel
  // « ajuster l'état pendant le rendu » (pas d'effet, pas de cascade).
  const [lastCityId, setLastCityId] = useState(trip.destinationCityId);
  if (lastCityId !== trip.destinationCityId) {
    setLastCityId(trip.destinationCityId);
    setNeighborhoods(null);
    setNeighborhoodId("");
  }

  // Chargement des quartiers actifs de la ville de destination.
  useEffect(() => {
    let cancelled = false;
    api
      .neighborhoods(trip.destinationCityId)
      .then((list) => {
        if (!cancelled) setNeighborhoods(list);
      })
      .catch(() => {
        if (!cancelled) setNeighborhoods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trip.destinationCityId]);

  const form = useForm<PassengerFormValues>({
    resolver: zodResolver(passengerSchema),
    defaultValues: {
      firstName: connectedClient?.firstName ?? "",
      lastName: connectedClient?.lastName ?? "",
      phone: connectedClient?.phone ? formatPhone(connectedClient.phone) : "",
      email: connectedClient && !isSyntheticEmail(connectedClient.email) ? connectedClient.email : "",
      documentNumber: "",
    },
  });

  const submit = (values: PassengerFormValues) => {
    // Validation des passagers nommés des places 2..N (prénom/nom requis).
    const errs: Record<number, string> = {};
    extras.forEach((ex, i) => {
      if (ex.firstName.trim().length < 2 || ex.lastName.trim().length < 2) {
        errs[i] = "Prénom et nom requis (2 caractères minimum).";
      }
    });
    if (Object.keys(errs).length > 0) {
      setExtraErrors(errs);
      return;
    }
    setExtraErrors({});
    // passengers[0] = l'acheteur (place 1), les suivants = cartes nommées.
    const passengers = [
      {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.replace(/[\s.-]/g, ""),
        email: values.email?.trim() ? values.email.trim() : undefined,
        documentNumber: values.documentNumber?.trim() ? values.documentNumber.trim() : undefined,
      },
      ...extras.map((ex) => ({ firstName: ex.firstName.trim(), lastName: ex.lastName.trim() })),
    ];
    onSubmit(passengers as PassengerInput[], neighborhoodId || undefined);
  };

  return (
    <div className="space-y-4">
      {/* Récap voyage + siège */}
      <Card className="border-primary/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Bus className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">
                {trip.originCityName} → {trip.destinationCityName}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Départ {formatTime(trip.departureTime)} · {trip.busRegistration}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              Place{selectedSeats.length > 1 ? "s" : ""}
            </p>
            <p className="text-lg font-bold text-primary" aria-label={`Places ${seatsLabel}`}>
              {seatsLabel || "—"}
            </p>
            {selectedSeats.some((s) => s.type === "VIP") && (
              <p className="text-[10px] font-semibold uppercase text-orange-600">VIP incluse</p>
            )}
          </div>
          <div className="w-full text-right sm:w-auto">
            {selectedSeats.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {formatMoney(trip.price)} × {selectedSeats.length}
              </p>
            )}
            <p className="text-base font-bold text-primary">{formatMoney(total)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selectedSeats.length > 1 ? "Acheteur (passager 1 · place " + selectedSeats[0]?.seatNumber + ")" : "Informations du passager"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ces informations figurent sur le billet et sont vérifiées à l&apos;embarquement.
          </p>
        </CardHeader>
        <CardContent>
          {connectedClient && (
            <p
              role="status"
              className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
              Connecté — vos points de fidélité seront crédités après paiement ✨
            </p>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prénom</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input {...field} autoComplete="given-name" className="h-11 pl-9" placeholder="Ex : Marie" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input {...field} autoComplete="family-name" className="h-11 pl-9" placeholder="Ex : Nkouka" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                          {...field}
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          className="h-11 pl-9"
                          placeholder="06 123 45 67 ou +242 06 123 45 67"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                    <p className="text-[11px] text-muted-foreground">Utilisé pour le suivi de votre réservation.</p>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        E-mail <span className="font-normal text-muted-foreground">(optionnel)</span>
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input {...field} type="email" autoComplete="email" className="h-11 pl-9" placeholder="vous@exemple.cg" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="documentNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        N° CNI / passeport <span className="font-normal text-muted-foreground">(optionnel)</span>
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <IdCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input {...field} className="h-11 pl-9" placeholder="Ex : 1 234 5678" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Passagers nommés des places 2..N (extension contrat §24).
                  La place 1 porte le nom de l'acheteur (formulaire ci-dessus). */}
              {extras.map((ex, i) => {
                const seat = selectedSeats[i + 1];
                return (
                  <div key={seat?.id ?? i} className="rounded-lg border bg-muted/30 p-3 sm:p-4">
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <Users className="size-4 shrink-0 text-primary" aria-hidden />
                        Passager {i + 2} · place{" "}
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary">
                          {seat?.seatNumber ?? "?"}
                        </span>
                      </p>
                      <p className="hidden text-[11px] text-muted-foreground sm:block">Contact : téléphone de l&apos;acheteur</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`extra-first-${i}`} className="text-sm font-medium">
                          Prénom <span className="text-red-500" aria-hidden>*</span>
                        </label>
                        <Input
                          id={`extra-first-${i}`}
                          value={ex.firstName}
                          onChange={(e) =>
                            setExtras((prev) => prev.map((p, j) => (j === i ? { ...p, firstName: e.target.value } : p)))
                          }
                          autoComplete="off"
                          className="mt-1.5 h-11"
                          placeholder="Ex : Paul"
                          aria-invalid={Boolean(extraErrors[i])}
                        />
                      </div>
                      <div>
                        <label htmlFor={`extra-last-${i}`} className="text-sm font-medium">
                          Nom <span className="text-red-500" aria-hidden>*</span>
                        </label>
                        <Input
                          id={`extra-last-${i}`}
                          value={ex.lastName}
                          onChange={(e) =>
                            setExtras((prev) => prev.map((p, j) => (j === i ? { ...p, lastName: e.target.value } : p)))
                          }
                          autoComplete="off"
                          className="mt-1.5 h-11"
                          placeholder="Ex : Mbemba"
                          aria-invalid={Boolean(extraErrors[i])}
                        />
                      </div>
                    </div>
                    {extraErrors[i] && (
                      <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                        {extraErrors[i]}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Quartier d'arrêt à la destination — quartiers configurés
                  dans l'admin (Parc → Quartiers). Optionnel : sans choix,
                  le passager descend à l'arrêt principal. Caché si la
                  ville n'a aucun quartier actif configuré. */}
              {neighborhoods === null ? (
                <Skeleton className="h-[76px] w-full rounded-lg" aria-label="Chargement des quartiers d'arrêt" />
              ) : neighborhoods.length > 0 ? (
                <div className="rounded-lg border bg-muted/30 p-3 sm:p-4">
                  <label htmlFor="drop-off-neighborhood" className="flex items-center gap-1.5 text-sm font-medium">
                    <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
                    Quartier d&apos;arrêt à {trip.destinationCityName}{" "}
                    <span className="font-normal text-muted-foreground">(optionnel)</span>
                  </label>
                  <Select value={neighborhoodId || ""} onValueChange={setNeighborhoodId}>
                    <SelectTrigger
                      id="drop-off-neighborhood"
                      className="mt-2 h-11 w-full bg-background"
                      aria-label={`Quartier d'arrêt à ${trip.destinationCityName}`}
                    >
                      <SelectValue placeholder="Arrêt principal (gare / agence)" />
                    </SelectTrigger>
                    <SelectContent>
                      {neighborhoods.map((n) => (
                        <SelectItem key={n.id} value={n.id} className="min-h-[40px]">
                          {n.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Indiquez au chauffeur où vous souhaitez descendre à l&apos;arrivée.
                  </p>
                </div>
              ) : null}

              <Button type="submit" size="lg" disabled={submitting} className="h-12 w-full">
                <Lock className="h-4 w-4" aria-hidden />
                {submitting
                  ? "Réservation en cours…"
                  : selectedSeats.length > 1
                    ? `Réserver et verrouiller les ${selectedSeats.length} places`
                    : "Réserver et verrouiller le siège"}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Les places restent bloquées pendant 10 minutes. Annulation possible tant que le paiement n&apos;est pas effectué.
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
