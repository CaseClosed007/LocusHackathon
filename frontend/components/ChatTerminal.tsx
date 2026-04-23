"use client";

import React, {
  useState,
  useRef,
  useEffect,
  KeyboardEvent,
  useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDeployStream } from "@/lib/useDeployStream";
import { ThoughtLine } from "./ThoughtLine";
import { AnimatedBackground } from "./AnimatedBackground";
import { GitHubPreview } from "./GitHubPreview";
import { CreditsModal } from "./CreditsModal";
import { BrandUploader } from "./BrandUploader";
import { IteratePanel } from "./IteratePanel";
import { AgentThought, BrandContext } from "@/lib/types";

// Detect if a string looks like a GitHub repo URL
function extractGitHubUrl(text: string): string | null {
  const t = text.trim();
  if (/^(https?:\/\/)?github\.com\/[^/\s]+\/[^/\s]+/i.test(t)) {
    // Normalise — ensure https://
    return t.startsWith("http") ? t : `https://${t}`;
  }
  return null;
}

// ── Example prompts ─────────────────────────────────────────────────
const EXAMPLES = [
  { icon: "🐍", text: "Deploy a Python Flask API that returns Hello World on GET /" },
  { icon: "⚡", text: "Deploy a Node.js Express server with a /health endpoint" },
  { icon: "🌐", text: "Deploy a static HTML landing page for a SaaS called NovaDash" },
  { icon: "📋", text: "Deploy a FastAPI todo list app with full CRUD endpoints" },
];

// ── Types ────────────────────────────────────────────────────────────
interface Turn {
  id: string;
  userMessage: string;
  thoughts: AgentThought[];
  isStreaming: boolean;
  startTime: number;
}

// ── Sub-components ───────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-8 h-8">
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-emerald-400/20 to-cyan-400/20 border border-emerald-500/30" />
        <div className="absolute inset-0 flex items-center justify-center text-sm">⬡</div>
        <div className="absolute inset-0 rounded-lg animate-ping bg-emerald-400/5" style={{ animationDuration: "3s" }} />
      </div>
      <div>
        <div className="text-sm font-bold tracking-wider text-white font-mono">
          LOCUS <span className="shimmer-text">AUTO-HEAL</span>
        </div>
        <div className="text-[10px] text-white/30 font-mono tracking-widest">
          AUTONOMOUS DEPLOYMENT AGENT
        </div>
      </div>
    </div>
  );
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

function LocusBalance() {
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/balance`)
      .then((r) => r.json())
      .then((d) => {
        const amt = d.balance ?? d.amount;
        const cur = d.currency ?? "USDC";
        if (amt && amt !== "N/A") setBalance(`${amt} ${cur}`);
      })
      .catch(() => {});
  }, []);

  if (!balance) return null;
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
      style={{ borderColor: "rgba(0,255,135,0.2)", background: "rgba(0,255,135,0.05)" }}>
      <span className="text-[9px] font-mono text-emerald-400/60 tracking-widest">WALLET</span>
      <span className="text-[11px] font-mono text-emerald-300">{balance}</span>
    </div>
  );
}

function WorkspaceChip() {
  const [wsId, setWsId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/workspace`)
      .then((r) => r.json())
      .then((d) => { if (d.workspace_id) setWsId(d.workspace_id); })
      .catch(() => {});
  }, []);

  if (!wsId) return null;
  const short = wsId.length > 12 ? `${wsId.slice(0, 8)}…` : wsId;
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
      style={{ borderColor: "rgba(168,85,247,0.2)", background: "rgba(168,85,247,0.05)" }}>
      <span className="text-[9px] font-mono text-purple-400/60 tracking-widest">WS</span>
      <span className="text-[11px] font-mono text-purple-300">{short}</span>
    </div>
  );
}

