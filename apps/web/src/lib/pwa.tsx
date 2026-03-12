"use client";

import { useEffect } from "react";

export function PwaInitializer() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const swUrl = "/sw.js";

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register(swUrl, { scope: "/" });
        if (registration.waiting) {
          notifyUpdateReady(registration.waiting);
        } else if (registration.installing) {
          trackInstalling(registration.installing);
        } else if (registration.active) {
          // already activated
        }
      } catch (error) {
        console.warn("PWA service worker registration failed:", error);
      }
    };

    const trackInstalling = (worker: ServiceWorker | null) => {
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          notifyUpdateReady(worker);
        }
      });
    };

    const notifyUpdateReady = (worker: ServiceWorker) => {
      worker.postMessage({ type: "SKIP_WAITING" });
    };

    registerServiceWorker();
  }, []);

  return null;
}
