"use client";

import { AVAILABLE_MODELS } from "@/lib/models";
import { useModel } from "./ModelContext";

export function ModelPicker() {
  const { modelId, setModelId } = useModel();

  return (
    <select
      value={modelId}
      onChange={(e) => setModelId(e.target.value)}
      className="h-7 rounded-md border border-[#dcdddf] bg-white px-2 text-[12px] text-[#333] outline-none hover:border-[#b0b0b0] focus:border-[#999] focus:ring-1 focus:ring-[#999]/30 transition-colors cursor-pointer"
      aria-label="AI model"
    >
      {AVAILABLE_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
