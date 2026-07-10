"use client";

// Kapu's trilingual UI strings. The සිං/த/EN toggle is authoritative for the
// WHOLE chrome, not just the composer placeholder. Keys hold {en, si, ta};
// `{var}` placeholders are interpolated by t(). Components inside
// <LangProvider> use useT(); KapuApp itself uses makeT(language).

import { createContext, useContext } from "react";
import type { Language } from "@/lib/types";

type Entry = { en: string; si: string; ta: string };

const STR = {
  // ── shell / sidebar ──────────────────────────────────────────────────
  newWish: { en: "New wish", si: "අලුත් පැතුමක්", ta: "புதிய விருப்பம்" },
  recentWishes: { en: "Recent wishes", si: "මෑත පැතුම්", ta: "சமீபத்திய விருப்பங்கள்" },
  wishesEmpty: { en: "Your wishes will appear here.", si: "ඔයාගේ පැතුම් මෙතන පේනවා.", ta: "உங்கள் விருப்பங்கள் இங்கே தோன்றும்." },
  darkMode: { en: "Dark mode", si: "අඳුරු තේමාව", ta: "இருண்ட தீம்" },
  lightMode: { en: "Light mode", si: "ලා තේමාව", ta: "வெளிர் தீம்" },
  guest: { en: "Guest", si: "අමුත්තෙක්", ta: "விருந்தினர்" },
  syncOn: { en: "Wishes synced across devices", si: "පැතුම් හැම device එකකම", ta: "எல்லா சாதனங்களிலும் ஒத்திசைவு" },
  syncCta: { en: "Sign in to sync your wishes", si: "පැතුම් sync කරන්න — sign in වෙන්න", ta: "ஒத்திசைக்க உள்நுழையவும்" },
  deviceOnly: { en: "Wishes stay on this device", si: "පැතුම් මේ device එකේ විතරයි", ta: "விருப்பங்கள் இந்த சாதனத்தில் மட்டும்" },
  yourWishTree: { en: "your wish-tree", si: "ඔයාගේ පැතුම් ගහ", ta: "உங்கள் விருப்ப மரம்" },

  // ── deliver-to ───────────────────────────────────────────────────────
  setCity: { en: "Set delivery city", si: "ගෙන්වන නගරය", ta: "டெலிவரி நகர்" },
  deliverToChip: { en: "Deliver to {city}", si: "ගෙන්වන්නේ {city}ට", ta: "{city}க்கு டெலிவரி" },
  deliverToLabel: { en: "Deliver to", si: "ගෙන්වන්නේ", ta: "டெலிவரி" },
  cityPlaceholder: { en: "Type a city… kandy, kolpity, nugegoda", si: "නගරය ලියන්න… kandy, kolpity", ta: "நகரை எழுதுங்கள்… kandy, kolpity" },
  save: { en: "Save", si: "සුරකින්න", ta: "சேமி" },
  clear: { en: "Clear", si: "මකන්න", ta: "அழி" },
  deliverHelper: {
    en: "Suggestions are live from Kapruka — every one is deliverable. Kapu uses this as your default city.",
    si: "යෝජනා එන්නේ Kapruka එකෙන්මයි — ඔක්කොම ගෙන්විය හැකි නගර. මේක ඔයාගේ default නගරය වෙනවා.",
    ta: "பரிந்துரைகள் நேரடியாக Kapruka-விலிருந்து — அனைத்தும் டெலிவரி சாத்தியம்.",
  },
  cityNoMatch: {
    en: "අනේ — no deliverable city matches that. Try another spelling; Kapu understands Tanglish ones too.",
    si: "අනේ — ඒ නමට ගැලපෙන නගරයක් නෑ. වෙන spelling එකක් try කරන්න.",
    ta: "அந்த பெயருக்கு நகரம் இல்லை — வேறு எழுத்துப்பிழை முயற்சிக்கவும்.",
  },

  // ── hero ─────────────────────────────────────────────────────────────
  badgeLive: { en: "LIVE ON KAPRUKA · ISLANDWIDE DELIVERY", si: "KAPRUKA සජීවයි · මුළු දිවයිනටම", ta: "KAPRUKA நேரலை · நாடு முழுவதும்" },
  heroSub: {
    en: "Whisper a wish — groceries, phones, medicine, cakes to Kandy — and I'll shop all of Kapruka for you.",
    si: "පැතුමක් කියන්න — බඩු, phone, බෙහෙත්, නුවරට කේක් — Kapruka එකේ ඔක්කොම මම හොයලා දෙන්නම්.",
    ta: "ஒரு விருப்பம் சொல்லுங்கள் — மளிகை, போன், மருந்து, கண்டிக்கு கேக் — Kapruka முழுவதும் நான் வாங்கித் தருகிறேன்.",
  },
  heroLangs: { en: "Sinhala, Tamil, English or Tanglish.", si: "සිංහල, දෙමළ, English හෝ Tanglish.", ta: "தமிழ், சிங்களம், English அல்லது Tanglish." },
  speaks: { en: "Kapu speaks", si: "Kapu කතා කරන්නේ", ta: "Kapu பேசுவது" },
  poweredBy: { en: "— powered by the Kapruka MCP", si: "— Kapruka MCP මතින්", ta: "— Kapruka MCP மூலம்" },
  daysTo: { en: "{n} DAYS TO {name}", si: "{name}ට දින {n}යි", ta: "{name}க்கு {n} நாட்கள்" },
  festToday: { en: "{name} TODAY", si: "{name} අදයි!", ta: "{name} இன்று!" },
  giftIdeas: { en: "· gift ideas", si: "· තෑගි", ta: "· பரிசுகள்" },

  // ── demo wish cards ──────────────────────────────────────────────────
  chipPhone: { en: "Best phone under 60,000?", si: "60,000ට අඩු හොඳම phone එක?", ta: "60,000க்குள் சிறந்த போன்?" },
  chipPhoneSub: { en: "machan, mokakda hondama eka?", si: "මචං, මොකක්ද හොඳම එක?", ta: "மச்சான், எது பெஸ்ட்?" },
  chipGrocery: { en: "Weekly grocery run", si: "සතියේ බඩු ටික", ta: "வார மளிகை" },
  chipGrocerySub: { en: "rice, dhal, tea — build my cart", si: "හාල්, පරිප්පු, තේ — cart එක හදන්න", ta: "அரிசி, பருப்பு, தேயிலை" },
  chipCake: { en: "Cake to Amma in Kandy", si: "අම්මට නුවරට කේක් එකක්", ta: "கண்டியில் அம்மாவுக்கு கேக்" },
  chipCakeSub: { en: "surprise ekak — same day", si: "surprise එකක් — අදම", ta: "சர்ப்ரைஸ் — இன்றே" },
  chipPharmacy: { en: "Pharmacy essentials", si: "බෙහෙත් / first-aid", ta: "மருந்தகம் அத்தியாவசியம்" },
  chipPharmacySub: { en: "home first-aid kit", si: "ගෙදර first-aid kit එක", ta: "வீட்டு முதலுதவி" },
  chipFestival: { en: "Festival gift ideas", si: "උත්සව තෑගි", ta: "பண்டிகை பரிசுகள்" },
  chipFestivalSub: { en: "for parents in Colombo", si: "කොළඹ ඉන්න දෙමව්පියන්ට", ta: "கொழும்பில் பெற்றோருக்கு" },
  chipTrack: { en: "Track my order", si: "order එක track කරන්න", ta: "ஆர்டரை கண்காணிக்க" },
  chipTrackSub: { en: "see it arrive, photo proof", si: "photo proof එක්ක බලන්න", ta: "வந்து சேர்வதை பாருங்கள்" },
  chipRecipe: { en: "Kottu for 4 — recipe to cart", si: "හතරකට කොත්තු — recipe එකෙන් cart එකට", ta: "4 பேருக்கு கொத்து — கார்ட்" },
  chipRecipeSub: { en: "ingredients, sorted", si: "බඩු ඔක්කොම ලෑස්තියි", ta: "பொருட்கள் தயார்" },
  chipPirikara: { en: "Pirikara & dāna", si: "පිරිකර සහ දාන", ta: "பிரிகரா & தானம்" },
  chipPirikaraSub: { en: "arranged with respect", si: "ගෞරවයෙන් ලෑස්ති කරමු", ta: "மரியாதையுடன் ஏற்பாடு" },
  chipFeeling: { en: "Gift by feeling", si: "හැඟීමට තෑග්ගක්", ta: "உணர்வுக்கு ஒரு பரிசு" },
  chipFeelingSub: { en: "tell me how they feel — I'll find it", si: "එයාට දැනෙන විදිහ කියන්න", ta: "உணர்வை சொல்லுங்கள் — நான் தேடுகிறேன்" },

  // ── composer ─────────────────────────────────────────────────────────
  askAnything: { en: "Ask me anything… ඕන දෙයක්!", si: "ඕන දෙයක් අහන්න…", ta: "எதுவும் கேளுங்கள்…" },
  replyToKapu: { en: "Reply to Kapu…", si: "Kapuට reply කරන්න…", ta: "Kapu-க்கு பதில்…" },
  offlinePlaceholder: { en: "Offline — Kapu is napping…", si: "Offline — Kapu නිදි…", ta: "ஆஃப்லைன் — Kapu தூங்குகிறார்…" },

  // ── basket ───────────────────────────────────────────────────────────
  yourBasket: { en: "Your basket", si: "ඔයාගේ බාස්කට් එක", ta: "உங்கள் கூடை" },
  itemsN: { en: "{n} items", si: "බඩු {n}ක්", ta: "{n} பொருட்கள்" },
  item1: { en: "1 item", si: "බඩු 1යි", ta: "1 பொருள்" },
  basketEmpty: { en: "Your basket is empty — whisper a wish!", si: "බාස්කට් එක හිස් — පැතුමක් කියන්න!", ta: "கூடை காலி — ஒரு விருப்பம் சொல்லுங்கள்!" },
  flatNote: {
    en: "One flat delivery fee for the whole basket — Kapruka magic.",
    si: "මුළු බාස්කට් එකටම එක delivery ගාස්තුවයි — Kapruka magic.",
    ta: "முழு கூடைக்கும் ஒரே டெலிவரி கட்டணம் — Kapruka மேஜிக்.",
  },
  subtotal: { en: "Subtotal", si: "එකතුව", ta: "கூட்டுத்தொகை" },
  checkout: { en: "Checkout with Kapu", si: "Kapu එක්ක checkout", ta: "Kapu உடன் செக்அவுட்" },
  forgotChip: { en: "Anything I forgot?", si: "මොනවහරි අමතක වුණාද?", ta: "ஏதாவது மறந்துவிட்டதா?" },
  remove: { en: "Remove", si: "අයින් කරන්න", ta: "நீக்கு" },

  // ── product blocks ───────────────────────────────────────────────────
  inStock: { en: "In stock", si: "තියෙනවා", ta: "கையிருப்பில்" },
  outOfStock: { en: "Out of stock", si: "ඉවරයි", ta: "தீர்ந்துவிட்டது" },
  kapusPick: { en: "Kapu's pick", si: "Kapu ගේ තේරීම", ta: "Kapu தேர்வு" },
  saveToday: { en: "Save {n}% today", si: "අද {n}% අඩුයි", ta: "இன்று {n}% சேமிப்பு" },
  savePct: { en: "SAVE {n}%", si: "{n}% අඩුයි", ta: "{n}% தள்ளுபடி" },
  icingLabel: { en: "Icing message", si: "කේක් එකේ ලියන දේ", ta: "கேக் மீது எழுத" },
  deliverDay: { en: "Delivery day", si: "ගෙන්වන දවස", ta: "டெலிவரி நாள்" },
  deliverToCityLabel: { en: "Deliver to {city}", si: "{city}ට ගෙන්වන්න", ta: "{city}க்கு டெலிவரி" },
  tomorrow: { en: "Tomorrow", si: "හෙට", ta: "நாளை" },
  shipCheck: { en: "checking delivery to {city}…", si: "{city}ට ගෙන්වීම බලනවා…", ta: "{city}க்கு டெலிவரி சரிபார்க்கிறேன்…" },
  shipLine: { en: "flat {rate} to {city} · {date}", si: "{city}ට flat {rate} · {date}", ta: "{city}க்கு flat {rate} · {date}" },
  shipNext: { en: "not available {city} today — next: {date}", si: "{city}ට අද බෑ — ළඟම: {date}", ta: "{city}க்கு இன்று முடியாது — அடுத்து: {date}" },
  shipFrom: { en: "flat {rate} to {city} · from {date}", si: "{city}ට flat {rate} · {date} ඉඳන්", ta: "{city}க்கு flat {rate} · {date} முதல்" },
  totalBeforeDelivery: { en: "Total (delivery added at payment)", si: "එකතුව (ගෙන්වීම ගෙවීමේදී)", ta: "மொத்தம் (டெலிவரி பின்)" },
  options: { en: "Options", si: "විකල්ප", ta: "விருப்பங்கள்" },
  addToBasket: { en: "Add to basket", si: "බාස්කට් එකට දාන්න", ta: "கூடையில் சேர்" },
  viewOnKapruka: { en: "View on Kapruka", si: "Kapruka එකේ බලන්න", ta: "Kapruka-வில் பார்" },
  add: { en: "Add", si: "දාන්න", ta: "சேர்" },
  price: { en: "Price", si: "මිල", ta: "விலை" },
  deal: { en: "Deal", si: "වට්ටම", ta: "சலுகை" },
  availability: { en: "Availability", si: "තිබීම", ta: "இருப்பு" },
  weight: { en: "Weight", si: "බර", ta: "எடை" },
  seller: { en: "Seller", si: "විකුණන්නා", ta: "விற்பனையாளர்" },
  verdict: { en: "Kapu's verdict:", si: "Kapu ගේ තීන්දුව:", ta: "Kapu தீர்ப்பு:" },

  // ── delivery card ────────────────────────────────────────────────────
  deliversTo: { en: "Delivers to {city}", si: "{city}ට ගෙන්විය හැක", ta: "{city}க்கு டெலிவரி உண்டு" },
  flatRateLine: { en: "flat {rate} — one fee for the whole basket", si: "flat {rate} — මුළු බාස්කට් එකටම", ta: "flat {rate} — முழு கூடைக்கும்" },
  notAvailable: { en: "Not available for {city}", si: "{city}ට බෑ", ta: "{city}க்கு முடியாது" },
  nextAvailable: { en: "Next available: {date}", si: "ළඟම දවස: {date}", ta: "அடுத்த நாள்: {date}" },
  tryAnother: { en: "Try another date or a nearby city", si: "වෙන දවසක් හෝ ළඟ නගරයක් බලන්න", ta: "வேறு நாள் அல்லது அருகிலுள்ள நகரம்" },

  // ── order summary / pay ──────────────────────────────────────────────
  orderSummary: { en: "Order summary", si: "ඇණවුම් සාරාංශය", ta: "ஆர்டர் சுருக்கம்" },
  deliverToUpper: { en: "Deliver to", si: "ලබන්නා", ta: "பெறுநர்" },
  deliveryUpper: { en: "Delivery", si: "ගෙන්වීම", ta: "டெலிவரி" },
  flatRateWhole: { en: "Flat rate {rate} — whole order", si: "Flat {rate} — මුළු order එකටම", ta: "Flat {rate} — முழு ஆர்டருக்கும்" },
  rateAtPay: { en: "Flat rate confirmed at payment", si: "ගාස්තුව ගෙවීමේදී තහවුරු වේ", ta: "கட்டணம் செலுத்தும்போது உறுதி" },
  dateUnavailable: { en: "⚠ Not available this date — pick another", si: "⚠ මේ දවසට බෑ — වෙනත් දවසක්", ta: "⚠ இந்த நாளுக்கு முடியாது" },
  surpriseKept: { en: "Surprise kept — sender hidden", si: "Surprise එක රහසයි — යවන්නා හංගලා", ta: "சர்ப்ரைஸ் ரகசியம்" },
  cardLabel: { en: "Card:", si: "සුබපැතුම:", ta: "வாழ்த்து:" },
  total: { en: "Total", si: "මුළු එකතුව", ta: "மொத்தம்" },
  placeOrder: { en: "Yes — place the order", si: "හරි — order එක දාන්න", ta: "சரி — ஆர்டர் செய்" },
  changeSomething: { en: "Change something", si: "මොකක්හරි වෙනස් කරන්න", ta: "எதையாவது மாற்று" },
  orderCreated: { en: "Order created —", si: "Order එක හැදුවා —", ta: "ஆர்டர் உருவானது —" },
  wishGranted: { en: "wish granted!", si: "පැතුම ඉටුයි!", ta: "விருப்பம் நிறைவேறியது!" },
  refLine: {
    en: "Ref {ref} · your tracking number arrives by email after payment",
    si: "Ref {ref} · ගෙවීමෙන් පස්සේ tracking number එක email එකෙන් එනවා",
    ta: "Ref {ref} · பணம் செலுத்திய பின் tracking எண் மின்னஞ்சலில்",
  },
  paySecurely: { en: "Pay securely on Kapruka", si: "Kapruka එකෙන් ගෙවන්න", ta: "Kapruka-வில் பணம் செலுத்து" },
  priceLocked: { en: "Price locked", si: "මිල lock", ta: "விலை லாக்" },
  breakdown: { en: "Items {items} + delivery {delivery}", si: "බඩු {items} + ගෙන්වීම {delivery}", ta: "பொருட்கள் {items} + டெலிவரி {delivery}" },

  // ── timeline ─────────────────────────────────────────────────────────
  order: { en: "Order", si: "Order", ta: "ஆர்டர்" },
  stepReceived: { en: "Order received", si: "Order එක ලැබුණා", ta: "ஆர்டர் கிடைத்தது" },
  stepConfirmed: { en: "Confirmed", si: "තහවුරුයි", ta: "உறுதியானது" },
  stepShipped: { en: "Out for delivery", si: "ගෙනියනවා", ta: "டெலிவரிக்கு புறப்பட்டது" },
  stepDelivered: { en: "Delivered", si: "භාර දුන්නා", ta: "வழங்கப்பட்டது" },
  proofAppear: { en: "Photo proof will appear here", si: "Photo proof එක මෙතන එයි", ta: "புகைப்பட சான்று இங்கே வரும்" },
  seeArrive: { en: "See it arrive", si: "ලැබෙනවා බලන්න", ta: "வந்து சேர்வதை பாருங்கள்" },
  proofWait: { en: "Kapruka's rider snaps a photo or video at the door", si: "Kapruka rider දොරකඩදීම photo/video එකක් ගන්නවා", ta: "Kapruka ரைடர் வாசலில் புகைப்படம் எடுப்பார்" },
  proofCaptured: {
    en: "Delivery {kind} proof captured — view it on your Kapruka order page (email link)",
    si: "Delivery {kind} proof එක තියෙනවා — Kapruka order පිටුවෙන් බලන්න (email link)",
    ta: "டெலிவரி {kind} சான்று உள்ளது — Kapruka ஆர்டர் பக்கத்தில் பார்க்கவும்",
  },
  photo: { en: "photo", si: "photo", ta: "புகைப்பட" },
  video: { en: "video", si: "video", ta: "வீடியோ" },
  nudge: { en: "Nudge me on delivery", si: "ලැබුණම මට කියන්න", ta: "வந்ததும் சொல்லுங்கள்" },
  delivered: { en: "Delivered", si: "භාර දුන්නා", ta: "வழங்கப்பட்டது" },

  // ── misc blocks ──────────────────────────────────────────────────────
  noMatch: { en: "No exact match for “{q}”", si: "“{q}”ට හරියටම ගැලපෙන දෙයක් නෑ", ta: "“{q}”க்கு பொருத்தம் இல்லை" },

  // ── offline / errors ─────────────────────────────────────────────────
  napping: { en: "Kapu is napping", si: "Kapu නිදාගෙන", ta: "Kapu தூங்குகிறார்" },
  offline: { en: "offline", si: "offline", ta: "ஆஃப்லைன்" },
  offlineBody: {
    en: "— your chat and basket are saved on this phone. I'll wake the moment you're back online.",
    si: "— chat එකයි බාස්කට් එකයි මේ phone එකේ save වෙලා. Online වුණ ගමන් මම ඇහැරෙනවා.",
    ta: "— உங்கள் அரட்டையும் கூடையும் சேமிக்கப்பட்டுள்ளன. ஆன்லைனில் வந்ததும் எழுகிறேன்.",
  },
  noWorries: { en: "කරදරයක් නෑ", si: "කරදරයක් නෑ", ta: "கவலை வேண்டாம்" },
  itemsWaiting: { en: "{n} waiting · {total}", si: "{n}ක් බලාගෙන · {total}", ta: "{n} காத்திருக்கிறது · {total}" },
  savedTag: { en: "SAVED", si: "SAVE වුණා", ta: "சேமித்தது" },
  aiyoLost: { en: "Aiyo, I lost the connection!", si: "අයියෝ, connection එක ගියා!", ta: "ஐயோ, இணைப்பு போய்விட்டது!" },
  basketSafe: {
    en: "Your basket is safe with me. Check your signal and we'll pick up right where we left off.",
    si: "බාස්කට් එක මං ළඟ safe. Signal එක බලලා ආපහු එමු — නැවතුණ තැනින්ම පටන් ගමු.",
    ta: "உங்கள் கூடை பத்திரம். சிக்னலை சரிபார்த்து மீண்டும் தொடரலாம்.",
  },
  tryAgain: { en: "Try again", si: "ආයෙ try කරන්න", ta: "மீண்டும் முயற்சி" },
  copyMsg: { en: "Copy my message", si: "message එක copy කරන්න", ta: "செய்தியை நகலெடு" },
  gatesBusy: { en: "The Kapruka gates are busy", si: "Kapruka ගේට්ටුව කාර්යබහුලයි", ta: "Kapruka நுழைவாயில் பரபரப்பு" },
  retryingIn: { en: "Lots of wishes right now — retrying yours in {s}s", si: "දැන් පැතුම් ගොඩයි — තත්පර {s}කින් ආයෙ try කරනවා", ta: "நிறைய விருப்பங்கள் — {s} வினாடியில் மீண்டும்" },
  placeHeld: { en: "Your place in line is held — no need to resend.", si: "ඔයාගේ තැන තියලා තියෙනවා — ආයෙ එවන්න එපා.", ta: "உங்கள் இடம் பாதுகாக்கப்பட்டது." },

  // ── scan ─────────────────────────────────────────────────────────────
  readingPhoto: { en: "Kapu is reading your photo…", si: "Kapu photo එක කියවනවා…", ta: "Kapu புகைப்படத்தை படிக்கிறார்…" },
  holdOn: { en: "දැන් කියවනවා — hold on", si: "පොඩ්ඩක් ඉන්න…", ta: "கொஞ்சம் பொறுங்கள்…" },
  cantRead: { en: "Couldn't read that one", si: "ඒක කියවගන්න බැරි වුණා", ta: "அதை படிக்க முடியவில்லை" },
  retake: { en: "Retake", si: "ආයෙ ගන්න", ta: "மீண்டும் எடு" },
  close: { en: "Close", si: "වහන්න", ta: "மூடு" },
  cancel: { en: "Cancel", si: "නවත්තන්න", ta: "ரத்து" },

  // ── voice ────────────────────────────────────────────────────────────
  endVoice: { en: "End voice", si: "Voice නවත්තන්න", ta: "குரலை நிறுத்து" },
  doneSend: { en: "Done — send it", si: "ඉවරයි — යවන්න", ta: "முடிந்தது — அனுப்பு" },
  listeningPill: { en: "Listening — speak now!", si: "අහගෙන — කතා කරන්න!", ta: "கேட்கிறேன் — பேசுங்கள்!" },
  thinkingPill: { en: "Kapu is thinking…", si: "Kapu හිතනවා…", ta: "Kapu யோசிக்கிறார்…" },
  stepsDone: { en: "Done", si: "ඉවරයි", ta: "முடிந்தது" },
  stepsN: { en: "Worked through {n} steps", si: "පියවර {n}ක් කළා", ta: "{n} படிகள் செய்தேன்" },
  tapInterrupt: { en: "Speaking — tap anywhere to interrupt", si: "කතා කරනවා — නවත්තන්න tap කරන්න", ta: "பேசுகிறேன் — நிறுத்த தட்டவும்" },

  // ── welcome / sheet / account ────────────────────────────────────────
  welcomeSub: {
    en: "Sri Lanka's wish-granting shopping concierge —",
    si: "ලංකාවේ පැතුම් ඉටුකරන shopping සහයකයා —",
    ta: "இலங்கையின் விருப்பம் நிறைவேற்றும் ஷாப்பிங் உதவியாளர் —",
  },
  continueGuest: { en: "Continue as guest", si: "අමුත්තෙක් විදිහට යන්න", ta: "விருந்தினராக தொடர்" },
  guestKeep: {
    en: "Guests keep wishes on this device. Sign in with Google anytime — your wishes then follow you across devices.",
    si: "අමුත්තන්ගේ පැතුම් මේ device එකේ. ඕන වෙලාවක Google වලින් sign in වෙන්න — එතකොට පැතුම් හැමතැනම එනවා.",
    ta: "விருந்தினர் விருப்பங்கள் இந்த சாதனத்தில். எப்போது வேண்டுமானாலும் Google மூலம் உள்நுழையலாம்.",
  },
  repliesIn: { en: "Kapu replies in…", si: "Kapu reply කරන්නේ…", ta: "Kapu பதிலளிப்பது…" },
  pricesIn: { en: "Prices in…", si: "මිල පෙන්නන්නේ…", ta: "விலைகள்…" },
  voiceNote: {
    en: "Voice mode always speaks your language back — Sinhala included. Tip: just ask in chat —",
    si: "Voice mode එකේ Kapu ඔයාගේ භාෂාවෙන්ම කතා කරනවා — සිංහලත් ඇතුළුව. Tip: chat එකේම ඉල්ලන්න —",
    ta: "குரல் பயன்முறை உங்கள் மொழியிலேயே பேசும். குறிப்பு: அரட்டையில் கேளுங்கள் —",
  },
  switchInstant: { en: "— and Kapu switches instantly.", si: "— Kapu එසැණින් මාරු වෙනවා.", ta: "— Kapu உடனே மாறுவார்." },
  sendingAbroad: {
    en: "Sending from abroad? Kapu shows both — “Rs 4,850 · about $16”.",
    si: "පිටරට ඉඳන් එවනවද? Kapu දෙකම පෙන්නනවා — “Rs 4,850 · $16 විතර”.",
    ta: "வெளிநாட்டிலிருந்தா? இரண்டையும் காட்டுவார் — “Rs 4,850 · $16”.",
  },
  wishesEverywhere: { en: "Your wishes, everywhere", si: "ඔයාගේ පැතුම්, හැමතැනම", ta: "உங்கள் விருப்பங்கள், எங்கும்" },
  guestBrowsing: {
    en: "You're browsing as a guest — wishes stay on this device. Sign in and they follow you.",
    si: "ඔයා ඉන්නේ අමුත්තෙක් විදිහට — පැතුම් මේ device එකේ විතරයි. Sign in වුණොත් හැමතැනම එනවා.",
    ta: "விருந்தினராக உலாவுகிறீர்கள் — உள்நுழைந்தால் விருப்பங்கள் உங்களுடன் வரும்.",
  },
  signOut: { en: "Sign out", si: "Sign out", ta: "வெளியேறு" },
  guestModeNote: { en: "Guest mode — wishes stay on this device", si: "අමුත්තෙක් — පැතුම් මේ device එකේ", ta: "விருந்தினர் — இந்த சாதனத்தில் மட்டும்" },
  onTelegram: { en: "Also on Telegram", si: "Telegram එකෙනුත්", ta: "Telegram-லும்" },
  tgTitle: { en: "Kapu on Telegram", si: "Telegram එකේ Kapu", ta: "Telegram-ல் Kapu" },
  tgBlurb: {
    en: "Chat, send Sinhala voice notes, snap lists — and add Kapu to the family group (@mention to wake it; one shared basket).",
    si: "Chat කරන්න, සිංහල voice notes එවන්න, list photo ගන්න — family group එකටත් දාන්න (@mention කළාම ඇහැරෙනවා; බාස්කට් එක හැමෝටම එකයි).",
    ta: "அரட்டை, குரல் குறிப்புகள், பட்டியல் புகைப்படங்கள் — குடும்ப குழுவிலும் சேர்க்கலாம் (@mention செய்தால் விழிக்கும்).",
  },
  open: { en: "Open", si: "අරින්න", ta: "திற" },
  tgGuideTitle: { en: "Kapu in your pocket", si: "Kapu ඔයාගේ සාක්කුවේ", ta: "உங்கள் பாக்கெட்டில் Kapu" },
  tgGuideTag: {
    en: "Same brain, zero installs — full shopping inside Telegram.",
    si: "ඒ මොළේම — install කරන්න දෙයක් නෑ. Telegram ඇතුළෙම shopping.",
    ta: "அதே மூளை — நிறுவல் இல்லை. Telegram-க்குள் முழு ஷாப்பிங்.",
  },
  tgStep1: { en: "Tap the button — it opens", si: "Button එක ඔබන්න — ඇරෙනවා", ta: "பட்டனை தட்டுங்கள் — திறக்கும்" },
  tgStep2: { en: "Send /start, then just talk", si: "/start එවලා, ඊට පස්සේ කතා කරන්න", ta: "/start அனுப்பி, பேசுங்கள்" },
  tgCanVoice: { en: "Sinhala voice notes → basket", si: "සිංහල voice notes → බාස්කට් එකට", ta: "குரல் குறிப்புகள் → கூடைக்கு" },
  tgCanSnap: { en: "Snap a handwritten list — I read it", si: "අතේ ලියපු list එකේ photo එකක් — මම කියවනවා", ta: "கையெழுத்து பட்டியல் புகைப்படம் — படிக்கிறேன்" },
  tgCanGroup: {
    en: "Add me to the family group — @mention me; one shared basket",
    si: "Family group එකට දාන්න — @mention කරන්න; බාස්කට් එක හැමෝටම එකයි",
    ta: "குடும்ப குழுவில் சேர்க்கவும் — @mention; ஒரே கூடை",
  },
  tgCanBday: {
    en: "Unlike your friends, I actually remember birthdays 🎂",
    si: "යාළුවො වගේ නෙමෙයි — මට birthdays මතකයි 🎂",
    ta: "நண்பர்களை போல் அல்ல — பிறந்தநாட்கள் நினைவில் 🎂",
  },
  favorites: { en: "Favorites", si: "ප්‍රියතම", ta: "பிடித்தவை" },
  buildFromFavs: { en: "Build a basket from these", si: "මේවායින් බාස්කට් එකක් හදන්න", ta: "இவற்றில் கூடை உருவாக்கு" },
  favEmpty: { en: "Tap ♥ on any product — they collect here.", si: "ඕනම බඩුවක ♥ ඔබන්න — මෙතනට එකතු වෙනවා.", ta: "எந்த பொருளிலும் ♥ தட்டுங்கள்." },
  askKapu: { en: "Ask Kapu about this", si: "මේ ගැන Kapu ගෙන් අහන්න", ta: "இதைப் பற்றி Kapu-விடம் கேள்" },
  trackOrder: { en: "Track an order", si: "Order එක track කරන්න", ta: "ஆர்டரை கண்காணி" },
  trackHint: {
    en: "Use the order number Kapruka EMAILED after payment (e.g. VIMP34456CB2) — not the pre-payment ref.",
    si: "ගෙවීමෙන් පස්සේ Kapruka EMAIL කරපු order number එක දාන්න (උදා: VIMP34456CB2).",
    ta: "பணம் செலுத்திய பின் மின்னஞ்சலில் வந்த ஆர்டர் எண்ணை பயன்படுத்தவும்.",
  },
  trackPlaceholder: { en: "Order number… VIMP34456CB2", si: "Order number එක…", ta: "ஆர்டர் எண்…" },
  trackBtn: { en: "Track", si: "බලන්න", ta: "பார்" },
  shipsIntl: { en: "Ships worldwide from Kapruka", si: "ලෝකේ කොහේ හිටියත් Kapruka එකෙන් එවනවා", ta: "உலகம் எங்கும் Kapruka அனுப்பும்" },
  shipPick: { en: "Delivery cost? Type your city…", si: "ගෙන්නන ගාන? ඔයාගේ city එක ලියන්න…", ta: "டெலிவரி கட்டணம்? நகரம் எழுதுங்கள்…" },
  deliveryTo: { en: "delivery to {city}", si: "{city}ට delivery", ta: "{city}க்கு டெலிவரி" },
  totalWithDelivery: { en: "Total incl. delivery", si: "Delivery එක්ක මුළු ගාන", ta: "டெலிவரியுடன் மொத்தம்" },
  shipTo: { en: "flat to {city} · whole basket, one fee · {date}", si: "{city}ට flat — මුළු basket එකටම එක ගානයි · {date}", ta: "{city}க்கு flat — முழு கூடைக்கும் ஒரே கட்டணம் · {date}" },
  changeCity: { en: "change", si: "වෙනස්", ta: "மாற்று" },
  collapseSide: { en: "Collapse sidebar", si: "Sidebar එක හකුළන්න", ta: "பக்கப்பட்டியை சுருக்கு" },
  expandSide: { en: "Expand sidebar", si: "Sidebar එක දිග හරින්න", ta: "பக்கப்பட்டியை விரி" },
  moreLikeThis: { en: "More like this", si: "මේ වගේ තව", ta: "இது போல் மேலும்" },
  extrasPay: { en: "Pay in instalments at checkout", si: "Checkout එකේදී instalments වලින් ගෙවන්න පුළුවන්", ta: "தவணையில் செலுத்தலாம்" },
  extrasQA: { en: "Questions & answers", si: "ප්‍රශ්න & උත්තර", ta: "கேள்வி பதில்கள்" },
  extrasSrc: { en: "live from kapruka.com", si: "kapruka.com එකෙන් live", ta: "kapruka.com நேரலை" },
  reviewsN: { en: "{n} reviews", si: "reviews {n}", ta: "{n} விமர்சனங்கள்" },
  catExplorerT: { en: "Everything Kapruka sells", si: "Kapruka එකේ තියෙන හැමදේම", ta: "Kapruka-வில் விற்கும் அனைத்தும்" },
  forYouT: { en: "Picked for you", si: "ඔයාටම තෝරපු", ta: "உங்களுக்காக தேர்ந்தவை" },
  discTrend: { en: "Trending now", si: "දැන් trending", ta: "இப்போது டிரெண்டிங்" },
  discBudget: { en: "Under Rs 2,500", si: "රු. 2,500ට යටින්", ta: "ரூ. 2,500க்குள்" },
  discDeals: { en: "Hot deals", si: "වට්ටම්", ta: "தள்ளுபடிகள்" },
  heroHello: { en: "Ayubowan", si: "ආයුබෝවන්", ta: "வணக்கம்" },
  listen: { en: "Listen", si: "අහන්න", ta: "கேட்க" },
  stopListen: { en: "Stop", si: "නවත්තන්න", ta: "நிறுத்து" },
  allDeals: { en: "All", si: "ඔක්කොම", ta: "அனைத்தும்" },
  dealsLive: { en: "live promotions", si: "live promotions", ta: "நேரலை சலுகைகள்" },
  dealsCount: { en: "deals right now", si: "deals දැන් තියෙනවා", ta: "சலுகைகள்" },
  catBrowse: { en: "Browse ↗", si: "බලන්න ↗", ta: "பார்வையிட ↗" },
  useDateInstead: { en: "Use {d} instead →", si: "{d} වෙනිදට කරමු →", ta: "{d} அன்று வைப்போம் →" },
  trackedT: { en: "Tracked orders", si: "Track කරපු orders", ta: "கண்காணித்த ஆர்டர்கள்" },
  notifDevice: { en: "Notify on this device when it moves", si: "Order එක move වුණාම මේ device එකට කියන්න", ta: "நகரும்போது இந்த சாதனத்தில் அறிவி" },
  notifDeviceOn: { en: "This device will be notified ✓", si: "මේ device එකට notify වෙනවා ✓", ta: "இந்த சாதனம் அறிவிக்கப்படும் ✓" },
  recentOrdersT: { en: "Recent orders (pre-payment refs)", si: "මෑත orders (pre-payment refs)", ta: "சமீபத்திய ஆர்டர்கள்" },
  notifTitle: { en: "For you", si: "ඔයාට", ta: "உங்களுக்காக" },
  notifEmpty: { en: "Nothing right now — Kapu will nudge you here.", si: "දැනට මුකුත් නෑ — Kapu මෙතනින් මතක් කරයි.", ta: "இப்போது எதுவும் இல்லை — Kapu இங்கே நினைவூட்டுவார்." },
  planGift: { en: "Plan a gift", si: "තෑග්ග plan කරමු", ta: "பரிசு திட்டமிடு" },
  occLine: { en: "{who}'s {type} in {d} days", si: "{who}ගේ {type} එකට දින {d}යි", ta: "{who}-இன் {type}க்கு {d} நாட்கள்" },
  orderLine: { en: "Order {ref} — pay link ready", si: "Order {ref} — pay link එක ready", ta: "ஆர்டர் {ref} — கட்டண இணைப்பு" },
  openPay: { en: "Pay", si: "ගෙවන්න", ta: "செலுத்து" },
  notifications: { en: "Notifications", si: "දැනුම්දීම්", ta: "அறிவிப்புகள்" },
  myKapu: { en: "My Kapu — teach it your rules", si: "මගේ Kapu — ඔයාගේ නීති කියලා දෙන්න", ta: "என் Kapu — உங்கள் விதிகள்" },
  rulesPlaceholder: {
    en: "e.g. Vegetarian household. Never suggest alcohol. Warn me over Rs 20,000. Talk to me like a friend.",
    si: "උදා: අපේ ගෙදර vegetarian. Alcohol යෝජනා කරන්න එපා. රු. 20,000ට වැඩි නම් කියන්න.",
    ta: "உதா: சைவ வீடு. மது வேண்டாம். ரூ. 20,000க்கு மேல் எச்சரிக்கவும்.",
  },
  rulesHint: {
    en: "Kapu follows these in every conversation on this device — shopping rules, budgets, tone.",
    si: "මේ device එකේ හැම conversation එකකදීම Kapu මේවා පිළිපදිනවා.",
    ta: "இந்த சாதனத்தில் எல்லா உரையாடல்களிலும் Kapu இவற்றை பின்பற்றுவார்.",
  },
  rulesSaved: { en: "Saved — Kapu will remember", si: "Save වුණා — Kapu මතක තියාගනීවි", ta: "சேமிக்கப்பட்டது" },
  schedules: { en: "Schedules", si: "Schedules", ta: "அட்டவணைகள்" },
  schedTitle: { en: "Standing wishes", si: "නිත්‍ය පැතුම්", ta: "நிலையான விருப்பங்கள்" },
  schedBlurb: {
    en: "Kapu runs these on its own and reports back — ask in chat: “every month-end, flowers for Amma under Rs 5,000”.",
    si: "Kapu මේවා තනියම කරලා report කරනවා — chat එකේ කියන්න: “හැම මාසේ අන්තිමට අම්මට මල් — රු. 5,000ට යටින්”.",
    ta: "Kapu இவற்றை தானாக இயக்கி அறிக்கை அனுப்பும் — சாட்டில் கேளுங்கள்.",
  },
  schedEmpty: { en: "No standing wishes yet — ask Kapu to schedule one.", si: "තාම නෑ — Kapu ට කියන්න schedule කරන්න.", ta: "இன்னும் இல்லை — Kapu-விடம் கேளுங்கள்." },
  schedSignIn: { en: "Schedules need a Google sign-in, so they belong to YOU — not this browser.", si: "Schedules වලට Google sign-in ඕන — ඒවා ඔයාගේ, browser එකේ නෙමෙයි.", ta: "அட்டவணைகளுக்கு Google உள்நுழைவு தேவை." },
  schedNext: { en: "next: {when}", si: "ඊළඟ: {when}", ta: "அடுத்து: {when}" },
  schedOrderOk: { en: "may place orders (you pay via link)", si: "order දාන්න පුළුවන් (ගෙවන්නේ ඔයා)", ta: "ஆர்டர் செய்யலாம் (நீங்கள் செலுத்துவீர்கள்)" },
  schedProposeOnly: { en: "proposals only", si: "යෝජනා විතරයි", ta: "முன்மொழிவுகள் மட்டும்" },
  schedPaused: { en: "paused", si: "නවත්තලා", ta: "இடைநிறுத்தம்" },
  linkTg: { en: "Link Telegram for updates", si: "Updates වලට Telegram link කරන්න", ta: "புதுப்பிப்புகளுக்கு Telegram-ஐ இணைக்கவும்" },
  linkTgHint: { en: "Send /link to @{bot}, then enter the 6-digit code:", si: "@{bot} ට /link එවලා, code එක මෙතන දාන්න:", ta: "@{bot}க்கு /link அனுப்பி, குறியீட்டை உள்ளிடவும்:" },
  linkTgDone: { en: "Telegram linked ✓ — schedule updates go there", si: "Telegram link වුණා ✓", ta: "Telegram இணைக்கப்பட்டது ✓" },
  tryIt: { en: "Try: ", si: "Try කරන්න: ", ta: "முயற்சி: " },
  signIn: { en: "Sign in with Google", si: "Google එකෙන් sign in වෙන්න", ta: "Google மூலம் உள்நுழை" },

  // ── specialist Kapus ─────────────────────────────────────────────────
  agentsTitle: { en: "Specialist Kapus", si: "විශේෂඥ Kapu ලා", ta: "சிறப்பு Kapu-க்கள்" },
  agentsSub: {
    en: "One Kapu, many hats — pick a specialist for the job, or build your own.",
    si: "එක Kapu — hats ගොඩක්. වැඩේට ගැලපෙන කෙනා තෝරන්න, නැත්නම් ඔයාගේම කෙනෙක් හදන්න.",
    ta: "ஒரே Kapu, பல தொப்பிகள் — வேலைக்கு ஏற்ற நிபுணரைத் தேர்ந்தெடுங்கள், அல்லது சொந்தமாக உருவாக்குங்கள்.",
  },
  agentsRailTitle: { en: "or pick a specialist Kapu", si: "නැත්නම් විශේෂඥ Kapu කෙනෙක් තෝරන්න", ta: "அல்லது சிறப்பு Kapu ஒன்றைத் தேர்ந்தெடுங்கள்" },
  agentClassic: { en: "Classic Kapu", si: "සාමාන්‍ය Kapu", ta: "இயல்பான Kapu" },
  agentClassicTag: { en: "The all-round wish-granter", si: "ඔක්කොම පැතුම් ඉටුකරන කෙනා", ta: "எல்லா விருப்பங்களுக்கும்" },
  agentActive: { en: "ACTIVE", si: "සක්‍රීයයි", ta: "இயங்குகிறது" },
  agentCreate: { en: "Build your own Kapu", si: "ඔයාගේම Kapu කෙනෙක් හදන්න", ta: "உங்கள் சொந்த Kapu-வை உருவாக்குங்கள்" },
  agentNew: { en: "New", si: "අලුත්", ta: "புதிய" },
  agentNameL: { en: "Name — e.g. 'Amma's Helper'", si: "නම — උදා: 'අම්මගේ Helper'", ta: "பெயர் — எ.கா. 'அம்மாவின் உதவியாளர்'" },
  agentEmojiL: { en: "Emoji", si: "Emoji", ta: "Emoji" },
  agentInstrPh: {
    en: "What should this Kapu do? e.g. 'You shop for my mother in Galle: vegetarian, loves batik & gardening, budget Rs 8,000, always suggest a handwritten note.'",
    si: "මේ Kapu කරන්න ඕන මොනවද? උදා: 'ගාල්ලේ අම්මට shopping — vegetarian, batik වලට කැමතියි, budget රු. 8,000.'",
    ta: "இந்த Kapu என்ன செய்ய வேண்டும்? எ.கா. 'காலியில் அம்மாவுக்கு shopping — சைவம், batik பிடிக்கும், பட்ஜெட் ரூ. 8,000.'",
  },
  agentSave: { en: "Save Kapu", si: "Save කරන්න", ta: "சேமிக்கவும்" },
  agentSignIn: {
    en: "Sign in with Google to build your own Kapus — they sync across your devices.",
    si: "ඔයාගේම Kapu ලා හදන්න Google එකෙන් sign in වෙන්න — devices හැමතැනම sync වෙනවා.",
    ta: "உங்கள் சொந்த Kapu-க்களை உருவாக்க Google மூலம் உள்நுழையவும் — எல்லா சாதனங்களிலும் ஒத்திசைவு.",
  },
  landSee: { en: "See what Kapu can do", si: "Kapu ට පුළුවන් දේ බලන්න", ta: "Kapu-வால் முடிந்ததை பாருங்கள்" },
  landChatTitle: { en: "One wish. Watch it happen.", si: "එක පැතුමක්. වෙන හැටි බලන්න.", ta: "ஒரு விருப்பம். நடப்பதை பாருங்கள்." },
  landChatSub: {
    en: "From a Tanglish sentence to a paid-and-tracked gift — search, compare, basket, checkout, delivery proof.",
    si: "Tanglish වාක්‍යයක ඉඳන් ගෙදරටම — search, compare, basket, checkout, delivery proof.",
    ta: "ஒரு வாக்கியத்தில் இருந்து வீடு வரை — தேடல், ஒப்பீடு, கூடை, கட்டணம்.",
  },
  landFeatTitle: { en: "An agent, not a search box", si: "Search box එකක් නෙමෙයි — agent කෙනෙක්", ta: "தேடல் பெட்டி அல்ல — ஒரு முகவர்" },
  landTgTitle: { en: "The same brain on Telegram", si: "ඒ මොළේම Telegram එකේ", ta: "அதே மூளை Telegram-ல்" },
  landTgSub: {
    en: "Voice notes in Sinhala, photos of handwritten lists, and the family group with ONE shared basket — @mention to wake it.",
    si: "සිංහල voice notes, අතේ ලියපු lists වල photos, family group එකට එක basket එකක් — @mention කරන්න.",
    ta: "தமிழ்/சிங்கள குரல் குறிப்புகள், புகைப்படங்கள், குடும்ப குழு — ஒரே கூடை.",
  },
  landPwaTitle: { en: "In your pocket, too.", si: "සාක්කුවෙත් ඉන්නවා.", ta: "உங்கள் பாக்கெட்டிலும்." },
  landPwaSub: {
    en: "Kapu is a full mobile experience — install it as an app straight from the browser. No app store needed.",
    si: "Kapu සම්පූර්ණ mobile app එකක් — browser එකෙන්ම install කරන්න. App store එකක් ඕන නෑ.",
    ta: "Kapu ஒரு முழு மொபைல் அனுபவம் — உலாவியில் இருந்தே நிறுவுங்கள். ஆப் ஸ்டோர் தேவையில்லை.",
  },
  landPwaBtn: { en: "Add to Home Screen", si: "Home Screen එකට දාන්න", ta: "முகப்புத் திரையில் சேர்" },
  landPwaTag: { en: "PWA · wishes synced", si: "PWA · wishes sync වෙනවා", ta: "PWA · ஒத்திசைவு" },
  qrTitle: { en: "Continue on your phone", si: "Phone එකෙන් continue කරන්න", ta: "உங்கள் தொலைபேசியில் தொடரவும்" },
  qrHint: {
    en: "Scan → kapuwa.shop opens. Sign in with the same Google and your wishes follow you. Install as an app from the browser menu.",
    si: "Scan කරන්න → kapuwa.shop ඇරෙනවා. ඒ Google එකෙන්ම sign in උනාම wishes ඔයා පස්සෙන් එනවා.",
    ta: "ஸ்கேன் செய்யுங்கள் → kapuwa.shop திறக்கும். அதே Google-ல் உள்நுழைந்தால் உங்கள் விருப்பங்கள் பின்தொடரும்.",
  },
  bestValue: { en: "Best value", si: "හොඳම value", ta: "சிறந்த மதிப்பு" },
  basketQuip: {
    en: "Lovely picks! Say “checkout” when ready — I'll handle the rest 🌳",
    si: "ලස්සන picks! Ready උනාම “checkout” කියන්න — ඉතුරු ටික මම බලාගන්නම් 🌳",
    ta: "அழகான தேர்வுகள்! தயாரானதும் “checkout” சொல்லுங்கள் 🌳",
  },
  waPay: { en: "Send the pay link on WhatsApp", si: "Pay link එක WhatsApp එකෙන් යවන්න", ta: "WhatsApp-ல் அனுப்பு" },
  waBasket: { en: "Share basket on WhatsApp", si: "බාස්කට් එක WhatsApp share කරන්න", ta: "கூடையை WhatsApp-ல் பகிர்" },
  cardDownload: { en: "Download", si: "Download", ta: "பதிவிறக்கு" },
  cardShare: { en: "Share", si: "Share කරන්න", ta: "பகிர்" },
  seasonalPicks: { en: "{name} — Kapu's seasonal picks", si: "{name} — Kapu ගේ seasonal picks", ta: "{name} — Kapu-வின் பருவ தேர்வுகள்" },
  seasonalIn: { en: "{glyph} {greet} — {d} days to go", si: "{glyph} {greet} — තව දින {d}", ta: "{glyph} {greet} — இன்னும் {d} நாட்கள்" },
  landPickTitle: { en: "It doesn't list. It recommends.", si: "List කරනවා විතරක් නෙමෙයි — recommend කරනවා.", ta: "பட்டியல் அல்ல — பரிந்துரை." },
  landPickSub: {
    en: "The KAPU'S PICK badge is semantic — vector embeddings match what you MEANT, so asking for a phone can't crown a phone charger. Ask to compare and you get a side-by-side duel — per-row winners and a one-line verdict that tells you WHY, in your language.",
    si: "KAPU'S PICK badge එක semantic — ඔයා ඇත්තටම ඉල්ලපු දේට AI embeddings match වෙනවා; phone එකක් ඉල්ලුවම charger එකකට badge එක යන්නේ නෑ. Compare කරන්න කිව්වම per-row winners + ඇයි කියලා verdict එකක්.",
    ta: "KAPU'S PICK semantic ஆனது — நீங்கள் கேட்டதற்கு AI பொருந்துகிறது; phone கேட்டால் charger-க்கு badge போகாது. ஒப்பிடுங்கள் — வரிசை வெற்றியாளர்கள் + தீர்ப்பு.",
  },
  landPickHonest: {
    en: "And when nothing truly wins? Kapu says so. Honesty is a feature.",
    si: "මුකුත්ම හොඳ නැත්නම්? ඒකත් කියනවා. අවංකකම feature එකක්.",
    ta: "எதுவும் சிறந்ததாக இல்லை என்றால்? அதையும் சொல்லும்.",
  },
  landTasteTitle: {
    en: "It learns your taste — and shops ahead of you",
    si: "ඔයාගේ රුචිය ඉගෙන ගන්නවා — ඉස්සරහින්ම හොයලා තියනවා",
    ta: "உங்கள் ரசனையை கற்று — முன்கூட்டியே தேடுகிறது",
  },
  landTasteSub: {
    en: "Every search, tap and basket-add builds a private taste profile (vector embeddings, on our side — never sold). Kapu turns it into a 'Picked for you' rail, 'more like this' on any product, and live Trending / budget / deals rails from the real catalog.",
    si: "හැම search එකක්ම, tap එකක්ම, basket add එකක්ම ඔයාගේ taste profile එක හදනවා (vector embeddings — අපේ පැත්තේ, කාටවත් විකුණන්නේ නෑ). ඒකෙන් 'ඔයාටම තෝරපු' rail එකක්, ඕනම product එකකට 'මේ වගේ තව', සහ live Trending / budget rails.",
    ta: "ஒவ்வொரு தேடலும் உங்கள் ரசனை சுயவிவரத்தை உருவாக்குகிறது (vector embeddings — எங்களிடமே). அதிலிருந்து 'உங்களுக்காக' rail, 'இது போல் மேலும்', நேரடி Trending / budget rails.",
  },
  landTasteB1: {
    en: "'Picked for you' — recommendations from YOUR wishes, not a generic list",
    si: "'ඔයාටම තෝරපු' — ඔයාගේ wishes වලින්ම, generic list එකක් නෙමෙයි",
    ta: "'உங்களுக்காக' — உங்கள் விருப்பங்களிலிருந்தே",
  },
  landTasteB2: {
    en: "Say 'surprise me' in chat — the taste engine answers",
    si: "'මාව surprise කරන්න' කියන්න — taste engine එක උත්තර දෙනවා",
    ta: "'என்னை ஆச்சரியப்படுத்து' சொல்லுங்கள் — taste engine பதில்",
  },
  landTasteB3: {
    en: "🔥 Trending · 💸 Under Rs 2,500 · 🏷️ Deals — live from the catalog, every day",
    si: "🔥 Trending · 💸 රු. 2,500ට යටින් · 🏷️ Deals — දවස ගානේ live catalog එකෙන්",
    ta: "🔥 Trending · 💸 ரூ. 2,500க்குள் · 🏷️ Deals — தினமும் நேரடி",
  },
  landTechTitle: { en: "Under the hood", si: "ඇතුළේ තියෙන්නේ", ta: "உள்ளே என்ன" },
  landTechSub: {
    en: "One Node process on Railway. One agent core behind every channel. Every catalog call shielded. Money only through a human-paid link.",
    si: "Railway එකේ එක Node process එකයි. හැම channel එකක්ම පිටිපස්සේ එකම agent core එක.",
    ta: "ஒரே Node process. எல்லா சேனல்களுக்கும் ஒரே மூளை.",
  },
  landSeasonTitle: { en: "Tuned to the Sri Lankan calendar", si: "ලංකාවේ දින දර්ශනයටම හදලා", ta: "இலங்கை நாட்காட்டிக்கு ஏற்ப" },
  landSeasonSub: {
    en: "Kapu knows what Vesak forbids, what Avurudu demands, and when the Perahera season begins — and it acts on it.",
    si: "Vesak වලට නොදිය යුතු දේ, Avurudu වලට ඕන දේ, Perahera season එක එන වෙලාව — Kapu දන්නවා, ඒ අනුව වැඩ කරනවා.",
    ta: "வெசாக்கிற்கு எது கூடாது, புத்தாண்டுக்கு எது வேண்டும் — Kapu அறியும், செயல்படும்.",
  },
  landSeasonB1: { en: "Seasonal picks rail — real products for the coming festival, refreshed automatically", si: "Seasonal picks — එන festival එකට ඇත්ත products, auto refresh", ta: "பருவ தேர்வுகள் — வரும் பண்டிகைக்கு உண்மையான பொருட்கள்" },
  landSeasonB2: { en: "Festival etiquette built-in: no alcohol for Vesak, vegetarian for Deepavali, nekath timing for Avurudu", si: "Festival etiquette: Vesak ට alcohol නෑ, Deepavali ට vegetarian, Avurudu ට නැකැත්", ta: "பண்டிகை மரபுகள் உள்ளடக்கம்: தீபாவளிக்கு சைவம், நேரம் பார்த்தல்" },
  landSeasonB3: { en: "Price-drop watch — “tell me on Telegram if the hamper gets cheaper before Deepavali”", si: "Price-drop watch — “Deepavali කලින් hamper එක ලාබ උනොත් TG එකෙන් කියන්න”", ta: "விலை வீழ்ச்சி கண்காணிப்பு — Telegram-ல் அறிவிப்பு" },
  landSeasonB4: { en: "Greeting cards in perfect සිංහල/தமிழ் — designed, downloadable, WhatsApp-ready", si: "Greeting cards — perfect සිංහලෙන්, download කරලා WhatsApp යවන්න", ta: "வாழ்த்து அட்டைகள் — சரியான தமிழில், WhatsApp தயார்" },
  landVoiceTitle: { en: "Talk to Kapu — a real voice agent", si: "Kapu එක්ක කතා කරන්න — ඇත්තම voice agent", ta: "Kapu-வுடன் பேசுங்கள் — உண்மையான குரல் முகவர்" },
  landVoiceSub: {
    en: "Not a gimmick — a hands-free conversation loop. Speak Sinhala, Tamil or English; Kapu hears, thinks aloud, replies in your language and listens again.",
    si: "Gimmick එකක් නෙමෙයි — අත් නොගා කතා කරන loop එකක්. සිංහලෙන් කියන්න; Kapu අහලා, කටින්ම උත්තර දීලා, ආයෙත් අහගෙන ඉන්නවා.",
    ta: "தந்திரம் அல்ல — கை தொடாத உரையாடல். பேசுங்கள்; Kapu கேட்டு, பதில் சொல்லி, மீண்டும் கேட்கும்.",
  },
  landVoiceB1: { en: "Understands SPOKEN Sinhala — rare even in big-tech assistants", si: "කතා කරන සිංහල තේරෙනවා — ලොකු assistants ලටත් අමාරු දෙයක්", ta: "பேசும் சிங்களம்/தமிழ் புரியும்" },
  landVoiceB2: { en: "Instant spoken acknowledgments — no dead air while it works", si: "වැඩ කරන ගමන් කටින්ම කියනවා — නිශ්ශබ්දතාවක් නෑ", ta: "வேலை செய்யும்போதே பேசும் — அமைதி இல்லை" },
  landVoiceB3: { en: "Barge-in: interrupt it mid-sentence, like a real conversation", si: "කතාව මැදින් cut කරන්න පුළුවන් — ඇත්ත conversation එකක් වගේ", ta: "இடைமறிக்கலாம் — உண்மையான உரையாடல் போல" },
  landVoiceB4: {
    en: "Results stream in as live cards while you talk — hands-free on iPhone too",
    si: "කතා කරන ගමන් cards විදිහට results එනවා — iPhone එකෙත් අත් නොගා",
    ta: "பேசும்போதே கார்டுகளாக முடிவுகள் — iPhone-லும் கை தொடாமல்",
  },
  landVoiceCta: { en: "Try voice mode", si: "Voice mode try කරන්න", ta: "குரல் முறையை முயற்சிக்கவும்" },
  landTrackTitle: {
    en: "Every step, live — warehouse to doorstep",
    si: "හැම step එකක්ම live — warehouse එකේ ඉඳන් දොරකඩටම",
    ta: "ஒவ்வொரு படியும் நேரலை — கிடங்கிலிருந்து வீடு வரை",
  },
  landTrackSub: {
    en: "Paste the order number Kapruka emails you. Kapu shows the whole journey as it happens, remembers your orders for one-tap re-checks, and pings you the moment anything moves.",
    si: "Kapruka email කරන order number එක දාන්න. මුළු ගමනම පෙන්නනවා, orders මතක තියාගන්නවා, මොකක් හරි move වුණ ගමන් කියනවා.",
    ta: "Kapruka அனுப்பும் ஆர்டர் எண்ணை இடுங்கள். முழு பயணமும் நேரலையில், நகர்ந்தவுடன் அறிவிப்பு.",
  },
  landTrackB1: {
    en: "The full journey — every warehouse & courier step, timestamped",
    si: "මුළු ගමනම — warehouse + courier හැම step එකක්ම, වෙලාවත් එක්ක",
    ta: "முழு பயணம் — ஒவ்வொரு படியும், நேரத்துடன்",
  },
  landTrackB2: {
    en: "Movement alerts — on this device or straight to Telegram",
    si: "Move වුණ ගමන් alerts — device එකට හරි Telegram එකට හරි",
    ta: "நகர்வு அறிவிப்புகள் — சாதனத்திலோ Telegram-லோ",
  },
  landTrackB3: {
    en: "Ends with photo proof at the door",
    si: "අන්තිමට දොරකඩ photo proof එකත් එනවා",
    ta: "இறுதியில் வாசலில் புகைப்பட சான்று",
  },
  landTrackCta: { en: "Watch a real order's journey", si: "ඇත්තම order එකක ගමන බලන්න", ta: "உண்மையான ஆர்டரின் பயணத்தை பாருங்கள்" },
  landStart: { en: "Start wishing — it's free", si: "පතන්න පටන් ගන්න — නොමිලේ", ta: "விரும்பத் தொடங்குங்கள் — இலவசம்" },
  landF1t: { en: "Speaks your language", si: "ඔයාගේ භාෂාව", ta: "உங்கள் மொழி" },
  landF1b: { en: "සිංහල · தமிழ் · English · Tanglish — script-perfect replies, spoken Sinhala included.", si: "සිංහල · தமிழ் · English · Tanglish — කතාවත් තේරෙනවා.", ta: "நான்கு மொழிகள் — பேச்சும் புரியும்." },
  landF2t: { en: "Sees your lists", si: "List එක photo එකෙන්", ta: "பட்டியலை பார்க்கிறது" },
  landF2b: { en: "Snap a handwritten shopping list — basket filled, Sinhala scrawl included.", si: "අතේ ලියපු list එකේ photo එකක් — basket එක fill.", ta: "கையெழுத்து பட்டியல் → கூடை நிரம்பும்." },
  landF3t: { en: "Runs on its own", si: "තනියම duwanawa", ta: "தானாக இயங்கும்" },
  landF3b: { en: "\"Flowers for Amma every month-end\" — scheduled, executed, pay link to your Telegram.", si: "\"හැම මාසෙම අම්මට මල්\" — schedule කරලා තනියම කරනවා.", ta: "மாதந்தோறும் தானாக — கட்டண இணைப்பு TGக்கு." },
  landF4t: { en: "Remembers with consent", si: "අහලා මතක තියාගන්නවා", ta: "அனுமதியுடன் நினைவு" },
  landF4b: { en: "Amma's address, birthdays, your budget rules — asked first, never scraped.", si: "Address, birthdays, ඔයාගේ rules — කලින් අහලා.", ta: "முகவரி, பிறந்தநாள், விதிகள் — முதலில் கேட்டு." },
  landF5t: { en: "Honest checkout", si: "අවංක checkout", ta: "நேர்மையான கட்டணம்" },
  landF5b: { en: "Visual confirm gate, price-locked pay link, delivery photo proof. No dark patterns.", si: "Confirm gate + pay link + delivery proof. වංචා නෑ.", ta: "உறுதி → கட்டணம் → ஆதாரம். ஏமாற்று இல்லை." },
  landF7t: { en: "Knows Kapruka inside out", si: "Kapruka ගැන ඔක්කොම දන්නවා", ta: "Kapruka பற்றி முழுதும் தெரியும்" },
  landF7b: {
    en: "Returns, refunds, delivery rules, company info — answered from kapruka.com's own pages via a ChromaDB knowledge base, always with the source link.",
    si: "Returns, refunds, delivery නීති — kapruka.com පිටුවලින්මයි, source link එකත් එක්කම.",
    ta: "Returns, delivery விதிகள் — kapruka.com பக்கங்களிலிருந்தே, source link உடன்.",
  },
  landF6t: { en: "Feels the moment", si: "හැඟීම තේරෙනවා", ta: "உணர்வை புரியும்" },
  landF6b: { en: "\"Amma feels lonely\" → a thoughtful gift, not a search error. Festivals, pirikara, nekath included.", si: "\"අම්මා තනිවෙලා\" → හරි තෑග්ග. උත්සව, පිරිකර, නැකැත්.", ta: "உணர்வுக்கு ஏற்ற பரிசு — பண்டிகைகளும்." },
  tourNext: { en: "Next", si: "ඊළඟ", ta: "அடுத்து" },
  tourSkip: { en: "Skip tour", si: "Skip කරන්න", ta: "தவிர்" },
  tourDone: { en: "Let's go! 🌳", si: "පටන් ගමු! 🌳", ta: "தொடங்குவோம்! 🌳" },
  tourOf: { en: "{a} of {b}", si: "{a}/{b}", ta: "{a}/{b}" },
  tourT1: { en: "Whisper a wish", si: "පැතුමක් කියන්න", ta: "ஒரு விருப்பம் சொல்லுங்கள்" },
  tourB1: {
    en: "Type in Sinhala, Tamil, English or Tanglish — \"machan mata phone ekak one 60000 ta aduwen\" just works.",
    si: "සිංහල, தமிழ், English හෝ Tanglish — ඕන විදිහකට ලියන්න. Kapu ට තේරෙනවා.",
    ta: "சிங்களம், தமிழ், ஆங்கிலம் — எப்படி வேண்டுமானாலும் எழுதுங்கள்.",
  },
  tourT2: { en: "Snap a list 📸", si: "List එකේ photo එකක්", ta: "பட்டியலின் புகைப்படம்" },
  tourB2: {
    en: "Photograph a handwritten shopping list — even Sinhala scrawl — and I'll fill the basket.",
    si: "අතේ ලියපු බඩු list එකේ photo එකක් ගන්න — මම කියවලා බාස්කට් එක පුරවනවා.",
    ta: "கையெழுத்து பட்டியலை புகைப்படம் எடுங்கள் — கூடையை நிரப்புகிறேன்.",
  },
  tourT3: { en: "Talk to me 🎙", si: "කතා කරන්න 🎙", ta: "பேசுங்கள் 🎙" },
  tourB3: {
    en: "Hands-free voice — I understand spoken Sinhala and reply out loud. Tap the chip on the voice screen to switch languages.",
    si: "කටින් කියන්න — සිංහල කතාව තේරෙනවා, මමත් කටින් උත්තර දෙනවා.",
    ta: "பேசினால் போதும் — புரிந்துகொண்டு சத்தமாக பதில் சொல்கிறேன்.",
  },
  tourT4: { en: "Or start from a wish", si: "පැතුමකින් පටන් ගන්න", ta: "ஒரு விருப்பத்தில் தொடங்குங்கள்" },
  tourB4: {
    en: "Cakes to Kandy, recipe-to-cart, pirikara, gifts by feeling — tap any card and watch.",
    si: "නුවරට කේක්, recipe-to-cart, පිරිකර — ඕනම card එකක් ඔබලා බලන්න.",
    ta: "கண்டிக்கு கேக், சமையல் பட்டியல், பரிசுகள் — எதையும் தட்டுங்கள்.",
  },
  tourT5: { en: "Also on Telegram ✈️", si: "Telegram එකෙත් ඉන්නවා", ta: "Telegram-லும் இருக்கிறேன்" },
  tourB5: {
    en: "Same brain in your pocket — voice notes, photos, even the family group with one shared basket.",
    si: "ඒ මොළේම ඔයාගේ phone එකේ — voice notes, photos, family group එකත් එක්ක.",
    ta: "அதே மூளை உங்கள் பாக்கெட்டில் — குரல், புகைப்படம், குடும்ப குழு.",
  },
  tourT7: { en: "Prices in your currency 💱", si: "ඔබේ මුදලින් මිල", ta: "உங்கள் நாணயத்தில் விலை" },
  tourB7: { en: "Diaspora-friendly: pick USD, GBP, EUR & more — every price converts live (checkout stays LKR).", si: "USD, GBP වගේ currency එකක් තෝරන්න — හැම මිලක්ම convert වෙනවා. ගෙවීම LKR වලින්මයි.", ta: "USD, GBP போன்றவற்றைத் தேர்ந்தெடுங்கள் — எல்லா விலைகளும் மாறும். கட்டணம் LKR-ல் தான்." },
  tourT6: { en: "ඔබේ භාෂාව · உங்கள் மொழி", si: "ඔබේ භාෂාව", ta: "உங்கள் மொழி" },
  tourB6: {
    en: "Flip the whole experience to Sinhala or Tamil — UI, replies, voice, everything.",
    si: "සම්පූර්ණ app එකම සිංහලට හරවන්න — UI, උත්තර, voice, ඔක්කොම.",
    ta: "முழு அனுபவத்தையும் தமிழுக்கு மாற்றுங்கள் — எல்லாமே.",
  },
  watchOrder: { en: "Watch this order — Telegram updates", si: "මේ order එක බලාගන්න — TG updates", ta: "இந்த ஆர்டரை கண்காணி — TG" },
  schedRan: { en: "{title}: {result}", si: "{title}: {result}", ta: "{title}: {result}" },
  schedUpcoming: { en: "{title} — runs {when}", si: "{title} — {when}ට duwanawa", ta: "{title} — {when}க்கு இயங்கும்" },
  tgFoot: { en: "Free · works in groups · pays with a secure Kapruka link", si: "නොමිලේ · groups වලත් · secure Kapruka link එකෙන් ගෙවීම", ta: "இலவசம் · குழுக்களில் · பாதுகாப்பான Kapruka லிங்க்" },
} satisfies Record<string, Entry>;

