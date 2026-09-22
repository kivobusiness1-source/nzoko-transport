"use client";

// ============================================================
// NZOKO TRANSPORT — Registre « Clients à prévenir »
// Quand un voyage est annulé, les clients qui ont PAYÉ leur place
// sont archivés ici (groupés par voyage/bus). Le gérant peut :
//  - ouvrir WhatsApp avec un message PRÉREMPLE (variables),
//  - appeler directement,
//  - copier le message ou tous les numéros,
//  - suivre qui a été informé (marquage manuel).
// Partagé entre l'espace Admin et l'espace Agence.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  MessageCircle,
  Phone,
  PhoneCall,
  RotateCcw,
  Undo2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, hasPerm } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { formatDate, formatDateTime, formatMoney, formatTime } from "@/lib/format";
import { callLink, displayPhone, whatsappLink } from "@/lib/phone";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import type { CancellationContactDTO, CancellationDTO } from "@/types";

// ---------- Message WhatsApp prérempli (modifiable, avec variables) ----------
const DEFAULT_TEMPLATE = [
  "Bonjour {prenom}, ici {agence} — NZOKO TRANSPORT.",
  "Nous sommes au regret de vous informer que votre voyage {voyage} ({trajet}) prévu le {date} à {heure} a été annulé.",
  "Siège {siege} — {montant} payés.",
  "Présentez-vous à l'agence {agence} avec votre référence {reference} pour un remboursement intégral ou un échange gratuit vers un autre départ.",
  "Toutes nos excuses pour la gêne occasionnée.",
].join(" ");

const TEMPLATE_VARIABLES = [
  "{prenom}",
  "{nom}",
  "{voyage}",
  "{trajet}",
  "{date}",
  "{heure}",
  "{siege}",
  "{montant}",
  "{reference}",
  "{agence}",
] as const;

