"use client";

// ============================================================
// NZOKO TRANSPORT — Pagination compacte (Préc / Suiv)
// ============================================================

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NzokoPagination({
  page,
  totalPages,
  total,
  onPageChange,
  unit,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  unit?: string;
}) {
  if (totalPages <= 0) return null;
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label="Pagination">
      <p className="text-xs text-muted-foreground">
        Page {page} / {totalPages}
        {total > 0 ? ` · ${total} ${unit ?? "éléments"}` : ""}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Page précédente"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Page suivante"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
