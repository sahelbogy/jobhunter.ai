import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
} from "@/lib/ai/types";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_FREE_REPLACEMENT_MODEL = "openai/gpt-oss-120b";

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

  const configuredModel =
    req.modelOverride?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    "llama-3.3-70b-versatile";

  return executeGroqCall(apiKey, configuredModel, req, true);
}

async function executeGroqCall(
  apiKey: string,
  model: string,
  req: AiCompletionRequest,
  allowDeprecationRetry: boolean
): Promise<AiCompletionResponse> {
  const startedAt = Date.now();
  const timeoutMs = req.timeoutMs ?? 28000;

  let response: Response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 2500,
        ...(req.jsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
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

    // Handle Groq's August 2026 deprecation of llama-3.3-70b-versatile seamlessly
    // on standard developer keys by retrying once with Groq's recommended free replacement.
    if (
      allowDeprecationRetry &&
      model === "llama-3.3-70b-versatile" &&
      (upstreamCode === "model_decommissioned" ||
        upstreamCode === "model_not_found" ||
        /decommission|deprecated|does not exist|not supported/i.test(upstreamMsg))
    ) {
      return executeGroqCall(
        apiKey,
        GROQ_FREE_REPLACEMENT_MODEL,
        req,
        false
      );
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
