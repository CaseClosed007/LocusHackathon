"use client";

import { AgentThought } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { CodeViewer } from "./CodeViewer";
import { DiffViewer } from "./DiffViewer";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";

interface Props {
  thought: AgentThought;
  index: number;
  isLatest?: boolean;
  startTs?: number;  // turn start time (ms) for elapsed display
}

function fmtElapsed(thoughtTs: number | undefined, startTs: number | undefined): string | null {
  if (!thoughtTs || !startTs) return null;
  const diff = thoughtTs * 1000 - startTs;
  if (diff < 0) return null;
  return diff < 60000
    ? `${(diff / 1000).toFixed(1)}s`
    : `${Math.floor(diff / 60000)}m${Math.floor((diff % 60000) / 1000)}s`;
}

export function ThoughtLine({ thought, index, isLatest, startTs }: Props) {
  const isActive  = isLatest && (thought.type === "thought" || thought.type === "action" || thought.type === "healing");
  const files     = thought.metadata?.files as Record<string, string> | undefined;
  const diff      = thought.metadata?.diff as Record<string, string> | undefined;
  const elapsed   = fmtElapsed(thought.ts, startTs);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      className="py-1.5 px-3"
    >
      {/* Main row */}
      <div className="group flex items-start gap-3 rounded-lg hover:bg-white/[0.02] transition-colors duration-200">
        {/* Line number */}
        <span className="text-[10px] text-white/15 font-mono select-none shrink-0 w-5 text-right pt-0.5 group-hover:text-white/25 transition-colors">
          {String(index + 1).padStart(2, "0")}
        </span>

        {/* Badge */}
        <StatusBadge type={thought.type} pulse={isActive} />

        {/* Message */}
        <span className="flex-1 min-w-0 text-sm leading-relaxed text-slate-300 font-mono">
          <ReactMarkdown
            components={{
              p: ({ children }) => <span>{children}</span>,
              code: ({ children }) => (
                <code className="px-1.5 py-0.5 rounded text-xs font-mono"
                  style={{
                    background: "rgba(0,255,135,0.08)",
                    color: "#00ff87",
                    border: "1px solid rgba(0,255,135,0.2)",
                  }}
                >
                  {children}
                </code>
              ),
              strong: ({ children }) => (
                <strong className="text-white font-semibold">{children}</strong>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">
                  {children}
                </a>
              ),
            }}
          >
            {thought.message}
          </ReactMarkdown>

          {/* Inline cursor on latest active line */}
          {isActive && (
            <span className="inline-block ml-1 w-1.5 h-3.5 bg-emerald-400 cursor-blink align-middle rounded-sm" />
          )}
        </span>

        {/* Elapsed time */}
        {elapsed && !isActive && (
          <span className="shrink-0 text-[9px] font-mono text-white/15 pt-1 tabular-nums">
            [{elapsed}]
          </span>
        )}
      </div>

      {/* Code viewer — shown when thought carries generated/patched files */}
      {files && Object.keys(files).length > 0 && (
        <CodeViewer files={files} />
      )}

      {/* Diff viewer — shown when thought carries a before/after patch diff */}
      {diff && Object.keys(diff).length > 0 && (
        <DiffViewer diff={diff} />
      )}
    </motion.div>
  );
}
