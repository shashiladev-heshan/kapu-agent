// Kapu's 1.6px stroke icon set — extracted from the design system.
// Every icon inherits `currentColor` so themes/tints work via CSS.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: P, vb = "0 0 20 20") {
  return {
    width: size,
    height: size,
    viewBox: vb,
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
    ...props,
  };
}

export const IconPlus = (p: P) => (
  <svg {...base(p, "0 0 15 15")}>
    <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const IconMic = (p: P) => (
  <svg {...base(p)}>
    <rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconSendUp = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 10h12m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 10.5 4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Solid colored circle with a white tick — pass `fill` (default green). */
export const IconCheckCircle = ({ fill = "#2E9E5B", ...p }: P & { fill?: string }) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="8" fill={fill} />
    <path d="M6.5 10.2 9 12.6l4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base(p, "0 0 10 6")}>
    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 4h8v8M16 4 6 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17h14M12.5 3.5l4 4L7 17H3v-4l9.5-9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 12.8V5.2A1.2 1.2 0 0 1 5.2 4h7.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const THUMB_PATH =
  "M6.5 9v7.5M6.5 9l3-5.5A1.6 1.6 0 0 1 12.6 4.4V8h3.2a1.6 1.6 0 0 1 1.55 2l-1.15 5A1.6 1.6 0 0 1 14.65 16.5H6.5M6.5 9H4.6A1.1 1.1 0 0 0 3.5 10.1v5.3a1.1 1.1 0 0 0 1.1 1.1H6.5";

export const IconThumbUp = (p: P) => (
  <svg {...base(p)}>
    <path d={THUMB_PATH} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export const IconThumbDown = (p: P) => (
  <svg {...base(p)}>
    <path d={THUMB_PATH} transform="rotate(180 10 10)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export const IconDots = (p: P) => (
  <svg {...base(p)}>
    <circle cx="4.5" cy="10" r="1.35" fill="currentColor" />
    <circle cx="10" cy="10" r="1.35" fill="currentColor" />
    <circle cx="15.5" cy="10" r="1.35" fill="currentColor" />
  </svg>
);

export const IconShare = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="10" r="2.1" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="14" cy="5" r="2.1" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="14" cy="15" r="2.1" stroke="currentColor" strokeWidth="1.5" />
    <path d="m7.9 9 4.2-2.8M7.9 11l4.2 2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6h11M8 6V4.6A1.6 1.6 0 0 1 9.6 3h.8A1.6 1.6 0 0 1 12 4.6V6m2.2 0-.6 9.1A1.6 1.6 0 0 1 12 16.6H8A1.6 1.6 0 0 1 6.4 15.1L5.8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconBasket = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h12l-1 8.2a1.5 1.5 0 0 1-1.5 1.3h-7A1.5 1.5 0 0 1 5 16.2L4 8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M7 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconTrolley = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 5.5h2l1.6 8.4a1.5 1.5 0 0 0 1.5 1.1h6.3a1.5 1.5 0 0 0 1.4-1l1.7-5H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8.5" cy="17.2" r="1" fill="currentColor" />
    <circle cx="14.5" cy="17.2" r="1" fill="currentColor" />
  </svg>
);

export const IconPhone = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="2.5" width="8" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const IconCake = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9h12v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16V9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path
      d="M4 11c1.2 1 2 .2 3-.4s2 1.2 3 .5 2-1.2 3-.4 2 .9 3 .3M10 9V6.5M10 4.5c-.8-.7-.6-2 .4-2.3.3.9 0 1.8-.4 2.3Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const IconCapsule = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="14" height="6" rx="3" transform="rotate(-45 10 10)" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7.5 12.5l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const IconGift = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="7" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M10 7v10M3.5 11h13M10 7c-2.5 0-3.6-1.6-3-3 .8-1.7 3-.6 3 3Zm0 0c2.5 0 3.6-1.6 3-3-.8-1.7-3-.6-3 3Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconPackage = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M3.5 6.5 10 10m0 0 6.5-3.5M10 10v7" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

export const IconInstall = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 13.5v1.8A1.7 1.7 0 0 0 5.7 17h8.6a1.7 1.7 0 0 0 1.7-1.7v-1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const IconList = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5.5h12M4 10h12M4 14.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const IconGlobe = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 10h14M10 3c-3.5 3.8-3.5 10.2 0 14 3.5-3.8 3.5-10.2 0-14Z" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15.5 12.2A6.5 6.5 0 0 1 7.8 4.5a6.5 6.5 0 1 0 7.7 7.7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="5" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M15.7 4.3l-1.3 1.3M5.6 14.4 4.3 15.7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const IconPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 18s6-5.1 6-9.6A6 6 0 0 0 4 8.4C4 12.9 10 18 10 18Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="10" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 6v4.2l2.8 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconTruck = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M2.5 13.5h9m0 0V7a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 7v6.5Zm9-4h3.2c.5 0 .9.2 1.2.6l1.6 2.2c.2.3.3.6.3.9v.3h-2.3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="15.5" r="1.7" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="14.5" cy="15.5" r="1.7" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const IconBell = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M10 3.5c-2.8 0-4.5 2-4.5 4.5v3L4 13.5h12L14.5 11V8c0-2.5-1.7-4.5-4.5-4.5ZM8.5 16a1.6 1.6 0 0 0 3 0"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconCamera = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M3.5 7A1.5 1.5 0 0 1 5 5.5h1.6l1-1.5h4.8l1 1.5H15A1.5 1.5 0 0 1 16.5 7v7.5A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5V7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="10.5" r="2.8" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const IconKeyboard = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="6" width="15" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5.5 9h.8m2.4 0h.8m2.4 0h.8M6.5 12.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const IconStop = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="5" width="10" height="10" rx="2.5" fill="currentColor" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4.5v11l9-5.5-9-5.5Z" fill="currentColor" />
  </svg>
);

export const IconVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8v4h3l4 3.5v-11L7 8H4Z" fill="currentColor" />
    <path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.3 6.3 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const IconWifiOff = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M2.5 7.5a11 11 0 0 1 6.2-3M12.8 4.8a11 11 0 0 1 4.7 2.7M5.5 10.5a7 7 0 0 1 3.4-1.9m4.3.6a7 7 0 0 1 1.8 1.3M8.5 13.5a3.4 3.4 0 0 1 3 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <circle cx="10" cy="16" r="1.2" fill="currentColor" />
    <path d="m3 3 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconRetry = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M16.5 8A6.7 6.7 0 0 0 4.2 6.2M3.5 12a6.7 6.7 0 0 0 12.3 1.8M3.5 12v4m0-4h4m9-4V4m0 4h-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M10 3.2c.55 3 2.25 4.7 5.3 5.3-3.05.6-4.75 2.3-5.3 5.3-.55-3-2.25-4.7-5.3-5.3 3.05-.6 4.75-2.3 5.3-5.3Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M15.6 13.4v3.6m-1.8-1.8h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const IconSearchNone = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="m13.5 13.5 3.5 3.5M7 9h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="8.5" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const IconReceipt = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M6 3.5h8A1.5 1.5 0 0 1 15.5 5v12.5l-2.2-1.4-1.65 1.4L10 16.1l-1.65 1.4-1.65-1.4-2.2 1.4V5A1.5 1.5 0 0 1 6 3.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M7.5 8h5M7.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const IconFacebook = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M13.5 20v-6.5h2.2l.4-2.8h-2.6V8.9c0-.8.3-1.4 1.5-1.4h1.2V5a17 17 0 0 0-1.9-.1c-2.1 0-3.6 1.3-3.6 3.7v2.1H8.5v2.8h2.2V20"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconInstagram = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="16.8" cy="7.2" r="1.1" fill="currentColor" />
  </svg>
);

