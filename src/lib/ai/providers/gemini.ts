import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
} from "@/lib/ai/types";

export async function callGeminiProvider(
  req: AiCompletionRequest
): Promise<AiCompletionResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiProviderError({
      provider: "gemini",
      code: "MISSING_CREDENTIALS",
      message:
        "GEMINI_API_KEY is not configured on the server. Add your Google AI Studio key in environment variables.",
      retryable: false,
    });
  }

  const model =
    req.modelOverride?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-3.5-flash-lite";

  return executeGeminiCall(apiKey, model, req, true);
}

async function executeGeminiCall(
  apiKey: string,
  model: string,
  req: AiCompletionRequest,
  allowRetiredRetry: boolean
): Promise<AiCompletionResponse> {
  const startedAt = Date.now();
  const timeoutMs = req.timeoutMs ?? 28000;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: req.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: req.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxTokens ?? 2500,
          ...(req.jsonMode
            ? { responseMimeType: "application/json" }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AiProviderError({
      provider: "gemini",
      code: isTimeout ? "TIMEOUT" : "UPSTREAM_ERROR",
      message: isTimeout
        ? `Gemini API timed out after ${timeoutMs}ms.`
        : `Gemini network error: ${err instanceof Error ? err.message : "Unknown error"}`,
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
      parsed?.error?.message || `Gemini HTTP ${response.status}`;

    // If a retired 2.5 model was requested on a new 2026 Google AI Studio project,
    // retry once with gemini-3.5-flash-lite (free tier).
    if (
      allowRetiredRetry &&
      model !== "gemini-3.5-flash-lite" &&
      (response.status === 404 || /not found|retired|deprecated/i.test(upstreamMsg))
    ) {
      return executeGeminiCall(apiKey, "gemini-3.5-flash-lite", req, false);
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      /API_KEY_INVALID|permission/i.test(upstreamMsg)
    ) {
      throw new AiProviderError({
        provider: "gemini",
        code: "INVALID_CREDENTIALS",
        message: `Gemini credentials rejected: ${upstreamMsg}`,
        statusCode: response.status,
        retryable: false,
      });
    }

    if (response.status === 429) {
      const isQuota = /quota|RESOURCE_EXHAUSTED/i.test(upstreamMsg);
      throw new AiProviderError({
        provider: "gemini",
        code: isQuota ? "QUOTA_EXCEEDED" : "RATE_LIMITED",
        message: `Gemini rate/quota limit reached: ${upstreamMsg}`,
        statusCode: 429,
        retryable: true,
      });
    }

    if (response.status === 400 || response.status === 404) {
      throw new AiProviderError({
        provider: "gemini",
        code: "UNSUPPORTED_MODEL",
        message: `Gemini model '${model}' error: ${upstreamMsg}`,
        statusCode: response.status,
        retryable: true,
      });
    }

    throw new AiProviderError({
      provider: "gemini",
      code: "UPSTREAM_ERROR",
      message: `Gemini API error (${response.status}): ${upstreamMsg}`,
      statusCode: response.status,
      retryable: response.status >= 500,
    });
  }

  const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
  const content = parts
    .map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  return {
    provider: "gemini",
    model,
    content,
    promptTokens: Number(parsed?.usageMetadata?.promptTokenCount ?? 0),
    completionTokens: Number(parsed?.usageMetadata?.candidatesTokenCount ?? 0),
    latencyMs,
  };
}
