import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
} from "@/lib/ai/types";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_PRIMARY_FREE_MODEL = "openai/gpt-oss-120b";
const GROQ_FAST_FREE_MODEL = "openai/gpt-oss-20b";

const RETIRED_OR_ENTERPRISE_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
]);

export function normalizeGroqModel(rawModel?: string | null): string {
  const cleaned = rawModel?.trim();
  if (!cleaned || RETIRED_OR_ENTERPRISE_MODELS.has(cleaned)) {
    return GROQ_PRIMARY_FREE_MODEL;
  }
  return cleaned;
}

function isGptOssModel(model: string): boolean {
  return model.startsWith("openai/gpt-oss");
}

function isQwenReasoningModel(model: string): boolean {
  return model.startsWith("qwen/");
}

function computeGroqCompletionBudget(
  model: string,
  requestedMaxTokens: number | undefined,
  forceExpandedBudget: boolean
): number {
  const base = requestedMaxTokens ?? 2500;
  // Reasoning models (openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.8-27b)
  // draw hidden reasoning tokens from max_completion_tokens before emitting JSON.
  // Small caps (e.g., 60–512) cause empty/truncated completions and HTTP 400 json_validate_failed.
  if (isGptOssModel(model) || isQwenReasoningModel(model)) {
    const floor = forceExpandedBudget ? 4096 : 2048;
    const scaled = base < 1000 ? floor : Math.max(floor, base * 2);
    const modelCap = isQwenReasoningModel(model) ? 16384 : 32768;
    return Math.min(modelCap, scaled);
  }
  return Math.max(256, base);
}

