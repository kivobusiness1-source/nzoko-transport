"use client";

// ============================================================
// NZOKO — Admin : réclamations clients (onglet "Réclamations")
// File complète, recherche, filtre statut, prise en charge,
// réponses et transitions de statut.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown, CheckCircle2, ChevronRight, Loader2, MessageSquare, Play, Search, Send, UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard } from "@/components/shared/nzoko-kpi-card";
import { NzokoKpiSkeletons, NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { friendlyApiError, useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { COMPLAINT_STATUS_COLORS, COMPLAINT_STATUS_LABELS } from "@/lib/constants";
import type { ComplaintStatus } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { AdminComplaintDTO, ComplaintMessageDTO } from "@/types";

type StatusFilter = "ALL" | ComplaintStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Tous" },
  { key: "OPEN", label: "Ouvertes" },
  { key: "IN_PROGRESS", label: "En cours" },
  { key: "RESOLVED", label: "Résolues" },
  { key: "CLOSED", label: "Clôturées" },
];

/** Transition de statut suivante (bouton d'action admin). */
function nextAction(status: ComplaintStatus): { label: string; target: ComplaintStatus; icon: typeof Play } | null {
  switch (status) {
    case "OPEN":
      return { label: "Commencer le traitement", target: "IN_PROGRESS", icon: Play };
    case "IN_PROGRESS":
      return { label: "Marquer résolu", target: "RESOLVED", icon: CheckCircle2 };
    case "RESOLVED":
      return { label: "Clôturer", target: "CLOSED", icon: ArrowDown };
    default:
      return null;
  }
}

export function AdminComplaints({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.clientAdmin.complaints(), {
    refreshKey,
    autoRefreshMs: 60_000,
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AdminComplaintDTO | null>(null);

  const list = useMemo(() => data ?? [], [data]);

  const stats = useMemo(
    () => ({
      open: list.filter((c) => c.status === "OPEN").length,
      inProgress: list.filter((c) => c.status === "IN_PROGRESS").length,
      resolved: list.filter((c) => c.status === "RESOLVED" || c.status === "CLOSED").length,
    }),
    [list],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        c.reference.toLowerCase().includes(needle) ||
        c.subject.toLowerCase().includes(needle) ||
        c.clientName.toLowerCase().includes(needle) ||
        (c.clientPhone ?? "").includes(needle) ||
        c.categoryLabel.toLowerCase().includes(needle)
      );
    });
  }, [list, statusFilter, q]);

  if (loading) {
    return (
      <div className="space-y-6">
        <NzokoKpiSkeletons count={3} />
        <NzokoListSkeleton count={4} />
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      {/* Stats rapides */}
      <div className="grid grid-cols-3 gap-3">
        <NzokoKpiCard label="Ouvertes" value={String(stats.open)} icon={MessageSquare} tone="amber" />
        <NzokoKpiCard label="En cours" value={String(stats.inProgress)} icon={Play} tone="orange" />
        <NzokoKpiCard label="Résolues" value={String(stats.resolved)} icon={CheckCircle2} tone="green" />
      </div>

      {/* Filtres + recherche */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-9"
            placeholder="Rechercher (référence, client, sujet…)"
            aria-label="Rechercher une réclamation"
          />
        </div>
        <div role="group" aria-label="Filtrer par statut" className="nzoko-scroll flex gap-2 overflow-x-auto pb-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={statusFilter === f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors",
                statusFilter === f.key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <NzokoEmptyState
          icon={CheckCircle2}
          title="Aucune réclamation — tout va bien 🎉"
          description={
            list.length === 0
              ? "Aucune réclamation client n'a été ouverte pour le moment."
              : "Aucune réclamation ne correspond à cette recherche."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className="w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Ouvrir la réclamation ${c.reference}`}
            >
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{c.subject}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <UserRound className="mr-1 inline size-3.5" aria-hidden />
                        {c.clientName} · {formatPhone(c.clientPhone)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{c.reference}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline" className={cn("font-medium", COMPLAINT_STATUS_COLORS[c.status])}>
                        {COMPLAINT_STATUS_LABELS[c.status]}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{c.categoryLabel}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {c.messageCount} message{c.messageCount > 1 ? "s" : ""}
                      <ChevronRight className="size-3.5" aria-hidden />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <ComplaintDetailDialog
        complaint={selected}
        onClose={() => setSelected(null)}
        onUpdated={(updated) => {
          setSelected(updated);
          reload();
        }}
      />
    </div>
  );
}

// ============================================================
// Dialog détail admin : contexte, fil, réponse, actions
// ============================================================

function ComplaintDetailDialog({
  complaint,
  onClose,
  onUpdated,
}: {
  complaint: AdminComplaintDTO | null;
  onClose: () => void;
  onUpdated: (updated: AdminComplaintDTO) => void;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"reply" | "assign" | "status" | null>(null);

  const reset = () => {
    setReply("");
    setSending(false);
    setActing(null);
  };

  const sendReply = async () => {
    if (!complaint || !reply.trim()) return;
    setActing("reply");
    setSending(true);
    try {
      const updated = await api.clientAdmin.replyComplaint(complaint.id, reply.trim());
      toast.success("Réponse envoyée au client.");
      setReply("");
      onUpdated(updated);
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setSending(false);
      setActing(null);
    }
  };

  const assignToSelf = async () => {
    if (!complaint) return;
    setActing("assign");
    try {
      const updated = await api.clientAdmin.updateComplaint(complaint.id, { assignToSelf: true });
      toast.success("Réclamation assignée à votre compte.");
      onUpdated(updated);
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setActing(null);
    }
  };

  const changeStatus = async (target: ComplaintStatus) => {
    if (!complaint) return;
    setActing("status");
    try {
      const updated = await api.clientAdmin.updateComplaint(complaint.id, { status: target });
      toast.success(`Statut mis à jour : ${COMPLAINT_STATUS_LABELS[target].toLowerCase()}.`);
      onUpdated(updated);
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setActing(null);
    }
  };

  const closed = complaint?.status === "RESOLVED" || complaint?.status === "CLOSED";
  const action = complaint ? nextAction(complaint.status) : null;
  const thread: ComplaintMessageDTO[] = complaint
    ? complaint.messages.length > 0
      ? complaint.messages
      : [{ id: "initial", authorName: complaint.clientName, isStaff: false, message: complaint.message, createdAt: complaint.createdAt }]
    : [];

  return (
    <Dialog
      open={complaint !== null}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {complaint && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                {complaint.subject}
                <Badge variant="outline" className={cn("font-medium", COMPLAINT_STATUS_COLORS[complaint.status])}>
                  {COMPLAINT_STATUS_LABELS[complaint.status]}
                </Badge>
              </DialogTitle>
              <DialogDescription className="font-mono text-[11px]">{complaint.reference}</DialogDescription>
            </DialogHeader>

            {/* Contexte */}
            <div className="grid grid-cols-1 gap-2 rounded-xl border bg-muted/30 p-3 text-xs sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Client : </span>
                <span className="font-semibold">{complaint.clientName}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Téléphone : </span>
                <span className="font-semibold">{formatPhone(complaint.clientPhone)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Catégorie : </span>
                <span className="font-semibold">{complaint.categoryLabel}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Ouverte le : </span>
                <span className="font-semibold">{formatDateTime(complaint.createdAt)}</span>
              </p>
              {complaint.bookingReference && (
                <p>
                  <span className="text-muted-foreground">Billet : </span>
                  <span className="font-mono font-semibold">{complaint.bookingReference}</span>
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Assignée à : </span>
                <span className="font-semibold">{complaint.assignedToName ?? "— personne —"}</span>
              </p>
            </div>

            {/* Fil */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Fil de discussion</p>
              <div className="nzoko-scroll max-h-[40vh] space-y-3 overflow-y-auto pr-1" role="log" aria-label="Messages de la réclamation">
                {thread.map((m) => (
                  <div key={m.id} className={cn("flex", m.isStaff ? "justify-start" : "justify-end")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5",
                        m.isStaff ? "border bg-card" : "bg-muted",
                      )}
                    >
                      <p className="text-[11px] font-semibold">
                        {m.authorName}
                        {m.isStaff && <span className="ml-1 font-normal text-primary">· Équipe NZOKO</span>}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{m.message}</p>
                      <p className="mt-1 text-right text-[10px] text-muted-foreground">{formatDateTime(m.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Réponse */}
            <div className="space-y-2">
              <label htmlFor="admin-complaint-reply" className="block text-sm font-medium">
                Répondre au client
              </label>
              <Textarea
                id="admin-complaint-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value.slice(0, 2000))}
                rows={3}
                maxLength={2000}
                placeholder="Votre réponse sera visible par le client…"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">{reply.length}/2000</p>
                <Button onClick={sendReply} disabled={sending || !reply.trim()} className="h-10 gap-1.5">
                  {acting === "reply" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                  {acting === "reply" ? "Envoi…" : "Envoyer la réponse"}
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
              {!complaint.assignedToName && complaint.status !== "CLOSED" && (
                <Button
                  variant="outline"
                  onClick={assignToSelf}
                  disabled={acting !== null}
                  className="h-10 flex-1 gap-1.5"
                >
                  {acting === "assign" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserRound className="size-4" aria-hidden />}
                  Prendre en charge
                </Button>
              )}
              {action && (
                <Button
                  onClick={() => changeStatus(action.target)}
                  disabled={acting !== null}
                  className="h-10 flex-1 gap-1.5"
                >
                  {acting === "status" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <action.icon className="size-4" aria-hidden />}
                  {action.label}
                </Button>
              )}
              {closed && !action && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> Réclamation clôturée.
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
