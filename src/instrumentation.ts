// Next.js server-start hook — boots the in-process schedule runner
// (Railway = one long-running Node container, so a setInterval is exactly
// the right tool; no external cron needed).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/schedules/runner");
    startScheduler();
  }
}