function tryRecoverJsonFromFailedGeneration(rawFailedGen: unknown): string | null {
  if (typeof rawFailedGen !== "string" || !rawFailedGen.trim()) {
    return null;
  }
  const trimmed = rawFailedGen.trim();
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object") {
      return JSON.stringify(obj);
    }
  } catch {
    // Try extracting fenced or embedded JSON object
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      const obj = JSON.parse(fenceMatch[1].trim());
      if (obj && typeof obj === "object") {
        return JSON.stringify(obj);
      }
    } catch {
      // Continue below
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const obj = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      if (obj && typeof obj === "object") {
        return JSON.stringify(obj);
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function callGroqProvider(
  req: AiCompletionRequest
): Promise<AiCompletionResponse> {
  const apiKey =
    req.apiKeyOverride?.trim() || process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new AiProviderError({
      provider: "groq",
      code: "MISSING_CREDENTIALS",
      message:
        "GROQ_API_KEY is not configured. Paste a free Groq API key in Account Settings -> AI Providers (console.groq.com/keys) or set GROQ_API_KEY in Vercel environment variables.",
      retryable: false,
    });
  }

  const configuredModel = normalizeGroqModel(
    req.modelOverride || process.env.GROQ_MODEL
  );

  return executeGroqCall(apiKey, configuredModel, req, {
    allowModelFallback: true,
    useJsonObjectMode: Boolean(req.jsonMode),
    forceExpandedBudget: false,
  });
}

async function executeGroqCall(
  apiKey: string,
  model: string,
  req: AiCompletionRequest,
  opts: {
    allowModelFallback: boolean;
    useJsonObjectMode: boolean;
    forceExpandedBudget: boolean;
  }
): Promise<AiCompletionResponse> {
  const startedAt = Date.now();
  const timeoutMs = req.timeoutMs ?? 28000;

  let systemPrompt = req.systemPrompt;
  if (req.jsonMode) {
    if (!/\bjson\b/i.test(systemPrompt) && !/\bjson\b/i.test(req.userPrompt)) {
      systemPrompt = `${systemPrompt}\nRespond strictly with a valid JSON object.`;
    }
    if (!opts.useJsonObjectMode) {
      systemPrompt = `${systemPrompt}\nCRITICAL: Output ONLY a raw, valid JSON object starting with { and ending with }. Do NOT include markdown code fences, explanations, or any text outside the JSON object.`;
    }
  }

  const maxCompletionTokens = computeGroqCompletionBudget(
    model,
    req.maxTokens,
    opts.forceExpandedBudget
  );

  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: req.userPrompt },
    ],
    temperature: req.temperature ?? 0.2,
    max_completion_tokens: maxCompletionTokens,
  };

  // Official Groq Reasoning controls (https://console.groq.com/docs/reasoning):
  // - GPT-OSS (openai/gpt-oss-120b, openai/gpt-oss-20b) supports `include_reasoning` and `reasoning_effort` ("low"|"medium"|"high"), NOT `reasoning_format`.
  // - Qwen (qwen/qwen3.8-27b) supports `reasoning_format: "hidden"` and `reasoning_effort: "none"`.
  if (isGptOssModel(model)) {
    payload.include_reasoning = false;
    payload.reasoning_effort = "low";
  } else if (isQwenReasoningModel(model)) {
    payload.reasoning_format = "hidden";
    payload.reasoning_effort = "none";
  }

  if (req.jsonMode && opts.useJsonObjectMode) {
    payload.response_format = { type: "json_object" };
  }

  let response: Response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AiProviderError({
      provider: "groq",
      code: isTimeout ? "TIMEOUT" : "UPSTREAM_ERROR",
      message: isTimeout
        ? `Groq API request timed out after ${timeoutMs}ms.`
        : `Groq network error: ${err instanceof Error ? err.message : "Unknown error"}`,
      retryable: true,
    });
  }

  const latencyMs = Date.now() - startedAt;
  const rawBody = await response.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const upstreamMsg: string =
      parsed?.error?.message || `Groq HTTP ${response.status}`;
    const upstreamCode: string = parsed?.error?.code || "";

    // 1. Recover seamlessly from Groq HTTP 400 `json_validate_failed`
    if (
      req.jsonMode &&
      response.status === 400 &&
      (upstreamCode === "json_validate_failed" ||
        /Failed to validate JSON|json_validate_failed/i.test(upstreamMsg))
    ) {
      const recovered = tryRecoverJsonFromFailedGeneration(
        parsed?.error?.failed_generation
      );
      if (recovered) {
        return {
          provider: "groq",
          model,
          content: recovered,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs,
        };
      }

      if (opts.useJsonObjectMode) {
        // Retry once without `response_format: { type: "json_object" }` and with expanded token budget
        return executeGroqCall(apiKey, model, req, {
          allowModelFallback: opts.allowModelFallback,
          useJsonObjectMode: false,
          forceExpandedBudget: true,
        });
      }
    }

    // 2. Handle decommissioned / unsupported / Enterprise-restricted model IDs
    if (
      opts.allowModelFallback &&
      model !== GROQ_PRIMARY_FREE_MODEL &&
      (upstreamCode === "model_decommissioned" ||
        upstreamCode === "model_not_found" ||
        /decommission|deprecated|does not exist|not supported|enterprise/i.test(
          upstreamMsg
        ))
    ) {
      return executeGroqCall(apiKey, GROQ_PRIMARY_FREE_MODEL, req, {
        allowModelFallback: false,
        useJsonObjectMode: opts.useJsonObjectMode,
        forceExpandedBudget: opts.forceExpandedBudget,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new AiProviderError({
        provider: "groq",
        code: "INVALID_CREDENTIALS",
        message: "Groq API key is invalid or unauthorized.",
        statusCode: response.status,
        retryable: false,
      });
    }

    if (response.status === 429) {
      const isQuota = /quota|credit|billing|spend/i.test(upstreamMsg);
      throw new AiProviderError({
        provider: "groq",
        code: isQuota ? "QUOTA_EXCEEDED" : "RATE_LIMITED",
        message: `Groq rate/quota limit reached: ${upstreamMsg}`,
        statusCode: 429,
        retryable: true,
      });
    }

    if (
      response.status === 400 ||
      response.status === 404 ||
      /model/i.test(upstreamCode)
    ) {
      throw new AiProviderError({
        provider: "groq",
        code: "UNSUPPORTED_MODEL",
        message: `Groq model '${model}' error: ${upstreamMsg}`,
        statusCode: response.status,
        retryable: true,
      });
    }

    throw new AiProviderError({
      provider: "groq",
      code: "UPSTREAM_ERROR",
      message: `Groq API error (${response.status}): ${upstreamMsg}`,
      statusCode: response.status,
      retryable: response.status >= 500,
    });
  }

  const content = parsed?.choices?.[0]?.message?.content ?? "";
  return {
    provider: "groq",
    model: parsed?.model || model,
    content: typeof content === "string" ? content : JSON.stringify(content),
    promptTokens: Number(parsed?.usage?.prompt_tokens ?? 0),
    completionTokens: Number(parsed?.usage?.completion_tokens ?? 0),
    latencyMs,
  };
}
