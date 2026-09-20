"use client";

// ============================================================
// NZOKO TRANSPORT — Enregistrement PWA + invite d'installation
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Download, X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "nzoko-install-dismissed";

export function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // 1. Service worker : PRODUCTION UNIQUEMENT.
    //    ⚠️ Incident 2026-09-19 « ChunkLoadError admin » : en dev,
    //    Turbopack réécrit le CONTENU des chunks sous des URL stables
    //    à chaque recompilation/restart — un SW cache-first servait
    //    des modules périmés même après F5 (graphe de modules cassé →
    //    ChunkLoadError persistant sur l'espace admin). En dev, on
    //    purge au contraire tout SW résiduel + caches NZOKO (guérit
    //    un navigateur intoxiqué par une ancienne version du SW).
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          // échec silencieux : l'app reste utilisable sans PWA
        });
      } else {
        // DEV : nettoyage préventif (enregistrements + caches).
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => {
            registrations.forEach((registration) => {
              void registration.unregister().catch(() => {});
            });
          })
          .catch(() => {
            // API indisponible : on ignore (aucun SW, rien à purger).
          });
        if ("caches" in window) {
          caches
            .keys()
            .then((keys) => {
              keys
                .filter((key) => key.startsWith("nzoko-"))
                .forEach((key) => {
                  void caches.delete(key);
                });
            })
            .catch(() => {});
        }
      }
    }

    // 2. Détection plateforme + dismissal — différés hors du corps synchrone
    const detect = setTimeout(() => {
      const ua = window.navigator.userAgent;
      const ios = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
      setIsIOS(ios);
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    }, 0);

    // 3. Invite d'installation Android/Chrome/Edge
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      clearTimeout(detect);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }, []);

  if (dismissed) return null;

  if (isIOS) {
    return (
      <div className="mx-auto mb-4 flex max-w-6xl items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 px-4 text-amber-900">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">Installez NZOKO sur votre iPhone</p>
          <p className="text-xs opacity-80">
            Touchez <strong>Partager</strong> puis <strong>« Sur l’écran d’accueil »</strong> pour un accès rapide à vos billets.
          </p>
        </div>
        <button onClick={dismiss} aria-label="Fermer" className="rounded-lg p-1.5 hover:bg-amber-100 min-h-[40px] min-w-[40px]">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!deferredPrompt) return null;

  return (
    <div className="mx-auto mb-4 flex max-w-6xl items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 px-4">
      <Download className="h-5 w-5 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-primary">Installer l’application NZOKO</p>
        <p className="text-xs text-muted-foreground">Accès rapide, plein écran et fonctionnement hors ligne de l’interface.</p>
      </div>
      <Button size="sm" onClick={install} className="h-9">
        Installer
      </Button>
      <button onClick={dismiss} aria-label="Fermer" className="rounded-lg p-1.5 hover:bg-muted min-h-[40px] min-w-[40px]">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
