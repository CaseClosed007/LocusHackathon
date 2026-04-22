"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const PRESETS = [1, 5, 10, 25];

interface Props {
  onClose: () => void;
}

export function CreditsModal({ onClose }: Props) {
  const [amount, setAmount]     = useState<number>(5);
  const [custom, setCustom]     = useState("");
  const [step, setStep]         = useState<"input" | "confirm" | "success">("input");
  const [loading, setLoading]   = useState(false);

  const finalAmount = custom ? parseFloat(custom) || 0 : amount;

  async function handleTopUp() {
    setLoading(true);
    // Simulate API call — replace with real POST /v1/billing/pay
    await new Promise((r) => setTimeout(r, 1400));
    setLoading(false);
    setStep("success");
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />

      {/* Panel */}
      <motion.div
        className="relative w-full max-w-sm rounded-2xl border overflow-hidden"
        style={{
          background: "rgba(6,6,18,0.95)",
          borderColor: "rgba(0,255,135,0.2)",
          backdropFilter: "blur(24px)",
        }}
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <span className="text-base">💳</span>
            <span className="text-sm font-bold text-white font-mono tracking-wide">ADD CREDITS</span>
          </div>
          <button onClick={onClose}
            className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="p-5">
          <AnimatePresence mode="wait">

            {/* ── Step: input ── */}
            {step === "input" && (
              <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="space-y-4">
                <p className="text-[11px] text-white/40 font-mono">
                  Credits are deducted from your Locus wallet. Each service costs $0.25/mo.
                </p>

                {/* Preset chips */}
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button key={p}
                      onClick={() => { setAmount(p); setCustom(""); }}
                      className="py-2 rounded-lg text-xs font-mono font-bold transition-all duration-150 border"
                      style={{
                        borderColor: amount === p && !custom ? "rgba(0,255,135,0.5)" : "rgba(255,255,255,0.08)",
                        background:  amount === p && !custom ? "rgba(0,255,135,0.1)" : "rgba(255,255,255,0.03)",
                        color:       amount === p && !custom ? "#00ff87" : "rgba(255,255,255,0.5)",
                      }}
                    >
                      ${p}
                    </button>
                  ))}
                </div>

                {/* Custom amount */}
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 font-mono text-sm">$</span>
                  <input
                    type="number" min="1" max="1000" placeholder="Custom amount"
                    value={custom}
                    onChange={(e) => { setCustom(e.target.value); }}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg text-sm font-mono bg-white/[0.04]
                               border border-white/10 focus:border-emerald-500/40 outline-none
                               text-white placeholder-white/20 transition-colors"
                  />
                </div>

                {/* Summary */}
                <div className="rounded-lg p-3 border"
                  style={{ background: "rgba(0,255,135,0.04)", borderColor: "rgba(0,255,135,0.12)" }}>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-white/40">Amount</span>
                    <span className="text-white font-bold">${finalAmount.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono mt-1">
                    <span className="text-white/40">Services covered</span>
                    <span className="text-emerald-400">{Math.floor(finalAmount / 0.25)} services</span>
                  </div>
                </div>

                <button
                  onClick={() => setStep("confirm")}
                  disabled={finalAmount <= 0}
                  className="w-full py-2.5 rounded-xl text-sm font-mono font-bold tracking-wider
                             transition-all duration-200 disabled:opacity-30"
                  style={{ background: "linear-gradient(135deg, #00ff87, #22d3ee)", color: "#03030a" }}
                >
                  CONTINUE →
                </button>
              </motion.div>
            )}

            {/* ── Step: confirm ── */}
            {step === "confirm" && (
              <motion.div key="confirm" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }} className="space-y-4">
                <div className="text-center py-2">
                  <div className="text-3xl font-bold text-white font-mono">
                    ${finalAmount.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-white/30 font-mono mt-1">USDC from Locus wallet</div>
                </div>

                <div className="space-y-2 rounded-lg p-3 border text-xs font-mono"
                  style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  {[
                    ["From",    "Locus wallet"],
                    ["To",      "Build credits"],
                    ["Network", "Base (L2)"],
                    ["Fee",     "$0.00"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-white/30">{k}</span>
                      <span className="text-white/70">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setStep("input")}
                    className="flex-1 py-2.5 rounded-xl text-xs font-mono border border-white/10
                               text-white/40 hover:text-white/70 hover:border-white/20 transition-colors">
                    BACK
                  </button>
                  <button onClick={handleTopUp} disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider
                               transition-all duration-200 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #00ff87, #22d3ee)", color: "#03030a" }}
                  >
                    {loading ? (
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : "CONFIRM"}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step: success ── */}
            {step === "success" && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="text-center py-4 space-y-4">
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
                  className="w-14 h-14 rounded-full mx-auto flex items-center justify-center text-2xl"
                  style={{ background: "rgba(0,255,135,0.15)", border: "2px solid rgba(0,255,135,0.4)" }}
                >
                  ✓
                </motion.div>
                <div>
                  <div className="text-white font-mono font-bold text-sm">Credits Added!</div>
                  <div className="text-[11px] text-white/30 font-mono mt-1">
                    ${finalAmount.toFixed(2)} USDC added to your build balance
                  </div>
                </div>
                <button onClick={onClose}
                  className="w-full py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider border border-emerald-500/30
                             text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                  DONE
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
