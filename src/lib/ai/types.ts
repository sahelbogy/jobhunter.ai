import type { AiProviderId } from "@/types/domain";

export type AiErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UNSUPPORTED_MODEL"
  | "TIMEOUT"
  | "PAID_PROVIDER_BLOCKED"
  | "INVALID_JSON_OUTPUT"
  | "UPSTREAM_ERROR";

export class AiProviderError extends Error {
  public readonly provider: AiProviderId;
  public readonly code: AiErrorCode;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(params: {
    provider: AiProviderId;
    code: AiErrorCode;
    message: string;
    statusCode?: number;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = "AiProviderError";
    this.provider = params.provider;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.retryable = params.retryable ?? false;
  }
}

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  freeTierAvailable: boolean;
  recommended?: boolean;
}

export interface AiProviderMetadata {
  id: AiProviderId;
  name: string;
  tierLabel: string;
  isPaidOnly: boolean;
  envKeyName: string;
  envModelName: string;
  docsUrl: string;
  defaultModel: string;
  models: AiModelOption[];
}

export const AI_PROVIDER_CATALOG: Record<AiProviderId, AiProviderMetadata> = {
  groq: {
    id: "groq",
    name: "Groq Cloud",
    tierLabel: "Primary • Free Developer Tier Available",
    isPaidOnly: false,
    envKeyName: "GROQ_API_KEY",
    envModelName: "GROQ_MODEL",
    docsUrl: "https://console.groq.com/keys",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B Versatile (Auto-resolves if retired)",
        description:
          "Preferred versatile model; automatically resolves to GPT-OSS 120B on Groq free accounts where Llama 3.3 was retired.",
        freeTierAvailable: true,
        recommended: true,
      },
      {
        id: "openai/gpt-oss-120b",
        label: "GPT-OSS 120B (Groq Production)",
        description: "High-accuracy 120B open-weights production model on Groq Cloud.",
        freeTierAvailable: true,
      },
      {
        id: "openai/gpt-oss-20b",
        label: "GPT-OSS 20B (Ultra-Fast)",
        description: "Low-latency production model ideal for high-volume matching.",
        freeTierAvailable: true,
      },
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        label: "Llama 4 Scout 17B Instruct",
        description: "Fast multilingual instruction model (FR/EN).",
        freeTierAvailable: true,
      },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    tierLabel: "Secondary • Free Tier Available (AI Studio)",
    isPaidOnly: false,
    envKeyName: "GEMINI_API_KEY",
    envModelName: "GEMINI_MODEL",
    docsUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      {
        id: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite (Current Free Tier)",
        description: "Current free-tier default model on Google AI Studio (Oct 2026).",
        freeTierAvailable: true,
        recommended: true,
      },
      {
        id: "gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash-Lite",
        description: "Stable lightweight free-tier Gemini model.",
        freeTierAvailable: true,
      },
      {
        id: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        description: "High-reasoning flagship Flash model.",
        freeTierAvailable: false,
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash (Legacy Projects)",
        description: "Supported on projects with legacy 2.5 model entitlement.",
        freeTierAvailable: true,
      },
    ],
  },
  xai: {
    id: "xai",
    name: "xAI Grok",
    tierLabel: "Optional • Paid API Credits Required",
    isPaidOnly: true,
    envKeyName: "XAI_API_KEY",
    envModelName: "XAI_MODEL",
    docsUrl: "https://console.x.ai/",
    defaultModel: "grok-4.7",
    models: [
      {
        id: "grok-4.7",
        label: "Grok 4.7",
        description: "Latest flagship xAI model (requires paid API credits).",
        freeTierAvailable: false,
        recommended: true,
      },
      {
        id: "grok-4.6",
        label: "Grok 4.6",
        description: "High-capability general reasoning model.",
        freeTierAvailable: false,
      },
      {
        id: "grok-4.3",
        label: "Grok 4.3",
        description: "Balanced cost/performance xAI model.",
        freeTierAvailable: false,
      },
    ],
  },
};

export interface AiCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  modelOverride?: string;
  timeoutMs?: number;
}

export interface AiCompletionResponse {
  provider: AiProviderId;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}
