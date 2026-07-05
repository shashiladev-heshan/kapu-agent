"use client";

// Google Identity Services (the official "Sign in with Google" button).
// Loaded lazily, only when the account card is opened AND a client id is
// configured — guests never pay the script cost.

type GsiId = {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
  disableAutoSelect: () => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GsiId } };
  }
}

let loading: Promise<void> | null = null;

export function loadGsi(): Promise<void> {
  if (typeof window !== "undefined" && window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Failed to load Google Identity Services"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function renderGoogleButton(
  el: HTMLElement,
  clientId: string,
  onCredential: (credential: string) => void
): Promise<void> {
  await loadGsi();
  const id = window.google?.accounts.id;
  if (!id) return;
  id.initialize({ client_id: clientId, ux_mode: "popup", callback: (r) => onCredential(r.credential) });
  el.innerHTML = "";
  // filled_black sits naturally on Kapu's dark landing; the wrapper clips
  // the iframe's white corner bleed around the pill.
  id.renderButton(el, {
    theme: "filled_black",
    size: "large",
    shape: "pill",
    text: "continue_with",
    logo_alignment: "left",
    width: 320, // matches the CTA column — same width as 'Continue as guest'
  });
}

export function gsiSignOutHint(): void {
  try {
    window.google?.accounts.id.disableAutoSelect();
  } catch {
    /* fine */
  }
}
