# mcp-web-url-reader

An MCP server that exposes a single tool, `read_web_url`, which fetches absolute URLs with `curl -sL` after prepending a configurable `CUSTOM_PREFIX` on the server side. This server uses the MCP TypeScript/JavaScript SDK and serves a Streamable HTTP endpoint at `/mcp` for compatibility across many AI applications.

## Features

- Streamable HTTP transport with session management on `/mcp` (POST for JSON-RPC requests, GET for SSE notifications, DELETE to end sessions).
- CORS enabled with `Mcp-Session-Id` exposed for browser-based clients, as recommended.
- Tool: `read_web_url` with input `{ url: string }`, which runs `curl -sL CUSTOM_PREFIX/<url>` and returns the response text.
- Tiny Docker image based on `node:20-alpine` with `curl` installed via `apk add --no-cache curl`.

## Environment Variables

- `INTERNAL_PORT` (default: `8080`): Port the HTTP server listens on inside the container. [web:1]
- `CUSTOM_PREFIX` (required for prefixing): The string to prepend before the requested absolute URL, e.g., `https://your-proxy/forward`.

### Run

- Open `http://localhost:8080/` for a basic health probe and connect your MCP client to `http://localhost:8080/mcp`.
- The MCP endpoint is on `http://localhost:8080/mcp` with Streamable HTTP semantics for POST/GET/DELETE and CORS exposure for `Mcp-Session-Id`.

## Docker Compose

See `docker-compose.yml` for a working example service mapping `8080:8080` and injecting both environment variables.

## MCP Client Integration

The server exposes tools over Streamable HTTP: initialize a session with a POST to `/mcp`, reuse `Mcp-Session-Id` from the response, then call `tools/call` with `{ name: "read_web_url", arguments: { url: "https://example.com" } }`. The server will run `curl -sL CUSTOM_PREFIX/https://example.com` and return text content. Ensure the `Mcp-Session-Id` header is included in subsequent requests and allowed via CORS.