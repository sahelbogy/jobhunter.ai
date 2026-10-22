import type { z } from "zod";
import type { AiProviderId } from "@/types/domain";
import {
  AI_PROVIDER_CATALOG,
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
} from "@/lib/ai/types";
import { callGroqProvider } from "@/lib/ai/providers/groq";
import { callGeminiProvider } from "@/lib/ai/providers/gemini";
import { callXaiProvider } from "@/lib/ai/providers/xai";
import {
  getDecryptedUserAiKeys,
  type UserAiKeySummary,
} from "@/lib/ai/user-secrets";
import { getServerEnvStatus } from "@/lib/env";

export type AiTaskType =
  | "cv_analysis"
  | "job_matching"
  | "email_generation"
  | "cover_letter_generation"
  | "connection_test";

export interface AiRoutingPreferences {
  primaryProvider: AiProviderId;
  primaryModel?: string | null;
  fallbackProvider?: AiProviderId | null;
  fallbackModel?: string | null;
  allowPaidFallback?: boolean;
  userId?: string | null;
  apiKeys?: Partial<Record<AiProviderId, string>>;
}

export interface AiExecutionResult<T = string> {
  data: T;
  rawText: string;
  provider: AiProviderId;
  model: string;
  fallbackUsed: boolean;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export type AiLogCallback = (entry: {
  task_type: AiTaskType;
  provider: string;
  model: string;
  fallback_used: boolean;
  status: "success" | "failed" | "rate_limited" | "fallback_triggered";
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  error_message?: string;
}) => Promise<void>;

async function dispatchToProvider(
  provider: AiProviderId,
  req: AiCompletionRequest
): Promise<AiCompletionResponse> {
  switch (provider) {
    case "groq":
      return callGroqProvider(req);
    case "gemini":
      return callGeminiProvider(req);
    case "xai":
      return callXaiProvider(req);
    default:
      throw new AiProviderError({
        provider: "groq",
        code: "UNSUPPORTED_MODEL",
        message: `Unknown AI provider '${String(provider)}'.`,
      });
  }
}

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip markdown code fences if present
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1].trim());
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("AI response did not contain a valid JSON object.");
  }
}

export async function executeAiTask<T = string>(params: {
  taskType: AiTaskType;
  routing: AiRoutingPreferences;
  request: Omit<AiCompletionRequest, "modelOverride">;
  schema?: { parse: (input: unknown) => T };
  onLog?: AiLogCallback;
}): Promise<AiExecutionResult<T>> {
  const { taskType, routing, request, schema, onLog } = params;
  const primaryProvider = routing.primaryProvider || "groq";
  const primaryModel =
    routing.primaryModel?.trim() ||
    AI_PROVIDER_CATALOG[primaryProvider].defaultModel;

  const userKeys =
    routing.apiKeys ??
    (routing.userId ? await getDecryptedUserAiKeys(routing.userId) : {});

  let primaryError: AiProviderError | null = null;

  try {
    const res = await dispatchToProvider(primaryProvider, {
      ...request,
      modelOverride: primaryModel,
      apiKeyOverride: request.apiKeyOverride || userKeys[primaryProvider],
    });
    const parsedData = schema
      ? schema.parse(extractJsonObject(res.content))
      : (res.content as unknown as T);

    if (onLog) {
      await onLog({
        task_type: taskType,
        provider: res.provider,
        model: res.model,
        fallback_used: false,
        status: "success",
        prompt_tokens: res.promptTokens,
        completion_tokens: res.completionTokens,
        latency_ms: res.latencyMs,
      }).catch(() => {});
    }

    return {
      data: parsedData,
      rawText: res.content,
      provider: res.provider,
      model: res.model,
      fallbackUsed: false,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      latencyMs: res.latencyMs,
    };
  } catch (err) {
    primaryError =
      err instanceof AiProviderError
        ? err
        : new AiProviderError({
            provider: primaryProvider,
            code: "INVALID_JSON_OUTPUT",
            message:
              err instanceof Error ? err.message : "Primary AI provider failed.",
            retryable: true,
          });

    if (onLog) {
      await onLog({
        task_type: taskType,
        provider: primaryProvider,
        model: primaryModel,
        fallback_used: false,
        status:
          primaryError.code === "RATE_LIMITED"
            ? "rate_limited"
            : routing.fallbackProvider
              ? "fallback_triggered"
              : "failed",
        prompt_tokens: 0,
        completion_tokens: 0,
        latency_ms: 0,
        error_message: primaryError.message,
      }).catch(() => {});
    }
  }

  // Check explicit fallback rules:
  // 1. Only fallback if user explicitly configured a distinct fallbackProvider.
  // 2. NEVER silently switch to a paid-only provider (xAI) unless allowPaidFallback === true.
  const fallbackProvider = routing.fallbackProvider;
  if (
    !fallbackProvider ||
    (fallbackProvider as string) === "none" ||
    fallbackProvider === primaryProvider ||
    !(fallbackProvider in AI_PROVIDER_CATALOG)
  ) {
    throw primaryError;
  }

  const fallbackMeta = AI_PROVIDER_CATALOG[fallbackProvider];
  if (fallbackMeta.isPaidOnly && !routing.allowPaidFallback) {
    throw new AiProviderError({
      provider: fallbackProvider,
      code: "PAID_PROVIDER_BLOCKED",
      message: `${primaryError.message} — Automatic switch to paid provider '${fallbackMeta.name}' was blocked because 'Allow Paid Fallback' is disabled in AI Provider Settings.`,
      retryable: false,
    });
  }

  const fallbackModel =
    routing.fallbackModel?.trim() || fallbackMeta.defaultModel;

  try {
    const res = await dispatchToProvider(fallbackProvider, {
      ...request,
      modelOverride: fallbackModel,
      apiKeyOverride: request.apiKeyOverride || userKeys[fallbackProvider],
    });

    const parsedData = schema
      ? schema.parse(extractJsonObject(res.content))
      : (res.content as unknown as T);

    if (onLog) {
      await onLog({
        task_type: taskType,
        provider: res.provider,
        model: res.model,
        fallback_used: true,
        status: "success",
        prompt_tokens: res.promptTokens,
        completion_tokens: res.completionTokens,
        latency_ms: res.latencyMs,
      }).catch(() => {});
    }

    return {
      data: parsedData,
      rawText: res.content,
      provider: res.provider,
      model: res.model,
      fallbackUsed: true,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      latencyMs: res.latencyMs,
    };
  } catch (fallbackErr) {
    const wrapped =
      fallbackErr instanceof AiProviderError
        ? fallbackErr
        : new AiProviderError({
            provider: fallbackProvider,
            code: "INVALID_JSON_OUTPUT",
            message:
              fallbackErr instanceof Error
                ? fallbackErr.message
                : "Fallback AI provider failed.",
          });

    if (onLog) {
      await onLog({
        task_type: taskType,
        provider: fallbackProvider,
        model: fallbackModel,
        fallback_used: true,
        status: wrapped.code === "RATE_LIMITED" ? "rate_limited" : "failed",
        prompt_tokens: 0,
        completion_tokens: 0,
        latency_ms: 0,
        error_message: wrapped.message,
      }).catch(() => {});
    }

    throw new AiProviderError({
      provider: fallbackProvider,
      code: wrapped.code,
      message: `Primary (${primaryProvider}) failed: ${primaryError.message} | Fallback (${fallbackProvider}) failed: ${wrapped.message}`,
      statusCode: wrapped.statusCode,
    });
  }
}

