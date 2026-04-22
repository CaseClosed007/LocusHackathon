"use client";

import { useState, useCallback, useRef } from "react";
import { AgentThought, BrandContext } from "./types";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export interface IterateOptions {
  editRequest: string;
  sourceCode: Record<string, string>;
  projectId: string;
  runtime: string;
  serviceUrl?: string;
  brandContext?: BrandContext;
}

export function useIterateStream() {
  const [thoughts, setThoughts]      = useState<AgentThought[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const iterate = useCallback(async (opts: IterateOptions) => {
    setThoughts([]);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${BACKEND_URL}/iterate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edit_request:    opts.editRequest,
          source_code:     opts.sourceCode,
          project_id:      opts.projectId,
          runtime:         opts.runtime,
          service_url:     opts.serviceUrl ?? "",
          brand_context:   opts.brandContext ?? null,
          max_heal_attempts: 2,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Backend error: ${res.statusText}`);

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          let dataLine = "";
          let eventType = "message";
          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) eventType = line.replace("event:", "").trim();
            else if (line.startsWith("data:")) dataLine = line.replace("data:", "").trim();
          }
          if (!dataLine) continue;
          try {
            const parsed: AgentThought = JSON.parse(dataLine);
            if (eventType === "done" || parsed.type === "done") break;
            setThoughts((prev) => [...prev, parsed]);
          } catch { /* malformed */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setThoughts((prev) => [
          ...prev,
          { type: "error", message: `Connection error: ${(err as Error).message}` },
        ]);
      }
    } finally {
      setIsStreaming(false);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { thoughts, isStreaming, iterate, cancel };
}
