const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const IMAGE_MODEL_PRESETS = [
  "google/gemini-2.5-flash-image",
  "openai/gpt-4o-image",
];

// OpenRouter serves image-output models through the same chat endpoint;
// requesting the "image" modality returns pictures as data URLs on the
// assistant message.
export async function generateImage({ apiKey, model, prompt, signal }) {
  if (!apiKey?.trim()) {
    throw new Error("Enter an OpenRouter API key in Settings.");
  }
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": globalThis.location?.href || "https://localhost/",
        "X-Title": "Story Loom",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Network error — could not reach OpenRouter.");
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      (typeof payload.error === "string"
        ? payload.error
        : payload.error?.message) ||
      `Image request failed (${response.status}).`;
    throw new Error(String(message));
  }

  const dataUrl = extractImageDataUrl(payload);
  if (!dataUrl) {
    throw new Error(
      "The model returned no image. Check that the image model in Settings supports image output.",
    );
  }
  return {
    dataUrl,
    text: payload.choices?.[0]?.message?.content || "",
  };
}

const FAL_ENDPOINT = "https://fal.run/fal-ai/lora";

// fal.ai runs open-source Stable Diffusion checkpoints — including community
// fine-tunes from CivitAI or Hugging Face — through its browser-callable
// fal-ai/lora endpoint. model_name is a HF id or a CivitAI download URL;
// sync_mode makes fal return the image inline as a data URI.
export async function generateFalImage({ apiKey, modelName, prompt, signal }) {
  if (!apiKey?.trim()) {
    throw new Error("Enter a fal.ai API key in Settings.");
  }
  if (!modelName?.trim()) {
    throw new Error(
      "Enter a fal.ai checkpoint (Hugging Face id or CivitAI download URL) in Settings.",
    );
  }
  let response;
  try {
    response = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_name: modelName.trim(),
        prompt,
        sync_mode: true,
      }),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Network error — could not reach fal.ai.");
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item?.msg).filter(Boolean).join("; ")
      : payload.detail || payload.error;
    throw new Error(
      String(detail || `fal.ai request failed (${response.status}).`),
    );
  }

  const url = extractFalImageUrl(payload);
  if (!url) {
    throw new Error("fal.ai returned no image.");
  }
  if (url.startsWith("data:image/")) {
    return { dataUrl: url, text: "" };
  }
  // Without sync_mode (or for large outputs) fal returns a hosted URL;
  // pull it down so the pixels can live in IndexedDB like every other image.
  const imageResponse = await fetch(url, { signal });
  if (!imageResponse.ok) {
    throw new Error("Could not download the generated image from fal.ai.");
  }
  const blob = await imageResponse.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image data."));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, text: "" };
}

export function extractFalImageUrl(payload) {
  const images = payload?.images;
  if (!Array.isArray(images)) return null;
  for (const image of images) {
    const url = typeof image === "string" ? image : image?.url;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

export function extractImageDataUrl(payload) {
  const images = payload?.choices?.[0]?.message?.images;
  if (!Array.isArray(images)) return null;
  for (const image of images) {
    const url = image?.image_url?.url;
    if (typeof url === "string" && url.startsWith("data:image/")) {
      return url;
    }
  }
  return null;
}