export function getAiProvidersStatus(
  userSecrets?: Partial<Record<AiProviderId, UserAiKeySummary>>
) {
  const env = getServerEnvStatus();
  const buildEntry = (
    id: AiProviderId,
    envConfigured: boolean,
    activeEnvModel: string
  ) => {
    const secret = userSecrets?.[id];
    const hasUserKey = Boolean(secret?.hasUserKey);
    return {
      ...AI_PROVIDER_CATALOG[id],
      configured: envConfigured || hasUserKey,
      envConfigured,
      hasUserKey,
      keyHint: secret?.keyHint ?? null,
      keySource: hasUserKey
        ? ("user_encrypted" as const)
        : envConfigured
          ? ("server_env" as const)
          : ("missing" as const),
      activeEnvModel,
    };
  };

  return [
    buildEntry("groq", env.groqConfigured, env.groqModel),
    buildEntry("gemini", env.geminiConfigured, env.geminiModel),
    buildEntry("xai", env.xaiConfigured, env.xaiModel),
  ];
}

export async function testAiProviderConnection(params: {
  provider: AiProviderId;
  model?: string;
  userId?: string;
  apiKeyOverride?: string;
  onLog?: AiLogCallback;
}) {
  const userKeys =
    !params.apiKeyOverride && params.userId
      ? await getDecryptedUserAiKeys(params.userId)
      : {};

  const res = await dispatchToProvider(params.provider, {
    systemPrompt:
      "You are a connectivity diagnostic service. Reply strictly with valid JSON: {\"ok\": true, \"message\": \"Connected\"}.",
    userPrompt: "Verify API connectivity now.",
    temperature: 0,
    maxTokens: 60,
    jsonMode: true,
    modelOverride: params.model,
    apiKeyOverride: params.apiKeyOverride || userKeys[params.provider],
    timeoutMs: 15000,
  });

  if (params.onLog) {
    await params
      .onLog({
        task_type: "connection_test",
        provider: res.provider,
        model: res.model,
        fallback_used: false,
        status: "success",
        prompt_tokens: res.promptTokens,
        completion_tokens: res.completionTokens,
        latency_ms: res.latencyMs,
      })
      .catch(() => {});
  }

  return {
    ok: true,
    provider: res.provider,
    model: res.model,
    latencyMs: res.latencyMs,
    responsePreview: res.content.slice(0, 120),
  };
}
