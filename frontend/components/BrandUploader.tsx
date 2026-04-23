"use client";

import { useState, useRef, DragEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BrandContext } from "@/lib/types";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "https://locushackathon-production-e3eb.up.railway.app").replace(/\/$/, "");

interface Props {
  onBrandLoaded: (brand: BrandContext) => void;
  onClear: () => void;
  brand: BrandContext | null;
}

function ColorSwatch({ color }: { color: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={color}
      onClick={() => {
        navigator.clipboard.writeText(color);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="relative w-6 h-6 rounded-md border border-white/10 shrink-0 transition-transform hover:scale-110"
      style={{ background: color }}
    >
      {copied && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white bg-black/80 px-1 rounded">
          ✓
        </span>
      )}
    </button>
  );
}

export function BrandUploader({ onBrandLoaded, onClear, brand }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${BACKEND_URL}/brand/extract`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Upload failed");
      }
      const data: BrandContext = await res.json();
      onBrandLoaded(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  // ── Active brand preview ─────────────────────────────────────────────
  if (brand) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: "rgba(168,85,247,0.25)", background: "rgba(168,85,247,0.04)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b"
          style={{ borderColor: "rgba(168,85,247,0.15)", background: "rgba(168,85,247,0.07)" }}>
          <div className="flex items-center gap-2">
            <span className="text-purple-400 text-xs">◈</span>
            <span className="text-[11px] font-mono font-semibold text-purple-300">
              {brand.company_name || "Brand"} guidelines active
            </span>
            {brand.ui_style && (
              <span className="text-[9px] font-mono text-purple-400/50 px-1.5 py-0.5 rounded"
                style={{ background: "rgba(168,85,247,0.1)" }}>
                {brand.ui_style}
              </span>
            )}
          </div>
          <button onClick={onClear}
            className="text-[10px] font-mono text-white/25 hover:text-white/60 transition-colors">
            ✕ clear
          </button>
        </div>

        <div className="px-3 py-2.5 space-y-2">
          {/* Colors row */}
          {brand.colors.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-mono text-white/20 tracking-widest shrink-0 w-12">COLORS</span>
              <div className="flex gap-1.5 flex-wrap">
                {brand.colors.map((c) => (
                  <div key={c} className="flex items-center gap-1">
                    <ColorSwatch color={c} />
                    {brand.color_roles?.[c] && (
                      <span className="text-[8px] font-mono text-white/20">{brand.color_roles[c]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fonts row */}
          {brand.fonts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-white/20 tracking-widest shrink-0 w-12">FONTS</span>
              <div className="flex gap-1.5 flex-wrap">
                {brand.fonts.slice(0, 3).map((f) => (
                  <span key={f} className="text-[10px] font-mono text-cyan-300/60 px-1.5 py-0.5 rounded border"
                    style={{ borderColor: "rgba(34,211,238,0.15)" }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tone + audience + keywords */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {brand.tone && (
              <span className="text-[9px] font-mono text-purple-300/60 px-1.5 py-0.5 rounded border"
                style={{ borderColor: "rgba(168,85,247,0.2)" }}>
                {brand.tone}
              </span>
            )}
            {brand.target_audience && (
              <span className="text-[9px] font-mono text-white/30 px-1.5 py-0.5 rounded border"
                style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                → {brand.target_audience}
              </span>
            )}
            {brand.keywords.slice(0, 3).map((kw) => (
              <span key={kw} className="text-[9px] font-mono text-white/20 px-1.5 py-0.5 rounded border"
                style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                {kw}
              </span>
            ))}
          </div>

          {/* Mission / tagline */}
          {(brand.tagline || brand.mission) && (
            <p className="text-[10px] font-mono text-white/30 leading-relaxed line-clamp-2">
              {brand.tagline ? `"${brand.tagline}"` : brand.mission}
            </p>
          )}

          {/* Design rules count */}
          {brand.design_rules.length > 0 && (
            <p className="text-[9px] font-mono text-purple-400/40">
              {brand.design_rules.length} design rule{brand.design_rules.length !== 1 ? "s" : ""} extracted
            </p>
          )}
        </div>
      </motion.div>
    );
  }

  // ── Upload zone ──────────────────────────────────────────────────────
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !loading && inputRef.current?.click()}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-200"
        style={{
          borderColor: dragging ? "rgba(168,85,247,0.5)" : "rgba(168,85,247,0.2)",
          background:  dragging ? "rgba(168,85,247,0.08)" : "rgba(168,85,247,0.03)",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
        />

        {loading ? (
          <>
            <span className="w-3 h-3 rounded-full border border-purple-400/60 border-t-transparent animate-spin shrink-0" />
            <span className="text-[11px] font-mono text-purple-300/70">Extracting brand guidelines…</span>
          </>
        ) : (
          <>
            <span className="text-purple-400/60 text-sm shrink-0">◈</span>
            <span className="text-[11px] font-mono text-white/30 group-hover:text-white/50">
              {dragging ? "Drop to extract brand" : "Upload brand guidelines PDF or logo"}
            </span>
            <span className="ml-auto text-[9px] font-mono text-white/15 shrink-0">PDF · PNG · JPG</span>
          </>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[10px] font-mono text-red-400/70 mt-1 px-1"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
