"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "https://locushackathon-production-e3eb.up.railway.app").replace(/\/$/, "");

interface RepoMeta {
  owner: string;
  repo: string;
  description: string;
  stars: number;
  language: string;
  default_branch: string;
  branch: string;
  homepage: string;
  topics: string[];
}

interface Props {
  url: string;
  onDeploy: () => void;
  isDeploying: boolean;
}

const LANG_COLORS: Record<string, string> = {
  Python:     "#3572A5",
  JavaScript: "#f1e05a",
  TypeScript: "#2b7489",
  Go:         "#00ADD8",
  Rust:       "#dea584",
  Ruby:       "#701516",
  Java:       "#b07219",
  "C++":      "#f34b7d",
  C:          "#555555",
  HTML:       "#e34c26",
  CSS:        "#563d7c",
  Shell:      "#89e051",
};

function LanguageDot({ lang }: { lang: string }) {
  const color = LANG_COLORS[lang] ?? "#8b949e";
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-white/60">{lang}</span>
    </span>
  );
}

export function GitHubPreview({ url, onDeploy, isDeploying }: Props) {
  const [meta, setMeta]       = useState<RepoMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    setError("");
    setMeta(null);

    const controller = new AbortController();
    fetch(`${BACKEND_URL}/github/meta?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.detail));
        return r.json();
      })
      .then(setMeta)
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setError(typeof e === "string" ? e : "Could not load repository.");
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [url]);

  return (
    <AnimatePresence mode="wait">
      {loading && (
        <motion.div
          key="loading"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-mono text-white/40"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
        >
          <span className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin" />
          Fetching repository metadata...
        </motion.div>
      )}

      {error && !loading && (
        <motion.div
          key="error"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="px-4 py-2 rounded-xl border text-xs font-mono text-red-400/80"
          style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)" }}
        >
          ⚠ {error}
        </motion.div>
      )}

      {meta && !loading && (
        <motion.div
          key="card"
          initial={{ opacity: 0, y: 6, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
        >
          {/* Card header */}
          <div className="flex items-start justify-between gap-4 px-4 py-3 border-b"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-3 min-w-0">
              {/* GitHub icon */}
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white/70">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-mono font-semibold text-white truncate">
                  {meta.owner}/<span className="text-emerald-300">{meta.repo}</span>
                </div>
                {meta.description && (
                  <div className="text-xs text-white/40 font-mono truncate mt-0.5">
                    {meta.description}
                  </div>
                )}
              </div>
            </div>

            {/* Stars */}
            <div className="flex items-center gap-1 text-xs font-mono text-white/40 shrink-0">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-yellow-400/70">
                <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
              </svg>
              <span>{meta.stars.toLocaleString()}</span>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs font-mono">
            {meta.language && <LanguageDot lang={meta.language} />}
            <span className="flex items-center gap-1.5 text-white/40">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-white/30">
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
              </svg>
              {meta.branch}
            </span>
            {meta.topics.slice(0, 3).map((t) => (
              <span key={t}
                className="px-2 py-0.5 rounded-full text-[10px] tracking-wide"
                style={{ background: "rgba(56,139,253,0.1)", color: "rgba(56,139,253,0.9)", border: "1px solid rgba(56,139,253,0.2)" }}>
                {t}
              </span>
            ))}
          </div>

          {/* Deploy button row */}
          <div className="flex items-center justify-between px-4 py-3 border-t"
            style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)" }}>
            <span className="text-[11px] font-mono text-white/25">
              Ready to deploy · {meta.owner}/{meta.repo}
            </span>
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={onDeploy}
              disabled={isDeploying}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[11px] font-mono font-bold
                         tracking-wider transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "rgba(0,255,135,0.12)",
                border: "1px solid rgba(0,255,135,0.35)",
                color: "#00ff87",
                boxShadow: "0 0 20px rgba(0,255,135,0.08)",
              }}
            >
              {isDeploying ? (
                <>
                  <span className="w-3 h-3 border border-emerald-400/60 border-t-transparent rounded-full animate-spin" />
                  DEPLOYING...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current">
                    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
                  </svg>
                  DEPLOY FROM GITHUB
                </>
              )}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
