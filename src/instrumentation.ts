// Next.js server-start hook — boots the in-process schedule runner
// (Railway = one long-running Node container, so a setInterval is exactly
// the right tool; no external cron needed).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Langfuse first — the tracer provider must exist before any turn runs.
    const { initTracing } = await import("@/lib/obs/langfuse");
    await initTracing();
    const { startScheduler } = await import("@/lib/schedules/runner");
    startScheduler();
    // knowledge base: hydrate/crawl in the background at boot, re-check twice a day
    const { ensureKbFresh } = await import("@/lib/kb/store");
    setTimeout(() => void ensureKbFresh(), 15_000);
    setInterval(() => void ensureKbFresh(), 12 * 3600_000);
  }
}