export const IconWhatsapp = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M3 17l1.05-3.8A6.9 6.9 0 1 1 6.9 16L3 17Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M7.6 7.1c.16-.36.33-.37.48-.38h.4c.13 0 .32-.05.5.38l.6 1.45c.05.13.09.28 0 .44l-.28.42c-.09.12-.19.25-.08.44.1.19.47.77 1 1.25.69.61 1.27.8 1.45.9.18.09.29.07.4-.04l.56-.65c.13-.15.25-.11.41-.05l1.4.66c.16.08.27.12.31.19.04.07.04.4-.11.79-.15.38-.9.75-1.22.79-.32.04-.61.16-2.06-.43-1.75-.71-2.85-2.5-2.94-2.62-.08-.12-.7-.93-.7-1.78 0-.85.45-1.27.61-1.44Z"
      fill="currentColor"
    />
  </svg>
);

export const IconTelegram = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M17 3.5 2.8 9.2c-.9.36-.85 1.63.07 1.93l3.63 1.16 1.4 4.4c.28.87 1.4 1.06 1.95.33l1.9-2.55 3.7 2.7c.68.5 1.65.13 1.83-.7L19.5 4.9c.2-.95-.72-1.76-1.62-1.4Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="m6.5 12.3 8.2-6.1-6.3 6.9-.2 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)}>
    <path
      d="M10 16.5S3.5 12.6 3.5 8.2C3.5 5.9 5.3 4.3 7.3 4.3c1.1 0 2.1.5 2.7 1.4.6-.9 1.6-1.4 2.7-1.4 2 0 3.8 1.6 3.8 3.9 0 4.4-6.5 8.3-6.5 8.3Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill={filled ? "currentColor" : "none"}
    />
  </svg>
);

