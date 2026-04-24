"use client";

import { useState, useCallback, useRef } from "react";
import { AgentThought, BrandContext } from "./types";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "https://locushackathon.onrender.com").replace(/\/$/, "");

export interface DeployOptions {
  naturalLanguageRequest: string;
  githubUrl?: string;
  brandContext?: BrandContext;
}

export function useDeployStream() {
  const [thoughts, setThoughts]       = useState<AgentThought[]>([]);
  const [isStreaming, setIsStreaming]  = useState(false);
  const [isDone, setIsDone]           = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const deploy = useCallback(async (options: DeployOptions | string) => {
    // Accept bare string (NL only) for backwards-compat
    const opts: DeployOptions =
      typeof options === "string"
        ? { naturalLanguageRequest: options }
        : options;

    setThoughts([]);
    setIsDone(false);
    setIsStreaming(true);

    abortRef.current = new AbortController();

    const body: Record<string, unknown> = {
      natural_language_request: opts.naturalLanguageRequest,
      max_heal_attempts: 3,
    };
    if (opts.githubUrl) {
      body.github_url = opts.githubUrl;
    }
    if (opts.brandContext) {
      body.brand_context = opts.brandContext;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      const reader  = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "message";
          let dataLine  = "";

          for (const line of lines) {
            if (line.startsWith("event:")) eventType = line.replace("event:", "").trim();
            else if (line.startsWith("data:")) dataLine  = line.replace("data:", "").trim();
          }

          if (!dataLine) continue;

          try {
            const parsed: AgentThought = JSON.parse(dataLine);
            if (eventType === "done" || parsed.type === "done") {
              setIsDone(true);
            } else {
              setThoughts((prev) => [...prev, parsed]);
            }
          } catch {
            // malformed chunk
          }
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
      setIsDone(true);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { thoughts, isStreaming, isDone, deploy, cancel };
}
