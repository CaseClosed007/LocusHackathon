"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  files: Record<string, string>;
}

const LANG_COLORS: Record<string, string> = {
  py:   "#3b82f6",
  js:   "#f59e0b",
  ts:   "#06b6d4",
  html: "#f97316",
  css:  "#a855f7",
  json: "#10b981",
  txt:  "#6b7280",
  md:   "#8b5cf6",
  toml: "#ec4899",
  yml:  "#84cc16",
  yaml: "#84cc16",
};

function ext(filename: string) {
  return filename.split(".").pop() ?? "txt";
}

function langColor(filename: string) {
  return LANG_COLORS[ext(filename)] ?? "#6b7280";
}

function lineCount(content: string) {
  return content.split("\n").length;
}

function downloadAll(files: Record<string, string>) {
  const parts = Object.entries(files).map(
    ([name, content]) =>
      `${"=".repeat(60)}\n# FILE: ${name}\n${"=".repeat(60)}\n${content}`
  );
  const blob = new Blob([parts.join("\n\n")], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "locus-deploy.txt";
  a.click();
  URL.revokeObjectURL(url);
}

function copyText(text: string, setCopied: (v: boolean) => void) {
  navigator.clipboard.writeText(text).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });
}

function FileBlock({ filename, content }: { filename: string; content: string }) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);
  const color               = langColor(filename);

  return (
    <div className="rounded-lg overflow-hidden border"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}>

      {/* File header row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.03] transition-colors"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        {/* Lang dot */}
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />

        {/* Filename */}
        <span className="flex-1 text-left text-xs font-mono text-white/70 truncate">
          {filename}
        </span>

        {/* Line count */}
        <span className="text-[10px] font-mono text-white/20 shrink-0">
          {lineCount(content)}L
        </span>

        {/* Chevron */}
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-white/20 text-xs shrink-0"
        >
          ›
        </motion.span>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            style={{ overflow: "hidden" }}
          >
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-b"
              style={{ borderColor: "rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.01)" }}>
              <span className="text-[10px] font-mono" style={{ color }}>
                .{ext(filename)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); copyText(content, setCopied); }}
                className="text-[10px] font-mono px-2 py-0.5 rounded border transition-all duration-150"
                style={{
                  borderColor: copied ? "rgba(0,255,135,0.4)" : "rgba(255,255,255,0.1)",
                  color:       copied ? "#00ff87" : "rgba(255,255,255,0.3)",
                }}
              >
                {copied ? "✓ COPIED" : "COPY"}
              </button>
            </div>

            {/* Code */}
            <pre
              className="text-xs font-mono leading-relaxed overflow-x-auto p-3 max-h-64"
              style={{
                background: "rgba(0,0,0,0.3)",
                color: "rgba(255,255,255,0.75)",
                scrollbarWidth: "thin",
              }}
            >
              {content}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CodeViewer({ files }: Props) {
  const [allOpen, setAllOpen]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const entries                 = Object.entries(files);

  function handleCopyAll() {
    const text = entries
      .map(([n, c]) => `# ${n}\n${c}`)
      .join("\n\n" + "─".repeat(40) + "\n\n");
    copyText(text, setCopied);
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="mt-2 ml-14 space-y-1"
    >
      {/* Toolbar row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-white/20 tracking-widest">
          {entries.length} FILE{entries.length !== 1 ? "S" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAllOpen((o) => !o)}
            className="text-[10px] font-mono text-white/25 hover:text-white/50 transition-colors"
          >
            {allOpen ? "COLLAPSE ALL" : "EXPAND ALL"}
          </button>
          <span className="text-white/10">·</span>
          <button
            onClick={handleCopyAll}
            className="text-[10px] font-mono transition-colors"
            style={{ color: copied ? "#00ff87" : "rgba(255,255,255,0.25)" }}
          >
            {copied ? "✓ COPIED" : "COPY ALL"}
          </button>
          <span className="text-white/10">·</span>
          <button
            onClick={() => downloadAll(files)}
            className="text-[10px] font-mono text-white/25 hover:text-white/50 transition-colors"
          >
            ↓ DOWNLOAD
          </button>
        </div>
      </div>

      {/* File blocks */}
      <div className="space-y-1">
        {entries.map(([name, content]) => (
          <FileBlock key={name} filename={name} content={content} />
        ))}
      </div>
    </motion.div>
  );
}
