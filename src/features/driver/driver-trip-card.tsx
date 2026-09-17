"use client";

// ============================================================
// NZOKO TRANSPORT — Card voyage chauffeur + manifeste
// ============================================================

import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { TRIP_STATUS_COLORS, TRIP_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/format";
import type { DriverTripDTO } from "@/types";

export function DriverTripCard({ trip }: { trip: DriverTripDTO }) {
  const [open, setOpen] = useState(false);
  const boardedPct = trip.soldCount > 0 ? Math.round((trip.boardedCount / trip.soldCount) * 100) : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-3 p-4">
        <CollapsibleTrigger asChild>
          <button className="w-full text-left" aria-label={`Manifeste du voyage ${trip.code}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-primary">{trip.code}</span>
              <Badge variant="outline" className={TRIP_STATUS_COLORS[trip.status]}>
                {TRIP_STATUS_LABELS[trip.status]}
              </Badge>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold">
              {trip.originCityName}
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {trip.destinationCityName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatDate(trip.departureTime)} · {formatTime(trip.departureTime)} →{" "}
              {formatTime(trip.estimatedArrivalTime)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {trip.busRegistration} · {trip.busModel}
            </p>
            <div className="mt-2.5">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>
                  Embarquement {trip.boardedCount}/{trip.soldCount}{" "}
                  {trip.soldCount > 1 ? "passagers" : "passager"}
                </span>
                <span>{boardedPct} %</span>
              </div>
              <Progress
                value={boardedPct}
                className="mt-1 h-2"
                aria-label={`Progression de l'embarquement du voyage ${trip.code}`}
              />
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary">
              {open ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {open ? "Masquer le manifeste" : `Voir le manifeste (${trip.passengers.length})`}
            </p>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator />
          <div className="nzoko-scroll max-h-96 overflow-y-auto">
            {trip.passengers.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                Aucun passager réservé sur ce voyage.
              </p>
            ) : (
              <ul className="divide-y">
                {trip.passengers.map((p) => (
                  <li key={p.reference} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.passengerName}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {p.reference} · Siège {p.seatNumber}
                      </p>
                    </div>
                    {p.boarded ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Embarqué
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600">
                        <Hourglass className="h-4 w-4" aria-hidden="true" /> En attente
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
