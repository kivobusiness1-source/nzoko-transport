"use client";

// ============================================================
// NZOKO TRANSPORT — Assistant IA flottant (voyages · promotions · prix)
// Widget conversationnel public branché sur POST /api/chat.
//  - FAB en bas à droite (au-dessus de la nav mobile)
//  - Panneau : bottom-sheet plein écran sur mobile, carte fixe sur desktop
//  - Suggestions de départ, indicateur de frappe, erreurs en ligne
//  - Accessible : dialog non-modal, aria-live, Échap pour fermer
// Le rendu des réponses est du TEXTE enrichi maison (gras + listes),
// jamais de HTML brut (aucune injection possible).
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, CircleAlert, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api-client";
import { formatTime } from "@/lib/format";
import type { ChatMessageDTO } from "@/types";

interface ChatBubble extends ChatMessageDTO {
  id: string;
  time: string;
}

const WELCOME_TEXT =
  "Bonjour 👋 Je suis Nzoko Assistant, votre guide voyage NZOKO TRANSPORT.\nPosez-moi vos questions sur les trajets, les horaires, les prix en FCFA, les places disponibles et les promotions du moment.";

const SUGGESTIONS = [
  "🎯 Y a-t-il des promotions en ce moment ?",
  "💰 Quel est le prix Pointe-Noire → Brazzaville ?",
  "🕐 Quels sont les prochains départs ?",
  "💳 Comment payer mon billet ?",
];

// L'historique envoyé au serveur est borné (le plus récent en dernier)
const MAX_HISTORY = 10;
const MAX_INPUT = 1500;

/** Gras **…** + listes « - » / numérotées → React sécurisé (aucun HTML brut). */
function inlineBold(text: string, keyBase: string): ReactNode[] {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={`${keyBase}-b${i}`} className="font-semibold">{part}</strong> : part
  );
}

function renderRich(content: string): ReactNode[] {
  return content.split("\n").map((raw, i) => {
    const line = raw.trim();
    const key = `l${i}`;
    if (!line) return <div key={key} className="h-1.5" aria-hidden="true" />;
    const bullet = /^[-•*]\s+/.test(line);
    const numbered = /^\d+[.)]\s+/.test(line);
    const text = bullet
      ? line.replace(/^[-•*]\s+/, "")
      : numbered
        ? line.replace(/^\d+[.)]\s+/, "")
        : line.replace(/^#+\s*/, "");
    if (bullet) {
      return (
        <p key={key} className="flex gap-1.5">
          <span aria-hidden="true" className="text-primary select-none">•</span>
          <span>{inlineBold(text, key)}</span>
        </p>
      );
    }
    return <p key={key} className={numbered ? "pl-1" : ""}>{inlineBold(text, key)}</p>;
  });
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-2" role="status" aria-label="L'assistant écrit…">
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70"
          style={{ animationDelay: `${d * 150}ms` }}
        />
      ))}
    </div>
  );
}

