"use client";

// ============================================================
// NZOKO — « MON ESPACE NZOKO » : shell applicatif de l'espace
// client & fidélisation.
// Desktop (lg+) : sidebar fixe (marque, carte utilisateur,
// navigation verticale, CTA réservation, déconnexion).
// Mobile (<lg) : en-tête compact sticky (salutation + pill
// points + avatar profil) puis barre d'onglets scrollable.
// Sections : Aperçu · Mes voyages · Favoris · Dépenses ·
// Fidélité · Réclamations + dialog profil.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Bus, Heart, LayoutDashboard, LogOut, MessageSquare, RotateCw, Star, Ticket, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/store";
import { ClientPageHeader } from "@/features/client/client-page-header";
import { avatarToneClass, formatPoints, tierDef } from "@/features/client/client-utils";
import { ClientOverview } from "@/features/client/client-overview";
import { ClientTrips } from "@/features/client/client-trips";
import { ClientFavorites } from "@/features/client/client-favorites";
import { ClientSpending } from "@/features/client/client-spending";
import { ClientLoyalty } from "@/features/client/client-loyalty";
import { ClientComplaints } from "@/features/client/client-complaints";
import { ClientProfileDialog } from "@/features/client/client-profile-dialog";

interface ClientNavItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const NAV_ITEMS: ClientNavItem[] = [
  { key: "overview", label: "Aperçu", description: "Votre tableau de bord personnel, vos points et vos prochains départs.", icon: LayoutDashboard },
  { key: "trips", label: "Mes voyages", description: "Historique complet de vos billets, évaluations et références.", icon: Ticket },
  { key: "favorites", label: "Favoris", description: "Vos trajets réguliers, prêts à réserver en un geste.", icon: Heart },
  { key: "spending", label: "Dépenses", description: "Vos paiements et l'évolution de vos dépenses mois par mois.", icon: Wallet },
  { key: "loyalty", label: "Fidélité", description: "Vos points, paliers, récompenses et historique des mouvements.", icon: Star },
  { key: "complaints", label: "Réclamations", description: "Échangez avec nos équipes sur vos billets, bus ou paiements.", icon: MessageSquare },
];

export default function ClientWorkspace() {
  const session = useApp((s) => s.session);
  const setView = useApp((s) => s.setView);
  const logout = useApp((s) => s.logout);

  const [tab, setTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  // Solde + palier pour la carte utilisateur (sidebar) et la pill mobile.
  const { data: loyalty } = useApiData(() => api.client.loyalty(), { refreshKey });

  if (!session) return null;

  const activeItem = NAV_ITEMS.find((n) => n.key === tab) ?? NAV_ITEMS[0];
  const points = loyalty?.pointsBalance ?? null;
  const tier = loyalty ? tierDef(loyalty.tier) : null;

  const goBooking = () => {
    setView("booking");
    window.scrollTo({ top: 0 });
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Vous êtes déconnecté.");
  };

  const refresh = () => setRefreshKey((k) => k + 1);

  const pointsPill = points !== null && (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">
      <Star className="size-3.5 fill-primary/30" aria-hidden />
      {formatPoints(points)} pts
    </span>
  );

  const profileAvatar = (
    <Avatar className="size-10">
      <AvatarFallback className={cn(avatarToneClass(session.fullName), "text-xs font-semibold")}>
        {initials(session.fullName)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <section className="mx-auto max-w-6xl px-4 pb-6">
      {/* ================= MOBILE : en-tête compact sticky ================= */}
      <div className="sticky top-14 z-30 -mx-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden">
        <div className="flex items-center justify-between gap-2 pt-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-tight">Bonjour {session.firstName} 👋</p>
            <p className="text-[11px] text-muted-foreground">Mon espace NZOKO</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pointsPill}
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Modifier mon profil"
            >
              {profileAvatar}
            </button>
          </div>
        </div>
        <div role="tablist" aria-label="Sections de mon espace" className="nzoko-scroll flex gap-2 overflow-x-auto py-2.5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(item.key)}
                className={
                  "flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors " +
                  (isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= GRILLE : sidebar + contenu ================= */}
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
        {/* --- Sidebar (desktop) --- */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start" aria-label="Navigation de l'espace client">
          <div className="flex flex-col rounded-2xl border bg-card p-3 shadow-sm">
            {/* Marque */}
            <div className="flex items-center gap-2.5 px-2 pb-3 pt-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm" aria-hidden>
                <Bus className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="font-bold tracking-tight text-primary">NZOKO</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Espace client</span>
              </span>
            </div>

            <Separator className="my-1" />

            {/* Carte utilisateur → dialog profil */}
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="mt-2 flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Voir et modifier mon profil"
            >
              {profileAvatar}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{session.fullName}</span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  {tier && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {tier.icon} {tier.label}
                    </span>
                  )}
                </span>
              </span>
              {points !== null && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                  {formatPoints(points)} pts
                </span>
              )}
            </button>

            {/* Navigation verticale */}
            <nav role="tablist" aria-label="Sections de mon espace" className="mt-3 flex flex-col gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = item.key === tab;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(item.key)}
                    className={
                      "flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors " +
                      (isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground")
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* CTA réservation */}
            <Button
              onClick={goBooking}
              className="nzoko-hero-orange mt-4 min-h-[44px] w-full gap-1.5 rounded-xl text-white shadow-sm hover:opacity-95"
            >
              <Ticket className="size-4" aria-hidden /> Réserver un voyage
            </Button>

            <Separator className="my-3" />

            {/* Déconnexion */}
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="min-h-[40px] w-full justify-start gap-2 text-muted-foreground hover:text-red-600"
              aria-label="Se déconnecter"
            >
              <LogOut className="size-4" aria-hidden /> Se déconnecter
            </Button>
          </div>
        </aside>

        {/* --- Contenu --- */}
        <div className="min-w-0">
          <ClientPageHeader
            title={activeItem.label}
            subtitle={activeItem.description}
            icon={activeItem.icon}
            actions={
              <Button
                variant="outline"
                size="icon"
                className="size-10"
                onClick={refresh}
                aria-label="Rafraîchir les données"
                title="Rafraîchir"
              >
                <RotateCw className="size-4" aria-hidden />
              </Button>
            }
          />

          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="mt-4 lg:mt-5"
          >
            {tab === "overview" && <ClientOverview refreshKey={refreshKey} onTab={setTab} />}
            {tab === "trips" && <ClientTrips refreshKey={refreshKey} />}
            {tab === "favorites" && <ClientFavorites refreshKey={refreshKey} />}
            {tab === "spending" && <ClientSpending refreshKey={refreshKey} />}
            {tab === "loyalty" && <ClientLoyalty refreshKey={refreshKey} />}
            {tab === "complaints" && <ClientComplaints refreshKey={refreshKey} />}
          </motion.div>
        </div>
      </div>

      <ClientProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </section>
  );
}
