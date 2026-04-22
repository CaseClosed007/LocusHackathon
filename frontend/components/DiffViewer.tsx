"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  diff: Record<string, string>;
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return <div className="text-white/30 font-mono text-xs leading-5">{line}</div>;
  }
  if (line.startsWith("@@")) {
    return (
      <div className="text-cyan-400/60 font-mono text-xs leading-5 bg-cyan-400/5 px-1 rounded">
        {line}
      </div>
    );
  }
  if (line.startsWith("+")) {
    return (
      <div className="font-mono text-xs leading-5 text-emerald-300"
        style={{ background: "rgba(0,255,135,0.07)" }}>
        {line}
      </div>
    );
  }
  if (line.startsWith("-")) {
    return (
      <div className="font-mono text-xs leading-5 text-red-300"
        style={{ background: "rgba(239,68,68,0.08)" }}>
        {line}
      </div>
    );
  }
  return <div className="font-mono text-xs leading-5 text-white/35">{line}</div>;
}

function FileDiff({ filename, content }: { filename: string; content: string }) {
  const [open, setOpen] = useState(true);
  const lines = content.split("\n");
  const added   = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  return (
    <div className="rounded-lg overflow-hidden border"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <span className="text-xs font-mono text-white/60 flex-1 truncate">{filename}</span>
        <span className="text-[10px] font-mono text-emerald-400/70">+{added}</span>
        <span className="text-[10px] font-mono text-red-400/70">-{removed}</span>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-white/20 text-xs shrink-0"
        >
          ›
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="diff-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            style={{ overflow: "hidden" }}
          >
            <pre
              className="overflow-x-auto p-3 max-h-56 text-xs"
              style={{ background: "rgba(0,0,0,0.3)", scrollbarWidth: "thin" }}
            >
              {lines.map((line, i) => (
                <DiffLine key={i} line={line} />
              ))}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DiffViewer({ diff }: Props) {
  const entries = Object.entries(diff).filter(([, c]) => c.trim().length > 0);
  if (entries.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="mt-2 ml-14 space-y-1"
    >
      <div className="text-[10px] font-mono text-white/20 tracking-widest mb-2">
        DIFF — {entries.length} FILE{entries.length !== 1 ? "S" : ""} PATCHED
      </div>
      {entries.map(([name, content]) => (
        <FileDiff key={name} filename={name} content={content} />
      ))}
    </motion.div>
  );
}
