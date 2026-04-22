"use client";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {/* Grid overlay */}
      <div className="absolute inset-0 grid-overlay opacity-100" />

      {/* Aurora blob 1 — green/teal */}
      <div
        className="aurora-blob-1 absolute rounded-full"
        style={{
          width: "70vw",
          height: "70vw",
          top: "-20%",
          left: "-15%",
          background:
            "radial-gradient(ellipse at center, rgba(0,255,135,0.12) 0%, rgba(0,255,135,0.04) 40%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      {/* Aurora blob 2 — purple */}
      <div
        className="aurora-blob-2 absolute rounded-full"
        style={{
          width: "60vw",
          height: "60vw",
          bottom: "-10%",
          right: "-10%",
          background:
            "radial-gradient(ellipse at center, rgba(168,85,247,0.12) 0%, rgba(168,85,247,0.04) 40%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      {/* Aurora blob 3 — blue */}
      <div
        className="aurora-blob-3 absolute rounded-full"
        style={{
          width: "50vw",
          height: "50vw",
          top: "30%",
          left: "30%",
          background:
            "radial-gradient(ellipse at center, rgba(34,211,238,0.07) 0%, rgba(59,130,246,0.04) 40%, transparent 70%)",
          filter: "blur(100px)",
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(3,3,10,0.8) 100%)",
        }}
      />

      {/* Scan line */}
      <div className="scan-line" />
    </div>
  );
}
