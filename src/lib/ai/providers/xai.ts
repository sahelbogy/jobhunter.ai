import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
} from "@/lib/ai/types";

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

export async function callXaiProvider(
  req: AiCompletionRequest
): Promise<AiCompletionResponse> {
  const apiKey =
    req.apiKeyOverride?.trim() || process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiProviderError({
      provider: "xai",
      code: "MISSING_CREDENTIALS",
      message:
        "XAI_API_KEY is not configured. Save an xAI key in Account Settings -> AI Providers or set XAI_API_KEY in Vercel environment variables.",
      retryable: false,
    });
  }

  const model =
    req.modelOverride?.trim() || process.env.XAI_MODEL?.trim() || "grok-4.7";
  const startedAt = Date.now();
  const timeoutMs = req.timeoutMs ?? 30000;

  let response: Response;
  try {
    response = await fetch(XAI_ENDPOINT, {
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
      provider: "xai",
      code: isTimeout ? "TIMEOUT" : "UPSTREAM_ERROR",
      message: isTimeout
        ? `xAI Grok request timed out after ${timeoutMs}ms.`
        : `xAI network error: ${err instanceof Error ? err.message : "Unknown error"}`,
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
      parsed?.error?.message || parsed?.error || `xAI HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new AiProviderError({
        provider: "xai",
        code: "INVALID_CREDENTIALS",
        message: "xAI API key is invalid or lacks credits.",
        statusCode: response.status,
        retryable: false,
      });
    }

    if (response.status === 429 || response.status === 402) {
      throw new AiProviderError({
        provider: "xai",
        code: response.status === 402 ? "QUOTA_EXCEEDED" : "RATE_LIMITED",
        message: `xAI Grok quota/rate error: ${upstreamMsg}`,
        statusCode: response.status,
        retryable: response.status === 429,
      });
    }

    if (response.status === 400 || response.status === 404) {
      throw new AiProviderError({
        provider: "xai",
        code: "UNSUPPORTED_MODEL",
        message: `xAI model '${model}' error: ${upstreamMsg}`,
        statusCode: response.status,
        retryable: true,
      });
    }

    throw new AiProviderError({
      provider: "xai",
      code: "UPSTREAM_ERROR",
      message: `xAI API error (${response.status}): ${upstreamMsg}`,
      statusCode: response.status,
      retryable: response.status >= 500,
    });
  }

  const content = parsed?.choices?.[0]?.message?.content ?? "";
  return {
    provider: "xai",
    model: parsed?.model || model,
    content: typeof content === "string" ? content : JSON.stringify(content),
    promptTokens: Number(parsed?.usage?.prompt_tokens ?? 0),
    completionTokens: Number(parsed?.usage?.completion_tokens ?? 0),
    latencyMs,
  };
}
