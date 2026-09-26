"use client";

// ============================================================
// Océan du Nord — Évaluation post-voyage (dialog)
// 5 critères notés de 1 à 5 étoiles + commentaire optionnel.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Star, StarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { friendlyApiError } from "@/components/shared/nzoko-use-api";
import { cn } from "@/lib/utils";
import type { ClientTripDTO } from "@/types";

const CRITERIA = [
  { key: "cleanliness", label: "Propreté" },
  { key: "comfort", label: "Confort" },
  { key: "punctuality", label: "Ponctualité" },
  { key: "staff", label: "Personnel" },
  { key: "security", label: "Sécurité" },
] as const;

type CriterionKey = (typeof CRITERIA)[number]["key"];
type Ratings = Record<CriterionKey, number>;

const EMPTY_RATINGS: Ratings = { cleanliness: 0, comfort: 0, punctuality: 0, staff: 0, security: 0 };

export function RatingDialog({
  trip,
  open,
  onOpenChange,
  onDone,
}: {
  trip: ClientTripDTO | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [ratings, setRatings] = useState<Ratings>(EMPTY_RATINGS);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRatings(EMPTY_RATINGS);
      setComment("");
      setError(null);
    }
  }, [open]);

  const allRated = CRITERIA.every((c) => ratings[c.key] > 0);

  const submit = async () => {
    if (!trip || !allRated) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.client.rateTrip({
        bookingId: trip.bookingId,
        cleanliness: ratings.cleanliness,
        comfort: ratings.comfort,
        punctuality: ratings.punctuality,
        staff: ratings.staff,
        security: ratings.security,
        comment: comment.trim() ? comment.trim() : undefined,
      });
      toast.success("Merci pour votre retour ⭐", { description: "Votre évaluation aide toute la communauté Océan du Nord." });
      onDone();
      onOpenChange(false);
    } catch (err) {
      const message = friendlyApiError(err).message;
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="size-5 text-amber-500" aria-hidden /> Comment s&apos;est passé votre voyage ?
          </DialogTitle>
          <DialogDescription>
            {trip
              ? `${trip.originCityName} → ${trip.destinationCityName} · ${formatDateTime(trip.departureTime)}`
              : "Votre avis compte"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {CRITERIA.map((criterion) => (
            <div key={criterion.key}>
              <p id={`rating-label-${criterion.key}`} className="mb-1 text-sm font-medium">
                {criterion.label}
              </p>
              <div role="group" aria-labelledby={`rating-label-${criterion.key}`} className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => {
                  const active = ratings[criterion.key] >= value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={`${criterion.label} : note ${value} sur 5`}
                      aria-pressed={active}
                      onClick={() => setRatings((r) => ({ ...r, [criterion.key]: value }))}
                      className="flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-muted"
                    >
                      <Star
                        className={cn(
                          "size-6 transition-colors",
                          active ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <label htmlFor="rating-comment" className="mb-1.5 block text-sm font-medium">
              Commentaire <span className="font-normal text-muted-foreground">(optionnel)</span>
            </label>
            <Textarea
              id="rating-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 200))}
              rows={3}
              maxLength={200}
              placeholder="Un détail à partager avec nos équipes ?"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{comment.length}/200</p>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={submit} disabled={!allRated || submitting} className="h-11 w-full gap-1.5">
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <StarIcon className="size-4" aria-hidden />}
            {submitting ? "Envoi…" : "Envoyer mon évaluation"}
          </Button>
          {!allRated && <p className="text-center text-[11px] text-muted-foreground">Notez les 5 critères pour envoyer.</p>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
