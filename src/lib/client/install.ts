"use client";

// PWA install affordance.
//
// Two things make this harder than it looks:
//  1. Chrome fires `beforeinstallprompt` during page load, typically BEFORE
//     React hydrates — a listener added in useEffect misses it. An inline
//     script in the document head (see layout.tsx) catches it first and parks
//     it on `window.__kapuInstall`; we read that here.
//  2. Plenty of browsers never fire it at all (Safari, Firefox, and Chrome
//     itself until its engagement heuristics are satisfied). The whole point
//     of the button is that people LEARN the app is installable, so it stays
//     visible and falls back to per-platform instructions.
//
// The one case where it hides: we're already running as an installed app.

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __kapuInstall?: BeforeInstallPromptEvent | null;
  }
}

export type InstallPlatform = "ios" | "android" | "desktop";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export interface InstallPrompt {
  /** render the button? false only once the app is actually installed */
  canInstall: boolean;
  /** true when we have a real prompt and can skip the instructions */
  hasNativePrompt: boolean;
  platform: InstallPlatform;
  /** fires the native dialog; false when there was nothing to fire */
  install: () => Promise<boolean>;
}

export function useInstallPrompt(): InstallPrompt {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("desktop");

  useEffect(() => {
    setPlatform(detectPlatform());
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    // The head script may have captured the event long before we mounted.
    if (window.__kapuInstall) setReady(true);

    const onReady = () => setReady(true);
    const onInstalled = () => {
      setInstalled(true);
      setReady(false);
    };
    // kapu:* come from the head script; the raw events cover the case where
    // this component mounts before the browser gets around to firing them.
    window.addEventListener("kapu:installready", onReady);
    window.addEventListener("kapu:installed", onInstalled);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("kapu:installready", onReady);
      window.removeEventListener("kapu:installed", onInstalled);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const evt = typeof window !== "undefined" ? window.__kapuInstall : null;
    if (!evt) return false;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // Single-use: Chrome re-fires a fresh event if the user declined.
    window.__kapuInstall = null;
    setReady(false);
    return outcome === "accepted";
  }, []);

  return { canInstall: !installed, hasNativePrompt: ready, platform, install };
}
