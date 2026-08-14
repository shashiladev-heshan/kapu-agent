import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  // OpenTelemetry must not be bundled — the Langfuse span processor and the
  // tracer provider have to be one shared instance across the server.
  serverExternalPackages: [
    "ffmpeg-static",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@langfuse/client",
    "@langfuse/core",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/api",
  ],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