export function NzokoChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);

  // Défilement automatique vers le dernier message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  // Échap ferme le panneau (clavier physique)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus clavier au premier plan (desktop uniquement — pas de clavier virtuel mobile)
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || pending) return;

      const now = formatTime(new Date());
      const userMsg: ChatBubble = { id: `u${++idRef.current}`, role: "user", content: text.slice(0, MAX_INPUT), time: now };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setError(null);
      setPending(true);

      try {
        // Historique borné : les échanges réels uniquement (le message
        // d'accueil statique n'est pas envoyé — le modèle ne l'a pas écrit)
        const history: ChatMessageDTO[] = [...messages, userMsg]
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-MAX_HISTORY)
          .map((m) => ({ role: m.role, content: m.content }));

        const { reply } = await api.chat.send(history);
        setMessages((prev) => [...prev, { id: `a${++idRef.current}`, role: "assistant", content: reply, time: formatTime(new Date()) }]);
      } catch (err) {
        const msg =
          err instanceof ApiClientError
            ? err.message
            : "L'assistant est momentanément indisponible. Réessayez dans un instant.";
        setError(msg);
      } finally {
        setPending(false);
      }
    },
    [messages, pending]
  );

  const reset = useCallback(() => {
    if (pending) return;
    setMessages([]);
    setError(null);
  }, [pending]);

  return (
    <>
      {/* ----- FAB (bouton flottant) ----- */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="chat-fab"
            initial={{ opacity: 0, scale: 0.8, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            onClick={() => setOpen(true)}
            aria-label="Ouvrir l'assistant NZOKO — voyages, promotions et prix"
            aria-expanded={open}
            data-testid="chat-fab"
            className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
          >
            <MessageCircle className="h-6 w-6" aria-hidden="true" />
            <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-white shadow">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ----- Fond d'assombrissement (mobile uniquement) ----- */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* ----- Panneau de conversation ----- */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            role="dialog"
            aria-label="Assistant NZOKO — voyages, promotions et prix"
            data-testid="chat-panel"
            className="fixed inset-x-0 bottom-0 z-50 flex h-[82dvh] max-h-[82dvh] flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:h-[600px] md:max-h-[78dvh] md:w-[400px] md:rounded-2xl"
          >
            {/* En-tête */}
            <div className="flex items-center gap-3 border-b bg-primary px-4 py-3 text-primary-foreground">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15">
                <Bot className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-sm font-bold">Assistant NZOKO</p>
                <p className="truncate text-[11px] text-primary-foreground/80">Voyages · Promotions · Prix</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={reset}
                aria-label="Effacer la conversation"
                title="Effacer la conversation"
                className="h-10 w-10 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Fermer l'assistant"
                title="Fermer"
                className="h-10 w-10 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>

            {/* Fil de discussion */}
            <div
              ref={scrollRef}
              className="nzoko-scroll flex-1 space-y-3 overflow-y-auto bg-muted/30 px-4 py-4"
              data-testid="chat-messages"
              aria-live="polite"
            >
              {/* Message d'accueil (local, statique) */}
              <div className="flex flex-col gap-1">
                <div className="max-w-[88%] self-start rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
                  {renderRich(WELCOME_TEXT)}
                </div>
                <span className="self-start pl-1 text-[10px] text-muted-foreground">
                  {formatTime(new Date())}
                </span>
              </div>

              {/* Suggestions de départ — tant qu'aucune question posée */}
              {messages.length === 0 && !pending && (
                <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Questions suggérées">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s.slice(s.indexOf(" ") + 1))}
                      className="min-h-[40px] rounded-full border bg-background px-3 py-1.5 text-left text-xs font-medium text-foreground/90 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Bulles de conversation */}
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex flex-col gap-1">
                    <div className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                      {m.content}
                    </div>
                    <span className="self-end pr-1 text-[10px] text-muted-foreground">{m.time}</span>
                  </div>
                ) : (
                  <div key={m.id} className="flex flex-col gap-1">
                    <div className="max-w-[88%] self-start rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
                      <div className="flex flex-col gap-1">{renderRich(m.content)}</div>
                    </div>
                    <span className="self-start pl-1 text-[10px] text-muted-foreground">{m.time}</span>
                  </div>
                )
              )}

              {/* Indicateur de frappe */}
              {pending && (
                <div className="max-w-[60%] self-start rounded-2xl rounded-bl-md border bg-background px-3.5 shadow-sm">
                  <TypingDots />
                </div>
              )}
            </div>

            {/* Erreur en ligne */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    role="alert"
                    className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Barre de saisie */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-end gap-2 border-t bg-background px-3 py-3"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
              <label htmlFor="nzoko-chat-input" className="sr-only">
                Votre question à l'assistant NZOKO
              </label>
              <Input
                id="nzoko-chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={MAX_INPUT}
                placeholder="Posez votre question…"
                autoComplete="off"
                disabled={pending}
                data-testid="chat-input"
                className="min-h-[44px] flex-1 rounded-xl"
              />
              <Button
                type="submit"
                size="icon"
                disabled={pending || !input.trim()}
                aria-label="Envoyer le message"
                data-testid="chat-send"
                className="h-11 w-11 rounded-xl"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>

            {/* Micro-mention de transparence */}
            <p className="flex items-center justify-center gap-1 border-t bg-muted/40 px-2 py-1.5 text-center text-[10px] text-muted-foreground">
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
              Réponses générées par IA — vérifiez toujours les détails avant d'acheter.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default NzokoChat;
