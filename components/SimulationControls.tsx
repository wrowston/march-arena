"use client";

import { useState } from "react";
import type { Bracket, SimulatedBracket } from "@/lib/bracket-data";

export function useSimulation(
  onSimulationComplete: (result: SimulatedBracket) => void,
  onBracketUpdate?: (bracket: Bracket | SimulatedBracket) => void
) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSimulation(modelId?: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, modelId }),
      });

      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("ndjson") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const update = JSON.parse(line) as Bracket | SimulatedBracket;
                onBracketUpdate?.(update);
                if ("winner" in update && update.winner) {
                  onSimulationComplete(update as SimulatedBracket);
                }
              } catch {}
            }
          }
          if (buffer.trim()) {
            try {
              const update = JSON.parse(buffer) as Bracket | SimulatedBracket;
              onBracketUpdate?.(update);
              if ("winner" in update && update.winner) {
                onSimulationComplete(update as SimulatedBracket);
              }
            } catch {}
          }
        } finally {
          setRunning(false);
        }
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Simulation failed");
      }
      if (data.result) {
        onSimulationComplete(data.result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  return { runSimulation, running, error };
}
