"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AgentThought, BrandContext } from "@/lib/types";
import { ThoughtLine } from "./ThoughtLine";
import { useIterateStream } from "@/lib/useIterateStream";

interface EditContext {
  projectId: string;
  sourceCode: Record<string, string>;
  runtime: string;
  serviceUrl?: string;
  brandContext?: BrandContext;
}

interface IterationRound {
  id: string;
  request: string;
  thoughts: AgentThought[];
  startTime: number;
}

interface Props {
  editContext: EditContext;
  onSourceUpdated: (newSource: Record<string, string>) => void;
}

const EDIT_SUGGESTIONS = [
  "Make the hero section dark mode",
  "Change the primary color to deep blue",
  "Add a newsletter signup form",
  "Make the layout mobile-responsive",
  "Add smooth scroll animations",
  "Change the font to something more modern",
];

export function IteratePanel({ editContext, onSourceUpdated }: Props) {
  const [input, setInput]         = useState("");
  const [rounds, setRounds]       = useState<IterationRound[]>([]);
  const [activeId, setActiveId]   = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { thoughts, isStreaming, iterate, cancel } = useIterateStream();

  // Merge streaming thoughts into the active round
  const prevThoughtsRef = useRef<AgentThought[]>([]);
  if (JSON.stringify(thoughts) !== JSON.stringify(prevThoughtsRef.current)) {
    prevThoughtsRef.current = thoughts;
    if (activeId) {
      setRounds((prev) =>
        prev.map((r) =>
          r.id === activeId ? { ...r, thoughts: [...thoughts] } : r
        )
      );
      // Check if last thought is success — extract updated source code
      const last = thoughts[thoughts.length - 1];
      if (last?.type === "success" && last.metadata?.files) {
        onSourceUpdated(last.metadata.files as Record<string, string>);
      }
    }
  }

  async function handleSubmit() {
    const req = input.trim();
    if (!req || isStreaming) return;

    const id = crypto.randomUUID();
    setActiveId(id);
    setRounds((prev) => [
      ...prev,
      { id, request: req, thoughts: [], startTime: Date.now() },
    ]);
    setInput("");
    inputRef.current?.focus();

    await iterate({
      editRequest:  req,
      sourceCode:   editContext.sourceCode,
      projectId:    editContext.projectId,
      runtime:      editContext.runtime,
      serviceUrl:   editContext.serviceUrl,
      brandContext: editContext.brandContext,
    });
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="mt-3 ml-6"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="w-px h-4 bg-gradient-to-b from-emerald-500/40 to-transparent" />
        <span className="text-[10px] font-mono text-white/25 tracking-widest">ITERATIVE EDITOR</span>
        <div className="flex-1 h-px bg-white/[0.04]" />
        <span className="text-[9px] font-mono text-white/15">
          {rounds.length} edit{rounds.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Previous rounds */}
      <AnimatePresence initial={false}>
        {rounds.map((round) => {
          const isActive = round.id === activeId && isStreaming;
          const lastThought = round.thoughts[round.thoughts.length - 1];
          const isSuccess = lastThought?.type === "success";
          return (
            <motion.div
              key={round.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 rounded-xl overflow-hidden border"
              style={{
                borderColor: isSuccess ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.05)",
                background: "rgba(255,255,255,0.015)",
              }}
            >
              {/* Edit request label */}
              <div className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
                <span className="text-emerald-400/60 font-mono text-xs">✎</span>
                <span className="text-[11px] font-mono text-white/50 flex-1 truncate">{round.request}</span>
                {isActive && (
                  <span className="flex items-center gap-1 text-[9px] font-mono text-amber-400/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-pulse" />
                    EDITING
                  </span>
                )}
                {isSuccess && (
                  <span className="text-[9px] font-mono text-emerald-400/60">✓ APPLIED</span>
                )}
              </div>

              {/* Thoughts */}
              <div className="py-1">
                {round.thoughts.map((t, i) => (
                  <ThoughtLine
                    key={i}
                    thought={t}
                    index={i}
                    startTs={round.startTime}
                    isLatest={i === round.thoughts.length - 1 && isActive}
                  />
                ))}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Edit input */}
      <div className="rounded-xl border overflow-hidden"
        style={{ borderColor: "rgba(0,255,135,0.15)", background: "rgba(255,255,255,0.02)" }}>

        {/* Suggestion chips — only shown when idle and no rounds yet */}
        {!isStreaming && rounds.length === 0 && (
          <div className="px-3 pt-2.5 pb-1 flex gap-1.5 flex-wrap">
            {EDIT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => { setInput(s); inputRef.current?.focus(); }}
                className="text-[9px] font-mono text-white/25 hover:text-white/60 px-2 py-1 rounded-md border transition-all duration-150"
                style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Textarea row */}
        <div className="flex items-end gap-3 px-3 py-2.5">
          <span className="text-emerald-400/50 font-mono text-sm shrink-0 pb-0.5 select-none">✎</span>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={isStreaming}
            placeholder={isStreaming ? "Applying edit…" : "Describe your change — e.g. 'make the hero dark mode'"}
            rows={1}
            className="flex-1 bg-transparent text-white placeholder-white/20 font-mono text-sm
                       resize-none outline-none leading-relaxed max-h-28 overflow-y-auto
                       disabled:opacity-40 transition-opacity"
            style={{ minHeight: "22px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
            }}
          />

          <div className="shrink-0 pb-0.5">
            {isStreaming ? (
              <button
                onClick={cancel}
                className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold tracking-wider
                           border border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20"
              >
                ■ STOP
              </button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold tracking-wider
                           border border-emerald-500/40 text-emerald-400 bg-emerald-500/10
                           hover:bg-emerald-500/20 disabled:opacity-25 disabled:cursor-not-allowed"
              >
                APPLY ↵
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
