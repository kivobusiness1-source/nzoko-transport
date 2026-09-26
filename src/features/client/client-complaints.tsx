"use client";

// ============================================================
// Océan du Nord — Réclamations client : liste (référence copiable,
// catégorie avec icône), fil de discussion en bulles (client à
// droite, équipe Océan du Nord à gauche), composer, création (dialog).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Bus, ChevronRight, Clock, Copy, CreditCard, Lightbulb, Loader2, Lock, MessageSquare, Plus, Send, Ticket, UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { friendlyApiError, useApiData, type ApiErrorInfo } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUS_LABELS } from "@/lib/constants";
import type { ComplaintCategory, ComplaintStatus } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ComplaintDetailDTO, ComplaintMessageDTO } from "@/types";

// Couleurs de statut — AUCUN bleu : IN_PROGRESS en teal, le reste
// ambre / vert / rouge (palette « terre congolaise » du projet).
const STATUS_UI: Record<ComplaintStatus, { className: string; dot: string }> = {
  OPEN: { className: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  IN_PROGRESS: { className: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500" },
  RESOLVED: { className: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  CLOSED: { className: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-500" },
};

const CATEGORY_ICONS: Record<ComplaintCategory, LucideIcon> = {
  TICKET: Ticket,
  BUS: Bus,
  STAFF: UserRound,
  PAYMENT: CreditCard,
  DELAY: Clock,
  SUGGESTION: Lightbulb,
  COMPLAINT: MessageSquare,
};

function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  const meta = STATUS_UI[status];
  return (
    <Badge variant="outline" className={cn("shrink-0 gap-1.5 font-medium", meta.className)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {COMPLAINT_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Petit bouton « copier la référence » (repli textarea + toast). */
function CopyReferenceButton({ value }: { value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Repli anciens navigateurs / contextes sans permission clipboard
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        toast.error("Copie impossible sur ce navigateur.");
        return;
      }
    }
    toast.success("Référence copiée", { description: value });
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-primary"
      onClick={copy}
      aria-label={`Copier la référence ${value}`}
      title="Copier la référence"
    >
      <Copy className="size-3.5" aria-hidden />
    </Button>
  );
}

export function ClientComplaints({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.client.complaints(), { refreshKey });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (selectedId) {
    return (
      <ComplaintDetail
        id={selectedId}
        onBack={() => {
          setSelectedId(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Une question ou un souci ? Nos équipes vous répondent ici.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="h-10 shrink-0 gap-1.5">
          <Plus className="size-4" aria-hidden /> Nouvelle réclamation
        </Button>
      </div>

      {loading ? (
        <NzokoListSkeleton count={3} />
      ) : error ? (
        <NzokoErrorBox error={error} onRetry={reload} />
      ) : (data ?? []).length === 0 ? (
        <NzokoEmptyState
          icon={MessageSquare}
          title="Aucune réclamation"
          description="Tout va bien ! Si un souci survient pendant un voyage, écrivez-nous — nous répondons rapidement."
          action={
            <Button variant="outline" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" aria-hidden /> Nouvelle réclamation
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {(data ?? []).map((c) => {
            const CategoryIcon = CATEGORY_ICONS[c.category] ?? MessageSquare;
            return (
              <Card key={c.id} className="nzoko-fade-up gap-0 py-0 transition-colors hover:border-primary/40">
                <CardContent className="p-4">
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`Ouvrir la réclamation ${c.reference} : ${c.subject}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                          aria-hidden
                        >
                          <CategoryIcon className="size-4.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{c.subject}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {c.categoryLabel} · {formatDateTime(c.createdAt)}
                          </span>
                        </span>
                      </span>
                      <ComplaintStatusBadge status={c.status} />
                    </span>
                    <span className="mt-2.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                      {c.preview}
                    </span>
                  </button>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
                    <span className="flex min-w-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                      <span className="truncate">{c.reference}</span>
                      <CopyReferenceButton value={c.reference} />
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      {c.messageCount} message{c.messageCount > 1 ? "s" : ""}
                      <ChevronRight className="size-3.5" aria-hidden />
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <NewComplaintDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(detail) => {
          reload();
          setSelectedId(detail.id);
        }}
      />
    </div>
  );
}

// ============================================================
// Détail d'une réclamation (fil + réponse)
// ============================================================

function ComplaintDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ComplaintDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.client.complaint(id));
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReply = async () => {
    if (!detail || !reply.trim()) return;
    setSending(true);
    try {
      const updated = await api.client.replyComplaint(detail.id, { message: reply.trim() });
      setDetail(updated);
      setReply("");
      toast.success("Message envoyé.");
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <NzokoListSkeleton count={3} />;
  if (error) return <NzokoErrorBox error={error} onRetry={load} />;
  if (!detail) return null;

  const closed = detail.status === "RESOLVED" || detail.status === "CLOSED";
  // File de messages — repli : message initial seul si le fil est vide.
  const thread: ComplaintMessageDTO[] =
    detail.messages.length > 0
      ? detail.messages
      : [{ id: "initial", authorName: "Vous", isStaff: false, message: detail.message, createdAt: detail.createdAt }];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 h-9 gap-1">
        <ArrowLeft className="size-4" aria-hidden /> Toutes mes réclamations
      </Button>

      {/* En-tête de la réclamation */}
      <Card className="nzoko-fade-up">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-bold">{detail.subject}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
                {detail.reference}
                <CopyReferenceButton value={detail.reference} />
              </p>
            </div>
            <ComplaintStatusBadge status={detail.status} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{detail.categoryLabel}</span>
            <span>Ouverte le {formatDateTime(detail.createdAt)}</span>
            {detail.bookingReference && (
              <span className="font-mono text-[10px]">Billet {detail.bookingReference}</span>
            )}
            {detail.assignedToName && <span>Prise en charge par {detail.assignedToName}</span>}
            {detail.resolvedAt && <span>Résolue le {formatDateTime(detail.resolvedAt)}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Fil de discussion en bulles */}
      <Card className="nzoko-fade-up">
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">Discussion</p>
          <div className="nzoko-scroll max-h-[45vh] space-y-3 overflow-y-auto pr-1" role="log" aria-label="Messages de la réclamation">
            {thread.map((m) => (
              <div key={m.id} className={cn("flex items-end gap-2", m.isStaff ? "justify-start" : "justify-end")}>
                {m.isStaff && (
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary"
                    aria-hidden
                  >
                    Océan du Nord
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5",
                    m.isStaff ? "border bg-muted/60" : "bg-primary text-primary-foreground",
                  )}
                >
                  <p className={cn("text-[11px] font-semibold", !m.isStaff && "text-primary-foreground/80")}>
                    {m.authorName}
                    {m.isStaff && <span className="ml-1 font-normal text-primary">· Équipe Océan du Nord</span>}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{m.message}</p>
                  <p className={cn("mt-1 text-right text-[10px]", m.isStaff ? "text-muted-foreground" : "text-primary-foreground/70")}>
                    {formatDateTime(m.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          {closed ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Lock className="size-4 shrink-0" aria-hidden />
              Réclamation clôturée — ouvrez une nouvelle réclamation si nécessaire.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              <label htmlFor="complaint-reply" className="block text-sm font-medium">
                Votre réponse
              </label>
              <Textarea
                id="complaint-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value.slice(0, 2000))}
                rows={3}
                maxLength={2000}
                placeholder="Complétez votre demande…"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">{reply.length}/2000</p>
                <Button onClick={sendReply} disabled={sending || !reply.trim()} className="h-10 gap-1.5">
                  {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                  {sending ? "Envoi…" : "Envoyer"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Dialog création de réclamation
// ============================================================

function NewComplaintDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (detail: ComplaintDetailDTO) => void;
}) {
  const [category, setCategory] = useState<ComplaintCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCategory("");
      setSubject("");
      setMessage("");
      setBookingReference("");
      setFormError(null);
    }
  }, [open]);

  const submit = async () => {
    setFormError(null);
    if (!category) {
      setFormError("Choisissez une catégorie.");
      return;
    }
    if (subject.trim().length < 3) {
      setFormError("Le sujet est requis (3 caractères minimum).");
      return;
    }
    if (message.trim().length < 10) {
      setFormError("Décrivez votre demande (10 caractères minimum).");
      return;
    }
    setSubmitting(true);
    try {
      const detail = await api.client.createComplaint({
        category,
        subject: subject.trim(),
        message: message.trim(),
        bookingReference: bookingReference.trim() ? bookingReference.trim() : undefined,
      });
      toast.success("Réclamation envoyée", { description: "Notre équipe vous répondra ici rapidement." });
      onOpenChange(false);
      onCreated(detail);
    } catch (err) {
      const msg = friendlyApiError(err).message;
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-5 text-primary" aria-hidden /> Nouvelle réclamation
          </DialogTitle>
          <DialogDescription>
            Décrivez votre demande — nos équipes vous répondent dans votre espace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5">Catégorie</Label>
            <Select value={category || undefined} onValueChange={(v) => setCategory(v as ComplaintCategory)}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder="Choisir une catégorie" />
              </SelectTrigger>
              <SelectContent>
                {COMPLAINT_CATEGORIES.map((c) => {
                  const Icon = CATEGORY_ICONS[c];
                  return (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <Icon className="size-4 text-primary" aria-hidden />
                        {COMPLAINT_CATEGORY_LABELS[c]}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="complaint-subject" className="mb-1.5">Sujet</Label>
            <Input
              id="complaint-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, 120))}
              maxLength={120}
              className="h-11"
              placeholder="Ex : retard au départ de Brazzaville"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{subject.length}/120</p>
          </div>

          <div>
            <Label htmlFor="complaint-message" className="mb-1.5">Votre message</Label>
            <Textarea
              id="complaint-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
              rows={5}
              maxLength={2000}
              placeholder="Décrivez la situation, la date, le voyage concerné…"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{message.length}/2000</p>
          </div>

          <div>
            <Label htmlFor="complaint-booking" className="mb-1.5">
              Référence du billet <span className="font-normal text-muted-foreground">(optionnel)</span>
            </Label>
            <Input
              id="complaint-booking"
              value={bookingReference}
              onChange={(e) => setBookingReference(e.target.value)}
              className="h-11 font-mono"
              placeholder="NZK-2026-XXXXXX"
            />
          </div>

          {formError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={submit} disabled={submitting} className="h-11 w-full gap-1.5">
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {submitting ? "Envoi…" : "Envoyer ma réclamation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
