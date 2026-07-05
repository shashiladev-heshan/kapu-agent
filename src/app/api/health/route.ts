export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, agent: "kapu", time: new Date().toISOString() });
}