function LiveIndicator({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-2 h-2">
        <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${
          active ? "bg-emerald-400" : "bg-white/20"
        }`} />
        {active && (
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-60" />
        )}
      </div>
      <span className={`text-[11px] font-mono tracking-widest transition-colors duration-500 ${
        active ? "text-emerald-400" : "text-white/30"
      }`}>
        {active ? "AGENT ACTIVE" : "STANDBY"}
      </span>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="flex items-start gap-3"
    >
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <span className="text-emerald-400 font-mono text-sm text-glow-green">❯</span>
      </div>
      <p className="text-white font-mono text-sm leading-relaxed">{text}</p>
    </motion.div>
  );
}

function AgentPanel({ turn, brandContext }: { turn: Turn; brandContext?: BrandContext | null }) {
  const lastThought = turn.thoughts[turn.thoughts.length - 1];
  const isSuccess = lastThought?.type === "success";
  const isError   = turn.thoughts.some((t) => t.type === "error") && !turn.isStreaming;

  // Extract deploy context from thoughts for the iterate panel
  const projectId  = isSuccess ? String(lastThought.metadata?.project_id  ?? "") : "";
  const serviceUrl = isSuccess ? String(lastThought.metadata?.url          ?? "") : "";
  const sourceCode = isSuccess ? lastThought.metadata?.files as Record<string, string> | undefined : undefined;
  const runtime    = (turn.thoughts.find((t) => (t.metadata?.config as Record<string,unknown>)?.runtime)
    ?.metadata?.config as Record<string, unknown>)?.runtime as string ?? "";

  // State to track updated source after iterate edits
  const [currentSource, setCurrentSource] = React.useState<Record<string, string> | undefined>(sourceCode);
  React.useEffect(() => { if (sourceCode) setCurrentSource(sourceCode); }, [isSuccess]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1], delay: 0.1 }}
      className="ml-6"
    >
      {/* Panel shell */}
      <div
        className={`rounded-xl overflow-hidden transition-all duration-700 ${
          isSuccess
            ? "border border-emerald-500/30 glow-green"
            : isError
            ? "border border-red-500/20"
            : "border border-white/[0.06]"
        }`}
        style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(20px)" }}
      >
        {/* Panel header */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 border-b"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
        >
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${isError ? "bg-red-400/80" : "bg-white/10"}`} />
            <div className={`w-2.5 h-2.5 rounded-full ${turn.isStreaming ? "bg-amber-400/80" : "bg-white/10"}`} />
            <div className={`w-2.5 h-2.5 rounded-full ${isSuccess ? "bg-emerald-400/80" : "bg-white/10"}`} />
          </div>

          <span className="text-[11px] text-white/30 font-mono tracking-wider">
            agent / stdout
          </span>

          <div className="ml-auto flex items-center gap-3">
            {turn.isStreaming ? (
              <span className="flex items-center gap-1.5 text-[10px] text-amber-400/80 font-mono">
                <span className="inline-block w-3 h-3 border border-amber-400/60 border-t-transparent rounded-full animate-spin" />
                RUNNING
              </span>
            ) : (
              <span className="text-[10px] text-white/20 font-mono">
                {turn.thoughts.length} events
              </span>
            )}
          </div>
        </div>

        {/* Thought lines */}
        <div className="py-2">
          {turn.thoughts.map((t, i) => (
            <ThoughtLine
              key={i}
              thought={t}
              index={i}
              isLatest={i === turn.thoughts.length - 1 && turn.isStreaming}
              startTs={turn.startTime}
            />
          ))}

          {/* Streaming placeholder */}
          {turn.isStreaming && turn.thoughts.length === 0 && (
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="text-[10px] text-white/15 w-5 text-right">01</span>
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-emerald-400/60"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, delay: i * 0.2, repeat: Infinity }}
                  />
                ))}
              </div>
              <span className="text-sm text-white/30 font-mono">Initializing agent...</span>
            </div>
          )}
        </div>

        {/* Success footer */}
        {isSuccess && (() => {
          const deployUrl = String(lastThought.metadata?.url ?? "");
          const roi = lastThought.metadata?.roi as Record<string, number> | undefined;
          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="border-t"
              style={{ borderColor: "rgba(0,255,135,0.15)", background: "rgba(0,255,135,0.04)" }}
            >
              <div className="flex items-center justify-between px-4 py-3 gap-4 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-emerald-400/70 font-mono">DEPLOYMENT LIVE</span>
                  {roi && (
                    <span className="text-[10px] font-mono text-white/30">
                      ~{roi.time_saved_min}min saved · ${roi.total_cost?.toFixed(4)} USDC · {roi.ai_calls} AI call{roi.ai_calls !== 1 ? "s" : ""} · {roi.elapsed_s}s elapsed
                    </span>
                  )}
                </div>
                {deployUrl ? (
                  <a
                    href={deployUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono text-emerald-300 hover:text-white transition-colors
                               flex items-center gap-1.5 px-3 py-1 rounded-md border border-emerald-500/30
                               hover:border-emerald-400/60 hover:bg-emerald-500/10"
                  >
                    {deployUrl} <span>↗</span>
                  </a>
                ) : (
                  <span className="text-[11px] font-mono text-emerald-400/50">
                    see Locus dashboard
                  </span>
                )}
              </div>
            </motion.div>
          );
        })()}
      </div>

      {/* Iterative editor — shown after a successful deployment */}
      {isSuccess && !turn.isStreaming && projectId && currentSource && (
        <IteratePanel
          editContext={{
            projectId,
            sourceCode: currentSource,
            runtime,
            serviceUrl,
            brandContext: brandContext ?? undefined,
          }}
          onSourceUpdated={setCurrentSource}
        />
      )}
    </motion.div>
  );
}