function fillTemplate(
  template: string,
  contact: CancellationContactDTO,
  cancellation: CancellationDTO,
): string {
  const [first, ...rest] = contact.passengerName.split(" ");
  const vars: Record<string, string> = {
    "{prenom}": first ?? contact.passengerName,
    "{nom}": rest.join(" "),
    "{voyage}": cancellation.tripCode,
    "{trajet}": `${contact.fromCityName} → ${contact.toCityName}`,
    "{date}": formatDate(cancellation.departureTime),
    "{heure}": formatTime(cancellation.departureTime),
    "{siege}": contact.seatNumber,
    "{montant}": formatMoney(contact.amountPaid),
    "{reference}": contact.bookingRef,
    "{agence}": cancellation.agencyName,
  };
  return template.replace(/\{[a-z]+\}/g, (m) => vars[m] ?? m);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type ContactFilter = "ALL" | "PENDING" | "NOTIFIED";

export function NzokoCancellationsRegistry({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();
  const canManage = session ? hasPerm(session, "booking:manage") : false;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ContactFilter>("ALL");

  const { data, loading, error, reload } = useApiData(() => api.admin.cancellations(), {
    refreshKey,
    autoRefreshMs: 30_000,
  });

  const cancellations = data ?? [];
  const remaining = cancellations.reduce((sum, c) => sum + (c.totalContacts - c.notifiedCount), 0);

  return (
    <div>
      {cancellations.length > 0 && (
        <Card className="mb-4 gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PhoneCall className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="font-semibold">
              {remaining > 0
                ? `${remaining} client${remaining > 1 ? "s" : ""} payeur${remaining > 1 ? "s" : ""} à prévenir`
                : "Tous les clients payeurs ont été informés"}
            </span>
            <span className="text-muted-foreground">· {cancellations.length} voyage(s) annulé(s)</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Ouvrez WhatsApp (message prérempli) ou appelez directement, puis le client est marqué
            informé en un clic.
          </p>
        </Card>
      )}

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="h-24 animate-pulse p-4" aria-hidden="true" />
          ))}
        </div>
      )}
      {error && (
        <Card className="p-4 text-sm text-red-600">
          {apiErrorMessage(error)}{" "}
          <Button variant="outline" size="sm" className="ml-2 h-9" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}
      {!loading && !error && cancellations.length === 0 && (
        <Card className="gap-2 p-8 text-center">
          <PhoneCall className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">Aucun voyage annulé</p>
          <p className="text-sm text-muted-foreground">
            Quand un voyage sera annulé, les clients ayant payé leur place apparaîtront ici avec
            leurs contacts et un message WhatsApp prêt à envoyer.
          </p>
        </Card>
      )}

      {!loading && !error && cancellations.length > 0 && (
        <div className="mb-3 sm:max-w-64">
          <Select value={filter} onValueChange={(v) => setFilter(v as ContactFilter)}>
            <SelectTrigger className="h-11" aria-label="Filtrer les clients du registre">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les clients</SelectItem>
              <SelectItem value="PENDING">À prévenir uniquement</SelectItem>
              <SelectItem value="NOTIFIED">Informés uniquement</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-3">
        {cancellations.map((c) => (
          <CancellationCard
            key={c.id}
            cancellation={c}
            canManage={canManage}
            filter={filter}
            expanded={expandedId === c.id}
            onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            onChanged={reload}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- Une annulation (voyage + bus) avec ses clients payeurs ----------

function CancellationCard({
  cancellation: c,
  canManage,
  filter,
  expanded,
  onToggle,
  onChanged,
}: {
  cancellation: CancellationDTO;
  canManage: boolean;
  filter: ContactFilter;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<CancellationContactDTO[]>(c.contacts);

  // Synchronise si les données sont rafraîchies (auto-refresh / reload)
  useEffect(() => setContacts(c.contacts), [c.contacts]);

  const visible = contacts.filter((x) =>
    filter === "ALL" ? true : filter === "PENDING" ? x.notifiedAt === null : x.notifiedAt !== null,
  );
  const notifiedCount = contacts.filter((x) => x.notifiedAt !== null).length;
  const totalAmount = contacts.reduce((s, x) => s + x.amountPaid, 0);
  const progress = contacts.length ? (notifiedCount / contacts.length) * 100 : 100;

  const mark = async (contact: CancellationContactDTO, notified: boolean, channel?: "WHATSAPP" | "CALL" | "SMS" | "AUTRE") => {
    setBusyId(contact.id);
    try {
      const updated = await api.admin.markContactNotified(contact.id, {
        notified,
        channel: notified ? channel : undefined,
      });
      setContacts((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const openWhatsApp = (contact: CancellationContactDTO) => {
    const message = fillTemplate(template, contact, c);
    window.open(whatsappLink(contact.passengerPhone, message), "_blank", "noopener,noreferrer");
    if (canManage && contact.notifiedAt === null) {
      void mark(contact, true, "WHATSAPP");
      toast.success(`WhatsApp ouvert pour ${contact.passengerName} — marqué informé.`);
    } else {
      toast.success(`WhatsApp ouvert pour ${contact.passengerName}.`);
    }
  };

  const callPassenger = (contact: CancellationContactDTO) => {
    window.location.href = callLink(contact.passengerPhone);
    if (canManage && contact.notifiedAt === null) {
      void mark(contact, true, "CALL");
      toast.success(`Appel lancé pour ${contact.passengerName} — marqué informé.`);
    }
  };

  const copyMessage = async (contact: CancellationContactDTO) => {
    const ok = await copyText(fillTemplate(template, contact, c));
    if (ok) toast.success(`Message de ${contact.passengerName} copié.`);
    else toast.error("Copie impossible sur ce navigateur.");
  };

  const copyAllNumbers = async () => {
    const numbers = contacts.map((x) => displayPhone(x.passengerPhone)).join(", ");
    const ok = await copyText(numbers);
    if (ok) {
      toast.success(`${contacts.length} numéro(s) copié(s) — prêts pour un groupe WhatsApp.`);
    } else {
      toast.error("Copie impossible sur ce navigateur.");
    }
  };

  const markAll = async () => {
    const pending = contacts.filter((x) => x.notifiedAt === null);
    for (const contact of pending) {
      await mark(contact, true, "AUTRE").catch(() => {});
    }
    toast.success(`${pending.length} client(s) marqué(s) informés.`);
  };

  return (
    <Card className="gap-3 p-4">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`Clients du voyage annulé ${c.tripCode}`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-primary">{c.tripCode}</span>
            <span className="text-sm font-semibold">
              {c.originCityName} → {c.destinationCityName}
            </span>
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
              Annulé
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Départ prévu {formatDateTime(c.departureTime)} · {c.busBrand} {c.busModel} (
            {c.busRegistration}) · {c.agencyName}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Annulé le {formatDateTime(c.cancelledAt)}
            {c.cancelledByName ? ` par ${c.cancelledByName}` : ""}
            {c.reason ? ` — ${c.reason}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {notifiedCount}/{contacts.length} informés
          </Badge>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
      </button>

      <div>
        <div className="text-[11px] text-muted-foreground">
          {contacts.length} client(s) payeur(s) · {formatMoney(totalAmount)} encaissés
        </div>
        <Progress value={progress} className="h-1.5" aria-label="Progression des contacts informés" />
      </div>

      {expanded && (
        <div className="space-y-4 border-t pt-4">
          {/* --- Message prérempli (modifiable) --- */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`tpl-${c.id}`} className="text-sm">
                Message WhatsApp prérempli
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => setTemplate(DEFAULT_TEMPLATE)}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Réinitialiser
              </Button>
            </div>
            <Textarea
              id={`tpl-${c.id}`}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={5}
              className="text-sm"
              aria-describedby={`tpl-hint-${c.id}`}
            />
            <p id={`tpl-hint-${c.id}`} className="text-[11px] leading-relaxed text-muted-foreground">
              Variables remplacées automatiquement : {TEMPLATE_VARIABLES.join(" ")} — le message est
              déjà prêt, personnalisez-le si besoin avant d&apos;ouvrir WhatsApp.
            </p>
          </div>

          {/* --- Actions groupées --- */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-2"
              onClick={() => void copyAllNumbers()}
            >
              <Copy className="h-4 w-4" aria-hidden="true" /> Copier tous les numéros
            </Button>
            {canManage && notifiedCount < contacts.length && (
              <Button
                variant="secondary"
                size="sm"
                className="h-10 gap-2"
                onClick={() => void markAll()}
              >
                <Check className="h-4 w-4" aria-hidden="true" /> Marquer tous informés
              </Button>
            )}
          </div>

          {/* --- Liste des clients payeurs --- */}
          {visible.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Aucun client ne correspond à ce filtre.
            </p>
          ) : (
            <>
              {/* Vue tableau (desktop) */}
              <Card className="hidden gap-0 p-0 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Téléphone</TableHead>
                      <TableHead>Siège</TableHead>
                      <TableHead>Trajet</TableHead>
                      <TableHead className="text-right">Payé</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Contacter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((x) => (
                      <ContactRow
                        key={x.id}
                        contact={x}
                        busy={busyId === x.id}
                        canManage={canManage}
                        onWhatsApp={() => openWhatsApp(x)}
                        onCall={() => callPassenger(x)}
                        onCopy={() => void copyMessage(x)}
                        onMark={(n) => void mark(x, n)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Card>

              {/* Vue cartes (mobile) */}
              <div className="grid gap-3 md:hidden">
                {visible.map((x) => (
                  <ContactCard
                    key={x.id}
                    contact={x}
                    busy={busyId === x.id}
                    canManage={canManage}
                    onWhatsApp={() => openWhatsApp(x)}
                    onCall={() => callPassenger(x)}
                    onCopy={() => void copyMessage(x)}
                    onMark={(n) => void mark(x, n)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Une ligne client (desktop) ----------

function ContactRow({
  contact: x,
  busy,
  canManage,
  onWhatsApp,
  onCall,
  onCopy,
  onMark,
}: {
  contact: CancellationContactDTO;
  busy: boolean;
  canManage: boolean;
  onWhatsApp: () => void;
  onCall: () => void;
  onCopy: () => void;
  onMark: (notified: boolean) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <p className="text-sm font-medium">{x.passengerName}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{x.bookingRef}</p>
      </TableCell>
      <TableCell className="text-xs tabular-nums">{displayPhone(x.passengerPhone)}</TableCell>
      <TableCell>
        <Badge variant="outline" className="font-mono">
          {x.seatNumber}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        {x.fromCityName} → {x.toCityName}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">{formatMoney(x.amountPaid)}</TableCell>
      <TableCell>
        <NotifiedBadge contact={x} />
      </TableCell>
      <TableCell>
        <ContactActions
          busy={busy}
          canManage={canManage}
          contact={x}
          onWhatsApp={onWhatsApp}
          onCall={onCall}
          onCopy={onCopy}
          onMark={onMark}
        />
      </TableCell>
    </TableRow>
  );
}

// ---------- Une carte client (mobile) ----------

function ContactCard({
  contact: x,
  busy,
  canManage,
  onWhatsApp,
  onCall,
  onCopy,
  onMark,
}: {
  contact: CancellationContactDTO;
  busy: boolean;
  canManage: boolean;
  onWhatsApp: () => void;
  onCall: () => void;
  onCopy: () => void;
  onMark: (notified: boolean) => void;
}) {
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{x.passengerName}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{x.bookingRef}</p>
        </div>
        <NotifiedBadge contact={x} />
      </div>
      <p className="text-xs text-muted-foreground">
        Siège {x.seatNumber} · {x.fromCityName} → {x.toCityName} · {formatMoney(x.amountPaid)}
      </p>
      <p className="text-xs tabular-nums">{displayPhone(x.passengerPhone)}</p>
      <ContactActions
        busy={busy}
        canManage={canManage}
        contact={x}
        onWhatsApp={onWhatsApp}
        onCall={onCall}
        onCopy={onCopy}
        onMark={onMark}
      />
    </Card>
  );
}

// ---------- Badge informé ----------

function NotifiedBadge({ contact: x }: { contact: CancellationContactDTO }) {
  if (x.notifiedAt) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
        <Check className="h-3 w-3" aria-hidden="true" />
        {x.channel === "WHATSAPP" ? "WhatsApp" : x.channel === "CALL" ? "Appelé" : "Informé"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
      <Phone className="h-3 w-3" aria-hidden="true" /> À prévenir
    </Badge>
  );
}

// ---------- Boutons d'action contact ----------

function ContactActions({
  busy,
  canManage,
  contact: x,
  onWhatsApp,
  onCall,
  onCopy,
  onMark,
}: {
  busy: boolean;
  canManage: boolean;
  contact: CancellationContactDTO;
  onWhatsApp: () => void;
  onCall: () => void;
  onCopy: () => void;
  onMark: (notified: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5 md:justify-end">
      <Button
        size="sm"
        className="h-9 gap-1.5 bg-[#25D366] text-white hover:bg-[#1eb85a]"
        onClick={onWhatsApp}
        aria-label={`Envoyer un message WhatsApp prérempli à ${x.passengerName}`}
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        onClick={onCall}
        aria-label={`Appeler ${x.passengerName}`}
      >
        <Phone className="h-4 w-4" aria-hidden="true" /> Appeler
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        onClick={onCopy}
        aria-label={`Copier le message prérempli pour ${x.passengerName}`}
      >
        <Copy className="h-4 w-4" aria-hidden="true" /> Message
      </Button>
      {canManage &&
        (x.notifiedAt ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground"
            disabled={busy}
            onClick={() => onMark(false)}
            aria-label={`Marquer ${x.passengerName} comme non informé`}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" /> Annuler
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="h-9 gap-1.5"
            disabled={busy}
            onClick={() => onMark(true)}
            aria-label={`Marquer ${x.passengerName} comme informé`}
          >
            <Check className="h-4 w-4" aria-hidden="true" /> Informé
          </Button>
        ))}
    </div>
  );
}