export type StrKey = keyof typeof STR;

export function makeT(lang: Language) {
  return (key: StrKey, vars?: Record<string, string | number>): string => {
    let s: string = STR[key][lang] ?? STR[key].en;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** Rotating hero phrases — each is a REAL runnable capability. */
export interface HeroPhrase {
  text: string;
  kind: "msg" | "voice" | "camera";
  msg?: string;
}
export const HERO_PHRASES: Record<Language, HeroPhrase[]> = {
  en: [
    { text: "🎂 I can send a surprise cake to Amma in Kandy — today.", kind: "msg", msg: "ammage birthday ekata Kandy walata cake ekak yawanna ona, surprise ekak 🎂" },
    { text: "🎙 I understand Sinhala when you SPEAK it — try me.", kind: "voice" },
    { text: "📸 I can read your handwritten shopping list from a photo.", kind: "camera" },
    { text: "🧺 I can build a festival hamper under Rs 15,000 — one flat delivery.", kind: "msg", msg: "Build me a festival hamper under Rs 15,000 — everything in one delivery" },
    { text: "💜 Tell me a feeling — “amma feels lonely” — I'll find the gift.", kind: "msg", msg: "My mother has been feeling lonely since I moved abroad — what should I send her?" },
    { text: "🚚 I deliver islandwide — Jaffna to Galle, next day, flat rate.", kind: "msg", msg: "Can you deliver to Jaffna tomorrow? What's the flat rate?" },
    { text: "🔮 I can book a real horoscope reading for auspicious timing.", kind: "msg", msg: "Show me Kapruka's astrology and horoscope reading services" },
    { text: "🎁 Unlike your friends, I actually remember birthdays.", kind: "msg", msg: "Can you remember my people's birthdays and help me plan gifts? How does it work?" },
    { text: "⏰ I can send flowers every month-end — all on my own.", kind: "msg", msg: "Every month-end, pick fresh flowers under Rs 5,000 for Amma and schedule it — update me on Telegram" },
    { text: "📦 I show your order's WHOLE journey — warehouse to doorstep, live.", kind: "msg", msg: "Track order VIMP34456CB2 — show me every step of the journey" },
    { text: "🏷️ Show me today's offers — real deals, real discounts.", kind: "msg", msg: "Show me today's hot deals and offers" },
    { text: "📋 Ask me Kapruka's return policy — I answer from the real pages, link included.", kind: "msg", msg: "What's Kapruka's return policy? How long do refunds take?" },
    { text: "🕐 “Same-day delivery cutoff?” — I know Kapruka's actual rules.", kind: "msg", msg: "How does Kapruka's same day delivery work? What's the cutoff time?" },
  ],
  si: [
    { text: "🎂 අම්මට නුවරට කේක් එකක් — අදම යවන්න පුළුවන්.", kind: "msg", msg: "ammage birthday ekata Kandy walata cake ekak yawanna ona, surprise ekak 🎂" },
    { text: "🎙 සිංහලෙන් කතා කරන්න — මට තේරෙනවා. Try කරන්න!", kind: "voice" },
    { text: "📸 අතේ ලියපු බඩු list එකේ photo එක මම කියවනවා.", kind: "camera" },
    { text: "🧺 රු. 15,000ට අඩුවෙන් hamper එකක් — එක delivery එකයි.", kind: "msg", msg: "Build me a festival hamper under Rs 15,000 — everything in one delivery" },
    { text: "💜 හැඟීම කියන්න — “අම්මා තනිවෙලා” — තෑග්ග මම හොයන්නම්.", kind: "msg", msg: "My mother has been feeling lonely since I moved abroad — what should I send her?" },
    { text: "🚚 යාපනේ ඉඳන් ගාල්ල වෙනකම් — හෙට වෙනකොට, flat rate.", kind: "msg", msg: "Can you deliver to Jaffna tomorrow? What's the flat rate?" },
    { text: "🔮 නැකතට — ඇත්තම horoscope reading එකක් book කරන්න පුළුවන්.", kind: "msg", msg: "Show me Kapruka's astrology and horoscope reading services" },
    { text: "🎁 යාළුවො වගේ නෙමෙයි — මට birthdays මතකයි.", kind: "msg", msg: "Can you remember my people's birthdays and help me plan gifts? How does it work?" },
    { text: "⏰ හැම මාසෙම මල් — මම තනියම යවන්නම්.", kind: "msg", msg: "Every month-end, pick fresh flowers under Rs 5,000 for Amma and schedule it — update me on Telegram" },
    { text: "📦 Order එකේ මුළු ගමනම live පෙන්නනවා — දොරකඩ වෙනකම්.", kind: "msg", msg: "Track order VIMP34456CB2 — show me every step of the journey" },
    { text: "🏷️ අදම තියෙන offers බලන්න — ඇත්තම වට්ටම්.", kind: "msg", msg: "Show me today's hot deals and offers" },
    { text: "📋 Return policy එක අහන්න — ඇත්ත pages වලින්මයි, link එකත් එක්ක.", kind: "msg", msg: "What's Kapruka's return policy? How long do refunds take?" },
    { text: "🕐 “Same-day cutoff එක කීයද?” — Kapruka නීති මම දන්නවා.", kind: "msg", msg: "How does Kapruka's same day delivery work? What's the cutoff time?" },
  ],
  ta: [
    { text: "🎂 கண்டியில் அம்மாவுக்கு கேக் — இன்றே அனுப்பலாம்.", kind: "msg", msg: "ammage birthday ekata Kandy walata cake ekak yawanna ona, surprise ekak 🎂" },
    { text: "🎙 தமிழில் பேசுங்கள் — எனக்கு புரியும். முயற்சிக்கவும்!", kind: "voice" },
    { text: "📸 கையெழுத்து பட்டியலின் புகைப்படத்தை படிக்கிறேன்.", kind: "camera" },
    { text: "🧺 ரூ. 15,000க்குள் ஒரு hamper — ஒரே டெலிவரி.", kind: "msg", msg: "Build me a festival hamper under Rs 15,000 — everything in one delivery" },
    { text: "💜 உணர்வை சொல்லுங்கள் — பரிசை நான் தேடுகிறேன்.", kind: "msg", msg: "My mother has been feeling lonely since I moved abroad — what should I send her?" },
    { text: "🚚 யாழ்ப்பாணம் முதல் காலி வரை — நாளை, flat rate.", kind: "msg", msg: "Can you deliver to Jaffna tomorrow? What's the flat rate?" },
    { text: "🔮 நேரம் பார்க்க — உண்மையான ஜாதக சேவை புக் செய்யலாம்.", kind: "msg", msg: "Show me Kapruka's astrology and horoscope reading services" },
    { text: "🎁 நண்பர்களை போல் அல்ல — பிறந்தநாட்கள் நினைவில்.", kind: "msg", msg: "Can you remember my people's birthdays and help me plan gifts? How does it work?" },
    { text: "⏰ மாத இறுதியில் பூக்கள் — நானே அனுப்புவேன்.", kind: "msg", msg: "Every month-end, pick fresh flowers under Rs 5,000 for Amma and schedule it — update me on Telegram" },
    { text: "📦 ஆர்டரின் முழு பயணமும் நேரலை — வீடு வரை.", kind: "msg", msg: "Track order VIMP34456CB2 — show me every step of the journey" },
    { text: "🏷️ இன்றைய சலுகைகள் — உண்மையான தள்ளுபடிகள்.", kind: "msg", msg: "Show me today's hot deals and offers" },
    { text: "📋 Return policy கேளுங்கள் — உண்மை பக்கங்களிலிருந்து, link உடன்.", kind: "msg", msg: "What's Kapruka's return policy? How long do refunds take?" },
    { text: "🕐 “Same-day cutoff எப்போது?” — Kapruka விதிகள் தெரியும்.", kind: "msg", msg: "How does Kapruka's same day delivery work? What's the cutoff time?" },
  ],
};

const LangContext = createContext<Language>("en");
export const LangProvider = LangContext.Provider;

/** Translator hook for components below <LangProvider> (blocks etc.). */
export function useT() {
  const lang = useContext(LangContext);
  return makeT(lang);
}

export function useLang(): Language {
  return useContext(LangContext);
}