function HeroSection({ onSelect }: { onSelect: (t: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20, scale: 0.98 }}
      transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4 py-16"
    >
      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        className="mb-8 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-mono tracking-widest"
        style={{ borderColor: "rgba(0,255,135,0.25)", background: "rgba(0,255,135,0.05)", color: "#00ff87" }}
      >
        <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400">
          <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
        </span>
        LOCUS PAYMENT RAILS · GEMINI AI · SELF-HEALING
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="text-5xl sm:text-6xl font-bold leading-tight mb-4"
        style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
      >
        <span className="text-white">Deploy anything.</span>
        <br />
        <span className="shimmer-text">Fix itself.</span>
      </motion.h1>

      {/* Subheadline */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.6 }}
        className="text-white/40 text-base sm:text-lg max-w-lg mb-8 font-mono leading-relaxed"
      >
        Describe your app in plain English. AI writes the code,
        deploys it, and autonomously patches every failure — until it&apos;s live.
      </motion.p>

      {/* 3-step explainer */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.42, duration: 0.5 }}
        className="flex items-center gap-2 mb-10 text-[11px] font-mono"
      >
        {[
          { n: "01", label: "Describe your app" },
          { n: "02", label: "AI generates & deploys" },
          { n: "03", label: "Agent heals failures" },
        ].map((step, i) => (
          <div key={step.n} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <span className="text-white/20">{step.n}</span>
              <span className="text-white/50">{step.label}</span>
            </div>
            {i < 2 && <span className="text-white/15">→</span>}
          </div>
        ))}
      </motion.div>

      {/* CI/CD pitch */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.48, duration: 0.5 }}
        className="mb-10 px-4 py-2.5 rounded-xl border text-[11px] font-mono text-white/30"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
      >
        Or trigger via API:&nbsp;
        <code className="text-emerald-400/70">
          curl -X POST https://your-locus-agent.run/deploy -d &apos;&#123;&quot;natural_language_request&quot;:&quot;…&quot;&#125;&apos;
        </code>
      </motion.div>

      {/* Example cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5 }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl"
      >
        {EXAMPLES.map((ex, i) => (
          <motion.button
            key={ex.text}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.07, duration: 0.4 }}
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(ex.text)}
            className="group relative text-left p-4 rounded-xl border text-sm font-mono
                       transition-all duration-200 overflow-hidden"
            style={{
              borderColor: "rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            {/* Hover shimmer */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{ background: "linear-gradient(135deg, rgba(0,255,135,0.04) 0%, rgba(168,85,247,0.04) 100%)" }}
            />
            <div className="absolute inset-0 border border-transparent group-hover:border-white/10 rounded-xl transition-colors duration-300" />

            <span className="text-base mr-2">{ex.icon}</span>
            <span className="text-white/50 group-hover:text-white/80 transition-colors duration-200 relative z-10">
              {ex.text}
            </span>
          </motion.button>
        ))}
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="mt-16 flex flex-col items-center gap-2 text-white/20 text-[11px] font-mono"
      >
        <div className="w-px h-8 bg-gradient-to-b from-transparent to-white/20" />
        TYPE BELOW TO BEGIN
      </motion.div>
    </motion.div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function ChatTerminal() {
  const [input, setInput]           = useState("");
  const [history, setHistory]       = useState<Turn[]>([]);
  const [showCredits, setShowCredits] = useState(false);
  const [brandContext, setBrandContext] = useState<BrandContext | null>(null);
  const { thoughts, isStreaming, deploy, cancel } = useDeployStream();
  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLTextAreaElement>(null);
  const activeIdRef   = useRef<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Derived: is the current input a GitHub URL?
  const detectedGithubUrl = extractGitHubUrl(input);
  const isGithubMode      = !!detectedGithubUrl;

  // Merge streaming thoughts into the active turn
  useEffect(() => {
    if (!activeIdRef.current) return;
    const id = activeIdRef.current;
    setHistory((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, thoughts: [...thoughts], isStreaming } : t,
      ),
    );
  }, [thoughts, isStreaming]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleSubmit = useCallback(async (opts?: { githubUrl?: string }) => {
    const msg = input.trim();
    if (!msg || isStreaming) return;

    const id = crypto.randomUUID();
    activeIdRef.current = id;

    // User-facing label differs for GitHub vs NL deploys
    const label = opts?.githubUrl
      ? `Deploy from GitHub: ${opts.githubUrl}`
      : msg;

    setHistory((prev) => [
      ...prev,
      { id, userMessage: label, thoughts: [], isStreaming: true, startTime: Date.now() },
    ]);
    setInput("");
    inputRef.current?.focus();

    await deploy({
      naturalLanguageRequest: msg,
      ...(opts?.githubUrl ? { githubUrl: opts.githubUrl } : {}),
      ...(brandContext    ? { brandContext }               : {}),
    });
  }, [input, isStreaming, deploy]);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // GitHub mode: Enter doesn't submit (user should click the card button)
    if (e.key === "Enter" && !e.shiftKey && !isGithubMode) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const showHero = history.length === 0;

  return (
    <div className="relative flex flex-col h-screen overflow-hidden" style={{ background: "#03030a" }}>
      <AnimatePresence>
        {showCredits && <CreditsModal onClose={() => setShowCredits(false)} />}
      </AnimatePresence>
      <AnimatedBackground />

      {/* Progress bar */}
      {isStreaming && (
        <motion.div
          className="fixed top-0 left-0 right-0 h-px z-50"
          style={{ background: "linear-gradient(90deg, #00ff87, #22d3ee, #a855f7)" }}
          initial={{ scaleX: 0, transformOrigin: "left" }}
          animate={{ scaleX: [0, 0.7, 0.85, 0.92] }}
          transition={{ duration: 8, ease: "easeOut" }}
        />
      )}

      {/* ── Header ── */}
      <header
        className="relative z-10 flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(3,3,10,0.6)", backdropFilter: "blur(20px)" }}
      >
        <Logo />

        <div className="hidden sm:flex items-center gap-4 text-[11px] font-mono text-white/20">
          <span>v1.0.0</span>
          <span className="w-px h-4 bg-white/10" />
          <span>{history.length} run{history.length !== 1 ? "s" : ""}</span>
          <span className="w-px h-4 bg-white/10" />
          <span>gemini-flash</span>
          <span className="w-px h-4 bg-white/10" />
          <WorkspaceChip />
          <LocusBalance />
          <button
            onClick={() => setShowCredits(true)}
            className="px-2.5 py-1 rounded-md border text-[10px] font-mono tracking-widest
                       transition-all duration-200 hover:scale-105 active:scale-95"
            style={{ borderColor: "rgba(0,255,135,0.25)", background: "rgba(0,255,135,0.06)", color: "#00ff87" }}
          >
            + CREDITS
          </button>
        </div>

        <LiveIndicator active={isStreaming} />
      </header>

      {/* ── Scroll area ── */}
      <div ref={scrollAreaRef} className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 pb-8">
          {/* Hero */}
          <AnimatePresence>
            {showHero && <HeroSection onSelect={setInput} />}
          </AnimatePresence>

          {/* Conversation turns */}
          <div className="space-y-8 pt-4">
            {history.map((turn) => (
              <motion.div
                key={turn.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-3"
              >
                <UserMessage text={turn.userMessage} />
                {(turn.thoughts.length > 0 || turn.isStreaming) && (
                  <AgentPanel turn={turn} brandContext={brandContext} />
                )}
              </motion.div>
            ))}
          </div>
        </div>

        <div ref={bottomRef} className="h-4" />
      </div>

      {/* ── Input area ── */}
      <div
        className="relative z-10 border-t px-4 py-4"
        style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(3,3,10,0.8)", backdropFilter: "blur(20px)" }}
      >
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Brand uploader — always visible above input */}
          <BrandUploader
            brand={brandContext}
            onBrandLoaded={setBrandContext}
            onClear={() => setBrandContext(null)}
          />

          {/* GitHub preview card — shown when a GitHub URL is detected */}
          <AnimatePresence>
            {isGithubMode && detectedGithubUrl && (
              <motion.div
                key="github-preview"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.99 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
              >
                <GitHubPreview
                  url={detectedGithubUrl}
                  isDeploying={isStreaming}
                  onDeploy={() => handleSubmit({ githubUrl: detectedGithubUrl })}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Text input box */}
          <div
            className="input-glow flex items-end gap-3 rounded-xl border px-4 py-3 transition-all duration-300"
            style={{
              borderColor: isGithubMode
                ? "rgba(56,139,253,0.3)"
                : brandContext
                ? "rgba(168,85,247,0.35)"
                : "rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {/* Prompt symbol — GitHub octocat vs chevron */}
            <div className="flex items-center shrink-0 pb-1">
              {isGithubMode ? (
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-400 opacity-80">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
              ) : (
                <span className="text-emerald-400 font-mono text-sm text-glow-green select-none">❯</span>
              )}
            </div>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={isStreaming}
              placeholder={
                isStreaming
                  ? "Agent is working..."
                  : brandContext
                  ? `Describe what to deploy — brand: ${brandContext.company_name || "loaded"}`
                  : "Describe what to deploy — or paste a GitHub URL"
              }
              rows={1}
              className="flex-1 bg-transparent text-white placeholder-white/20 font-mono text-sm
                         resize-none outline-none leading-relaxed max-h-36 overflow-y-auto
                         disabled:opacity-40 transition-opacity duration-300"
              style={{ minHeight: "24px" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
              }}
            />

            {/* Action button */}
            <div className="shrink-0 pb-0.5">
              {isStreaming ? (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={cancel}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold tracking-wider
                             border border-red-500/40 text-red-400 bg-red-500/10
                             hover:bg-red-500/20 transition-colors duration-150"
                >
                  ■ STOP
                </motion.button>
              ) : isGithubMode ? (
                // In GitHub mode the card button is the primary CTA — show a muted hint
                <span className="text-[10px] font-mono text-white/20 px-2">↑ click card</span>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleSubmit()}
                  disabled={!input.trim()}
                  className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-bold tracking-wider
                             border border-emerald-500/40 text-emerald-400 bg-emerald-500/10
                             hover:bg-emerald-500/20 disabled:opacity-25 disabled:cursor-not-allowed
                             transition-all duration-150"
                >
                  DEPLOY ↵
                </motion.button>
              )}
            </div>
          </div>

          {/* Footer hint */}
          <div className="flex items-center justify-center gap-4 mt-2.5 text-[10px] text-white/15 font-mono">
            {isGithubMode ? (
              <>
                <span className="text-blue-400/40">github mode</span>
                <span className="w-px h-3 bg-white/10" />
                <span>click DEPLOY FROM GITHUB on the card above</span>
              </>
            ) : (
              <>
                <span>↵ deploy</span>
                <span className="w-px h-3 bg-white/10" />
                <span>⇧↵ newline</span>
                <span className="w-px h-3 bg-white/10" />
                <span>paste a github.com URL to deploy any repo</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
