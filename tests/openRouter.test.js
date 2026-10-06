import test from "node:test";
import assert from "node:assert/strict";

import { streamChatCompletion } from "../src/services/openRouterService.js";

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamResponse(chunks, { status = 200, close = true } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (close) controller.close();
    },
  });
  return new Response(body, { status });
}

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const baseRequest = {
  apiKey: "test-key",
  model: "test/model",
  messages: [{ role: "user", content: "Hello" }],
};

test("streamChatCompletion assembles tokens and finish reason", async () => {
  const response = streamResponse([
    sseChunk({ choices: [{ delta: { content: "Once " } }] }),
    sseChunk({ choices: [{ delta: { content: "upon" } }] }),
    sseChunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]\n\n",
  ]);
  const tokens = [];

  const result = await withFetch(
    async () => response,
    () =>
      streamChatCompletion({
        ...baseRequest,
        onToken: (token) => tokens.push(token),
      }),
  );

  assert.equal(result.text, "Once upon");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(tokens, ["Once ", "upon"]);
});

test("streamChatCompletion surfaces the max-tokens finish reason", async () => {
  const response = streamResponse([
    sseChunk({ choices: [{ delta: { content: "Cut" } }] }),
    sseChunk({ choices: [{ delta: {}, finish_reason: "length" }] }),
    "data: [DONE]\n\n",
  ]);

  const result = await withFetch(
    async () => response,
    () => streamChatCompletion(baseRequest),
  );

  assert.equal(result.text, "Cut");
  assert.equal(result.finishReason, "length");
});

test("streamChatCompletion throws on mid-stream error payloads", async () => {
  const response = streamResponse([
    sseChunk({ choices: [{ delta: { content: "Part" } }] }),
    sseChunk({ error: { message: "Provider exploded", code: 502 } }),
  ]);

  await withFetch(
    async () => response,
    () =>
      assert.rejects(streamChatCompletion(baseRequest), {
        message: "Provider exploded",
      }),
  );
});

test("streamChatCompletion processes a trailing line without a newline", async () => {
  const response = streamResponse([
    sseChunk({ choices: [{ delta: { content: "Start" } }] }),
    `data: ${JSON.stringify({ choices: [{ delta: { content: " end" } }] })}`,
  ]);

  const result = await withFetch(
    async () => response,
    () => streamChatCompletion(baseRequest),
  );

  assert.equal(result.text, "Start end");
});

test("streamChatCompletion times out when the stream stalls", async () => {
  const response = streamResponse(
    [sseChunk({ choices: [{ delta: { content: "Stuck" } }] })],
    { close: false },
  );

  await withFetch(
    async () => response,
    () =>
      assert.rejects(
        streamChatCompletion({ ...baseRequest, stallTimeoutMs: 40 }),
        { name: "StallError" },
      ),
  );
});

test("streamChatCompletion throws when the stream contains no content", async () => {
  const response = streamResponse(["data: [DONE]\n\n"]);

  await withFetch(
    async () => response,
    () =>
      assert.rejects(streamChatCompletion(baseRequest), {
        message: "OpenRouter returned an empty response.",
      }),
  );
});

test("streamChatCompletion surfaces HTTP error payloads", async () => {
  const response = new Response(
    JSON.stringify({ error: { message: "Bad key" } }),
    { status: 401 },
  );

  await withFetch(
    async () => response,
    () =>
      assert.rejects(streamChatCompletion(baseRequest), {
        message: "Bad key",
        status: 401,
      }),
  );
});

test("streamChatCompletion maps fetch failures to a friendly error", async () => {
  await withFetch(
    async () => {
      throw new TypeError("fetch failed");
    },
    () =>
      assert.rejects(streamChatCompletion(baseRequest), {
        message: "Network error — could not reach OpenRouter.",
      }),
  );
});

test("streamChatCompletion captures usage from the final chunk", async () => {
  const response = streamResponse([
    sseChunk({ choices: [{ delta: { content: "Hi" } }] }),
    sseChunk({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 45, cost: 0.00021 },
    }),
    "data: [DONE]\n\n",
  ]);

  const result = await withFetch(
    async () => response,
    () => streamChatCompletion(baseRequest),
  );

  assert.deepEqual(result.usage, {
    prompt_tokens: 120,
    completion_tokens: 45,
    cost: 0.00021,
  });
});

test("streamChatCompletion returns null usage when none is sent", async () => {
  const response = streamResponse([
    sseChunk({ choices: [{ delta: { content: "Hi" } }] }),
    "data: [DONE]\n\n",
  ]);

  const result = await withFetch(
    async () => response,
    () => streamChatCompletion(baseRequest),
  );

  assert.equal(result.usage, null);
});

test("extractImageDataUrl finds the first data-URL image on the message", async () => {
  const { extractImageDataUrl } = await import("../src/services/imageService.js");
  assert.equal(
    extractImageDataUrl({
      choices: [
        {
          message: {
            content: "Here you go",
            images: [
              { image_url: { url: "https://example.com/not-inline.png" } },
              { image_url: { url: "data:image/png;base64,AAAA" } },
            ],
          },
        },
      ],
    }),
    "data:image/png;base64,AAAA",
  );
  assert.equal(extractImageDataUrl({ choices: [{ message: { content: "no images" } }] }), null);
  assert.equal(extractImageDataUrl({}), null);
});

test("extractFalImageUrl reads fal.ai image results", async () => {
  const { extractFalImageUrl } = await import("../src/services/imageService.js");
  assert.equal(
    extractFalImageUrl({ images: [{ url: "data:image/png;base64,BBBB", width: 1024 }] }),
    "data:image/png;base64,BBBB",
  );
  assert.equal(
    extractFalImageUrl({ images: ["https://fal.media/files/x.png"] }),
    "https://fal.media/files/x.png",
  );
  assert.equal(extractFalImageUrl({ images: [] }), null);
  assert.equal(extractFalImageUrl({ detail: "error" }), null);
});
