"use client";

// ============================================================
// Océan du Nord — Guichet agent : nouvelle vente (tunnel AGENT),
// réservations de l'agence, paiements en attente.
// ============================================================

import { Banknote, ClipboardList, Store, Ticket } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BookingFlow from "@/features/booking/booking-flow";
import { AgencyBookingsTab } from "@/features/agent/agency-bookings-tab";
import { PendingPaymentsTab } from "@/features/agent/pending-payments-tab";
import { useApp } from "@/lib/store";

export default function AgentDesk() {
  const session = useApp((s) => s.session);
  const agencyName = session?.agencyName ?? "Océan du Nord";

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6" aria-label="Guichet agent">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
          <Store className="size-5 text-primary" aria-hidden /> Guichet {agencyName}
        </h1>
        {session && (
          <p className="text-xs text-muted-foreground">
            {session.fullName} · {session.roleLabel}
          </p>
        )}
      </div>

      <Tabs defaultValue="sale" className="mt-4">
        <TabsList className="grid h-auto w-full grid-cols-3" aria-label="Sections du guichet">
          <TabsTrigger value="sale" className="min-h-[44px] gap-1.5 text-xs sm:text-sm">
            <Ticket className="size-4" aria-hidden /> Nouvelle vente
          </TabsTrigger>
          <TabsTrigger value="bookings" className="min-h-[44px] gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="size-4" aria-hidden /> Réservations
          </TabsTrigger>
          <TabsTrigger value="pending" className="min-h-[44px] gap-1.5 text-xs sm:text-sm">
            <Banknote className="size-4" aria-hidden /> Paiements en attente
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sale" className="mt-4">
          <BookingFlow channel="AGENT" />
        </TabsContent>
        <TabsContent value="bookings" className="mt-4">
          <AgencyBookingsTab />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <PendingPaymentsTab />
        </TabsContent>
      </Tabs>
    </section>
  );
}
