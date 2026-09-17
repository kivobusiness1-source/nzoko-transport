"use client";

// ============================================================
// NZOKO — Étape 4 : informations passager (react-hook-form + Zod)
// La création de la réservation (verrou du siège) est déléguée au parent.
// ============================================================

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Bus, IdCard, Lock, Mail, Phone, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatMoney, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { useApp } from "@/lib/store";
import type { PassengerInput, SeatMapDTO, TripSearchDTO } from "@/types";

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
  seatId: string | null;
  submitting: boolean;
  onSubmit: (passenger: PassengerInput) => void;
}

export function PassengerStep({ trip, seatMap, seatId, submitting, onSubmit }: PassengerStepProps) {
  const seat = seatMap.seats.find((s) => s.id === seatId) ?? null;
  const session = useApp((s) => s.session);
  // Client connecté : formulaire pré-rempli (éditable) depuis la session.
  const connectedClient = session?.role === "PASSENGER" ? session : null;

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
    onSubmit({
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      phone: values.phone.replace(/[\s.-]/g, ""),
      email: values.email?.trim() ? values.email.trim() : undefined,
      documentNumber: values.documentNumber?.trim() ? values.documentNumber.trim() : undefined,
    });
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
            <p className="text-xs text-muted-foreground">Siège</p>
            <p className="text-lg font-bold text-primary">
              {seat ? seat.seatNumber : "—"}
              {seat?.type === "VIP" && <span className="ml-1 text-[10px] font-semibold uppercase text-orange-600">VIP</span>}
            </p>
          </div>
          <p className="w-full text-right text-base font-bold text-primary sm:w-auto">{formatMoney(trip.price)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations du passager</CardTitle>
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

              <Button type="submit" size="lg" disabled={submitting} className="h-12 w-full">
                <Lock className="h-4 w-4" aria-hidden />
                {submitting ? "Réservation en cours…" : "Réserver et verrouiller le siège"}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Le siège reste bloqué pendant 10 minutes. Annulation possible tant que le paiement n&apos;est pas effectué.
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
