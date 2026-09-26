"use client";

// ============================================================
// Océan du Nord — Bouton copier (références NZK-…, tokens, etc.)
// ============================================================

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NzokoCopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: "default" | "sm" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
}

export function NzokoCopyButton({ value, label, className, size = "sm", variant = "outline" }: NzokoCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback anciens navigateurs
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (size === "icon") {
    return (
      <Button
        type="button"
        variant={variant}
        size="icon"
        onClick={copy}
        aria-label={`Copier ${label ?? "la valeur"}`}
        className={cn("size-9", className)}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={cn("gap-1.5", className)}>
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copié" : (label ?? "Copier")}
    </Button>
  );
}
