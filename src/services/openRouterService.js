const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_STALL_TIMEOUT_MS = 60000;

export async function sendChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.8,
  maxTokens = 1200,
  signal,
}) {
  const response = await requestCompletion({
    apiKey,
    model,
    messages,
    temperature,
    maxTokens,
    stream: false,
    signal,
  });
  const payload = await parseResponse(response);
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return {
    text: content,
    finishReason: choice?.finish_reason ?? null,
    usage: toUsage(payload.usage),
  };
}

export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.8,
  maxTokens = 1200,
  onToken = () => {},
  signal,
  stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
}) {
  const response = await requestCompletion({
    apiKey,
    model,
    messages,
    temperature,
    maxTokens,
    stream: true,
    signal,
  });

  if (!response.ok) {
    await parseResponse(response);
  }
  if (!response.body) {
    return sendChatCompletion({
      apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      signal,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completeText = "";
  let finishReason = null;
  let usage = null;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      // Ignore malformed keep-alive chunks while continuing the stream.
      return;
    }
    if (payload.error) {
      throw new Error(
        toErrorMessage(payload.error) || "OpenRouter returned an error.",
      );
    }
    if (payload.usage) {
      usage = toUsage(payload.usage) ?? usage;
    }
    const choice = payload.choices?.[0];
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }
    const token = choice?.delta?.content;
    if (typeof token === "string" && token) {
      completeText += token;
      onToken(token, completeText);
    }
  };

  try {
    while (true) {
      const { done, value } = await readWithStallTimeout(
        reader,
        stallTimeoutMs,
      );
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        handleLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      handleLine(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed or errored; nothing left to release.
    }
  }

  if (!completeText) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return { text: completeText, finishReason, usage };
}

async function readWithStallTimeout(reader, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return reader.read();
  }
  let timer;
  const stall = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        "The response stalled — check your connection and try again.",
      );
      error.name = "StallError";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([reader.read(), stall]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestCompletion({
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  stream,
  signal,
}) {
  const headers = createHeaders(apiKey);
  try {
    return await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
        usage: { include: true },
      }),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      globalThis.navigator?.onLine === false
        ? "Network error — you appear to be offline."
        : "Network error — could not reach OpenRouter.",
    );
  }
}

function createHeaders(apiKey) {
  if (!apiKey?.trim()) {
    throw new Error("Enter an OpenRouter API key in Settings.");
  }
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": globalThis.location?.href || "https://localhost/",
    "X-Title": "Story Loom",
  };
}

function toUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  const cost = Number(usage.cost);
  const result = {};
  if (Number.isFinite(promptTokens)) result.prompt_tokens = promptTokens;
  if (Number.isFinite(completionTokens)) {
    result.completion_tokens = completionTokens;
  }
  if (Number.isFinite(cost)) result.cost = cost;
  return Object.keys(result).length ? result : null;
}

function toErrorMessage(error) {
  if (typeof error === "string") return error;
  return error?.message ? String(error.message) : "";
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      toErrorMessage(payload.error) ||
      (response.status === 401
        ? "OpenRouter rejected the API key."
        : response.status === 429
          ? "OpenRouter rate limit reached. Please wait and try again."
          : `OpenRouter request failed (${response.status}).`);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}
