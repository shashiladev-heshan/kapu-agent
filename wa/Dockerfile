# kapu-wa — WhatsApp transport sidecar.
# Deterministic multi-stage build; Railway's Go autodetect works too, but this
# pins the toolchain so a Railway image bump can't silently change behaviour.

FROM golang:1.25-alpine AS build
WORKDIR /src
# Cache deps separately from source so code edits don't re-download the module graph.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kapu-wa .

FROM alpine:3.20
# TLS roots are needed for WhatsApp, the Kapu webhook and image fetches.
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 kapu
USER kapu
COPY --from=build /out/kapu-wa /usr/local/bin/kapu-wa
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kapu-wa"]
