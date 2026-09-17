"use client";

// ============================================================
// NZOKO — Badges de statut réutilisables (libellés + couleurs FR)
// ============================================================

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS,
  TRIP_STATUS_COLORS, TRIP_STATUS_LABELS,
} from "@/lib/constants";
import type { BookingStatus, PaymentStatus, TripStatus } from "@/lib/constants";

export function BookingStatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", BOOKING_STATUS_COLORS[status], className)}>
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PaymentStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", PAYMENT_STATUS_COLORS[status], className)}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TripStatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TRIP_STATUS_COLORS[status], className)}>
      {TRIP_STATUS_LABELS[status]}
    </Badge>
  );
}
