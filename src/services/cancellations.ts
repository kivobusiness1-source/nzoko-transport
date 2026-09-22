// ============================================================
// NZOKO TRANSPORT — Services : registre des annulations
// Mappers Prisma → DTO pour TripCancellation / CancellationContact
// (clients payeurs à prévenir, groupés par voyage/bus).
// ============================================================

import type { CancellationContact, TripCancellation } from "@prisma/client";
import type { CancellationContactDTO, CancellationDTO } from "@/types";

type TripCancellationWithRelations = TripCancellation & {
  trip: {
    code: string;
    departureTime: Date;
    route: {
      originCity: { name: string };
      destinationCity: { name: string };
    };
    bus: { registrationNumber: string; brand: string; model: string };
    agency: { id: string; name: string };
  };
  cancelledBy: { firstName: string; lastName: string } | null;
  contacts: CancellationContact[];
};

export function toCancellationContactDTO(c: CancellationContact): CancellationContactDTO {
  return {
    id: c.id,
    passengerName: c.passengerName,
    passengerPhone: c.passengerPhone,
    bookingRef: c.bookingRef,
    seatNumber: c.seatNumber,
    fromCityName: c.fromCityName,
    toCityName: c.toCityName,
    amountPaid: c.amountPaid,
    channel: (c.channel as CancellationContactDTO["channel"]) ?? null,
    notifiedAt: c.notifiedAt ? c.notifiedAt.toISOString() : null,
  };
}

export function toCancellationDTO(c: TripCancellationWithRelations): CancellationDTO {
  return {
    id: c.id,
    tripId: c.tripId,
    tripCode: c.trip.code,
    originCityName: c.trip.route.originCity.name,
    destinationCityName: c.trip.route.destinationCity.name,
    departureTime: c.trip.departureTime.toISOString(),
    busRegistration: c.trip.bus.registrationNumber,
    busBrand: c.trip.bus.brand,
    busModel: c.trip.bus.model,
    agencyId: c.agencyId,
    agencyName: c.trip.agency.name,
    cancelledAt: c.cancelledAt.toISOString(),
    cancelledByName: c.cancelledBy
      ? `${c.cancelledBy.firstName} ${c.cancelledBy.lastName}`.trim()
      : null,
    reason: c.reason,
    totalContacts: c.contacts.length,
    notifiedCount: c.contacts.filter((x) => x.notifiedAt !== null).length,
    totalAmountPaid: c.contacts.reduce((sum, x) => sum + x.amountPaid, 0),
    contacts: c.contacts.map(toCancellationContactDTO),
  };
}
