"use client";

// ============================================================
// NZOKO — Accueil public : hero, recherche, "comment ça marche",
// destinations, bandeau confiance. Mobile-first.
// ============================================================

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Building2, Bus, CalendarClock, CreditCard, MapPin, QrCode, RefreshCw,
  Search, ShieldCheck, Smartphone, Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchForm } from "@/features/booking/search-form";
import { api } from "@/lib/api-client";
import { APP_NAME, APP_SLOGAN, SEAT_HOLD_MINUTES } from "@/lib/constants";
import { todayStr } from "@/lib/dates";
import type { CityDTO } from "@/types";
import { cn } from "@/lib/utils";

const HOW_IT_WORKS = [
  {
    icon: Search,
    title: "Rechercher",
    text: "Choisissez votre trajet et votre date de voyage.",
  },
  {
    icon: MapPin,
    title: "Choisir sa place",
    text: "Sélectionnez votre siège sur le plan du bus en temps réel.",
  },
  {
    icon: CreditCard,
    title: "Payer",
    text: "MTN Mobile Money, espèces en agence ou virement.",
  },
  {
    icon: QrCode,
    title: "Voyager avec QR",
    text: "Votre billet électronique avec QR code, prêt à embarquer.",
  },
] as const;

interface TrustItem {
  icon: LucideIcon;
  title: string;
  text: string;
}

const TRUST_ITEMS: TrustItem[] = [
  {
    icon: QrCode,
    title: "QR sécurisé",
    text: "Chaque billet est unique et vérifié à l'embarquement.",
  },
  {
    icon: Smartphone,
    title: "Mobile Money",
    text: "Payez vos billets par MTN Mobile Money en toute sécurité.",
  },
  {
    icon: Ticket,
    title: `Sièges garantis ${SEAT_HOLD_MINUTES} min`,
    text: "Votre place reste bloquée pendant le paiement.",
  },
  {
    icon: Building2,
    title: "Agences officielles",
    text: "Guichets NZOKO à Brazzaville et Pointe-Noire.",
  },
];

export default function HomeView({ onSearch }: { onSearch: (params: { from: string; to: string; date: string }) => void }) {
  const [cities, setCities] = useState<CityDTO[] | null>(null);
  const [citiesFailed, setCitiesFailed] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(() => todayStr());

  // Chargement des villes actives (callback async → setState autorisé)
  useEffect(() => {
    let cancelled = false;
    api.cities()
      .then((list) => {
        if (!cancelled) {
          setCities(list);
          setCitiesFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCities([]);
          setCitiesFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const retryCities = () => {
    setCities(null);
    setCitiesFailed(false);
    api.cities()
      .then((list) => {
        setCities(list);
        setCitiesFailed(false);
      })
      .catch(() => {
        setCities([]);
        setCitiesFailed(true);
      });
  };

  const activeCities = (cities ?? []).filter((c) => c.isActive);

  const preselect = (city: CityDTO) => {
    // 1er touche : destination. Si déjà destination, devient départ (échange).
    if (to === city.id) {
      setTo("");
      setFrom(city.id);
    } else {
      setTo(city.id);
    }
  };

  return (
    <div className="pb-6">
      {/* ---------- HERO ---------- */}
      <section className="nzoko-hero relative overflow-hidden text-white">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="relative z-10 max-w-2xl"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              <Bus className="h-3.5 w-3.5" aria-hidden /> 🇨🇬 Congo-Brazzaville
            </span>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl">
              Réservation de bus<br className="hidden sm:block" /> au Congo-Brazzaville
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
              Voyagez simplement, voyagez en confiance. Réservez votre place entre Brazzaville, Pointe-Noire,
              Dolisie, Nkayi, Ouesso et plus. Paiement Mobile Money, billet QR immédiat.
            </p>
          </motion.div>

          {/* Visuel bus — décoratif */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            className="pointer-events-none absolute -bottom-2 right-4 hidden select-none md:block"
            aria-hidden
          >
            <div className="flex items-end gap-3 opacity-90">
              <div className="flex h-28 w-44 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
                <Bus className="h-16 w-16 text-white/80" strokeWidth={1.2} />
              </div>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
                <CalendarClock className="h-8 w-8 text-white/80" strokeWidth={1.2} />
              </div>
            </div>
          </motion.div>
        </div>

        {/* Vague de transition vers le fond blanc */}
        <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-8 w-full text-background" aria-hidden>
          <path d="M0,32 C240,64 480,0 720,16 C960,32 1200,48 1440,16 L1440,60 L0,60 Z" fill="currentColor" />
        </svg>
      </section>

      {/* ---------- RECHERCHE ---------- */}
      <section className="mx-auto -mt-8 max-w-2xl px-4" aria-label="Recherche de voyage">
        <div className="nzoko-fade-up">
          <SearchForm
            cities={cities}
            from={from}
            to={to}
            date={date}
            onFromChange={setFrom}
            onToChange={setTo}
            onDateChange={setDate}
            onSearch={onSearch}
            submitLabel="Rechercher mes voyages"
          />
        </div>
        {citiesFailed && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <span className="flex items-center gap-2">
              <Bus className="h-4 w-4 shrink-0" aria-hidden /> Impossible de charger les villes pour le moment.
            </span>
            <Button variant="outline" size="sm" onClick={retryCities} className="shrink-0 gap-1.5">
              <RefreshCw className="h-4 w-4" aria-hidden /> Réessayer
            </Button>
          </div>
        )}
      </section>

      {/* ---------- COMMENT ÇA MARCHE ---------- */}
      <section className="mx-auto mt-10 max-w-6xl px-4" aria-labelledby="how-title">
        <h2 id="how-title" className="text-xl font-bold tracking-tight sm:text-2xl">Comment ça marche</h2>
        <p className="mt-1 text-sm text-muted-foreground">Quatre étapes, moins de deux minutes.</p>
        <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((step, i) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="text-xs text-muted-foreground">Étape {i + 1}</span>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{step.text}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ol>
      </section>

      {/* ---------- DESTINATIONS ---------- */}
      <section className="mx-auto mt-10 max-w-6xl px-4" aria-labelledby="dest-title">
        <h2 id="dest-title" className="text-xl font-bold tracking-tight sm:text-2xl">Nos destinations</h2>
        <p className="mt-1 text-sm text-muted-foreground">Touchez une ville pour la définir comme destination.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {cities === null ? (
            Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 w-28 rounded-full" />)
          ) : activeCities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Destinations bientôt disponibles.</p>
          ) : (
            activeCities.map((city) => {
              const selected = to === city.id || from === city.id;
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => preselect(city)}
                  className={cn(
                    "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/40 hover:bg-primary/5"
                  )}
                  aria-pressed={selected}
                >
                  <MapPin className={cn("h-3.5 w-3.5", selected ? "text-primary-foreground" : "text-primary")} aria-hidden />
                  {city.name}
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* ---------- BANDEAU CONFIANCE ---------- */}
      <section className="mx-auto mt-10 max-w-6xl px-4" aria-labelledby="trust-title">
        <Card className="overflow-hidden border-primary/15">
          <CardHeader className="nzoko-hero text-white">
            <CardTitle id="trust-title" className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5" aria-hidden /> Pourquoi voyager avec {APP_NAME} ?
            </CardTitle>
            <p className="text-xs text-white/80">{APP_SLOGAN}</p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item) => (
              <div key={item.title} className="flex gap-3 rounded-xl border bg-muted/30 p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                  <item.icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.text}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
