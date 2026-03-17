export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "OpenAI" },
  { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast", provider: "xAI" },
  { id: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", provider: "Google" },
];

export const DEFAULT_MODEL_ID = AVAILABLE_MODELS[0]!.id;
