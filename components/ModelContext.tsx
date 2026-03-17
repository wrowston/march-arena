"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { DEFAULT_MODEL_ID } from "@/lib/models";

interface ModelContextValue {
  modelId: string;
  setModelId: (id: string) => void;
}

const ModelContext = createContext<ModelContextValue>({
  modelId: DEFAULT_MODEL_ID,
  setModelId: () => {},
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  return (
    <ModelContext.Provider value={{ modelId, setModelId }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  return useContext(ModelContext);
}
