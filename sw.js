const CACHE_NAME = "story-loom-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./src/main.js",
  "./src/models/storyProject.js",
  "./src/services/branchService.js",
  "./src/services/contextAssembler.js",
  "./src/services/openRouterService.js",
  "./src/services/imageService.js",
  "./src/storage/db.js",
  "./src/storage/projectStorage.js",
  "./src/ui/dialogs.js",
  "./src/ui/formFields.js",
  "./src/ui/renderBranches.js",
  "./src/ui/renderChat.js",
  "./src/ui/renderScene.js",
  "./src/ui/renderSettings.js",
  "./src/ui/renderStories.js",
  "./src/ui/renderWorld.js",
  "./src/ui/sheet.js",
  "./src/utils/id.js",
  "./src/utils/richText.js",
  "./src/utils/sanitize.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never intercept API traffic (OpenRouter) or other origins.
  if (url.origin !== self.location.origin) return;

  // Network-first so deployments show up on the next load; the cache keeps
  // the app working offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then(
            (cached) =>
              cached ||
              (request.mode === "navigate"
                ? caches.match("./index.html")
                : Response.error()),
          ),
      ),
  );
});