export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4 16.5c.8-2.8 3.2-4.2 6-4.2s5.2 1.4 6 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconWish = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M12 7.5 8.5 11m0 0L10 12.5m-1.5-1.5L7 9.5M4.2 15.8c2.8 2.8 8 2 10.7-.7 2.7-2.7 3.4-7.9.6-10.6-2.7-2.8-7.9-2.1-10.6.6-2.7 2.7-3.5 7.9-.7 10.7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

/** The official Kapu wish-tree mark on its purple app tile
 *  (from assets/brand/kapu-app-icon.svg — two-tone gold canopy). */
export function KapuMark({ size = 32, radius = 10 }: { size?: number; radius?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" fill="none" aria-hidden style={{ flex: "none" }}>
      <rect width="240" height="240" rx={radius * (240 / size)} fill="#402970" />
      <g transform="translate(0,6) scale(0.88) translate(16,10)">
        <circle cx="120" cy="88" r="52" fill="#FFB800" />
        <circle cx="75" cy="120" r="38" fill="#FFB800" />
        <circle cx="165" cy="120" r="38" fill="#F8DA08" />
        <circle cx="120" cy="88" r="19" fill="#402970" />
        <rect x="111" y="130" width="18" height="80" rx="9" fill="#F2F0F7" />
      </g>
    </svg>
  );
}

/** Category-tinted placeholder art when a product has no photo. */
export function productTint(category?: string | null): { bg: string; fg: string; kind: "cake" | "grocery" | "phone" | "generic" } {
  const c = (category || "").toLowerCase();
  if (/cake|flower|sweet|chocolate|combo|gift/.test(c)) return { bg: "linear-gradient(150deg,#F7E8EA,#EFD3D8)", fg: "#CE9AA4", kind: "cake" };
  if (/grocer|food|rice|tea|vegetable|fruit|spice|curd/.test(c)) return { bg: "linear-gradient(150deg,#F4EFE4,#EADFC8)", fg: "#C9B98F", kind: "grocery" };
  if (/electronic|phone|computer|tv|camera|appliance/.test(c)) return { bg: "linear-gradient(150deg,#EFE9F9,#E0D6F0)", fg: "#B4A5D6", kind: "phone" };
  return { bg: "linear-gradient(150deg,#E7EEF4,#D3E0EA)", fg: "#9FB4C4", kind: "generic" };
}
