// /api/agents — the signed-in user's library of self-built specialist Kapus.
// Presets live client-side in code; this stores ONLY custom ones (synced
// across devices via KapuUser.agents). The active agent itself rides each
// /api/chat request inline — this route never sits on the chat path.

import { readUser } from "@/lib/auth/session";
import { getUser, saveUser, upsertUser, type CustomAgent } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGENTS = 6;

function clean(raw: Partial<CustomAgent>): CustomAgent | null {
  const name = String(raw.name ?? "").trim().slice(0, 40);
  const instructions = String(raw.instructions ?? "").trim().slice(0, 400);
  if (name.length < 2 || instructions.length < 10) return null;
  return {
    id: /^c_[a-z0-9-]{4,24}$/.test(String(raw.id)) ? String(raw.id) : `c_${Math.random().toString(36).slice(2, 10)}`,
    name,
    emoji: String(raw.emoji ?? "🤖").trim().slice(0, 8) || "🤖",
    tagline: String(raw.tagline ?? "").trim().slice(0, 80) || undefined,
    instructions,
  };
}

export async function GET(req: Request): Promise<Response> {
  const identity = readUser(req);
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await getUser(identity.sub);
  return Response.json({ agents: user?.agents ?? [] });
}

export async function POST(req: Request): Promise<Response> {
  const identity = readUser(req);
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  let raw: Partial<CustomAgent>;
  try {
    raw = ((await req.json()) as { agent?: Partial<CustomAgent> }).agent ?? {};
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const agent = clean(raw);
  if (!agent) {
    return Response.json({ error: "A name (2+ chars) and instructions (10+ chars) are required" }, { status: 400 });
  }
  const user = (await getUser(identity.sub)) ?? (await upsertUser(identity));
  const idx = user.agents.findIndex((a) => a.id === agent.id);
  if (idx >= 0) user.agents[idx] = agent;
  else {
    if (user.agents.length >= MAX_AGENTS) {
      return Response.json({ error: `Up to ${MAX_AGENTS} custom Kapus — delete one first` }, { status: 400 });
    }
    user.agents.push(agent);
  }
  saveUser(user);
  return Response.json({ agent, agents: user.agents });
}

export async function DELETE(req: Request): Promise<Response> {
  const identity = readUser(req);
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const user = await getUser(identity.sub);
  if (user) {
    user.agents = user.agents.filter((a) => a.id !== id);
    saveUser(user);
  }
  return Response.json({ agents: user?.agents ?? [] });
}
