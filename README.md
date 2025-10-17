# MCP Web URL Reader
An MCP server that exposes a single tool, `read_web_url`, which fetches absolute URLs with `curl -sL` after prepending a configurable `CUSTOM_PREFIX` on the server side. This server uses the MCP TypeScript/JavaScript SDK and serves a Streamable HTTP endpoint at `/mcp` for compatibility across many AI applications. Perfect for routing AI web requests through proxies, caching layers, or custom gateways.

## Features

- 🌐 Simple web URL reading via curl
- 🔧 Configurable URL prefix for proxying/routing
- 🐳 Tiny Docker image based on Node.js
- 🚀 Easy deployment with Docker Compose
- 🛠️ Compatible with any MCP-enabled AI application

## How It Works

The AI thinks it's reading a normal URL:
```
curl -sL https://www.example.com
```

But the server actually executes:
```
curl -sL CUSTOM_PREFIX/https://www.example.com
```

This allows you to:
- Route requests through a caching proxy
- Add authentication layers
- Use custom gateways
- Bypass rate limits with your own infrastructure
- Monitor/log AI web access

## Quick Start

### Using Docker Compose

See `docker-compose.yml` for a working example service mapping `8080:8080` and injecting both environment variables.

The MCP server will be available at `http://localhost:8080`

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CUSTOM_PREFIX` | URL prefix to prepend to all requests | `""` (empty) |
| `INTERNAL_PORT` | Internal server port | `80800` |

### Configuration Examples

#### Direct Mode (No Prefix)
```yaml
environment:
  - CUSTOM_PREFIX=
  - PORT=3000
```

#### Proxy Mode
```yaml
environment:
  - CUSTOM_PREFIX=https://proxy.myserver.com
  - INTERNAL_PORT=8080
```

#### Cache Gateway
```yaml
environment:
  - CUSTOM_PREFIX=http://cache-server:8000/fetch
  - INTERNAL_PORT=8080
```

## Using with AI Applications, MCP Client Integration

The server exposes tools over Streamable HTTP: initialize a session with a POST to `/mcp`, reuse `Mcp-Session-Id` from the response, then call `tools/call` with `{ name: "read_web_url", arguments: { url: "https://example.com" } }`. The server will run `curl -sL CUSTOM_PREFIX/https://example.com` and return text content. Ensure the `Mcp-Session-Id` header is included in subsequent requests and allowed via CORS.

### Claude Desktop (MCP)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "web-url-reader": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

### n8n

Use the MCP Server node and point it to `http://localhost:8080/mcp`

### Custom Applications

Connect to the MCP endpoint at `http://localhost:8080/mcp`

## Tool Schema

The server exposes one tool:

**`read_web_url`**
- Description: Read and return the contents of a web page
- Parameter: `url` (string, required) - The complete URL to fetch
- Returns: Text content of the web page

Example tool call:
```json
{
  "name": "read_web_url",
  "arguments": {
    "url": "https://www.example.com"
  }
}
```

## Use Cases

### Caching Layer
Route all AI web requests through your caching server to reduce external calls:
```
CUSTOM_PREFIX=http://cache-server/proxy
```

### Authentication Gateway
Add authentication to web requests:
```
CUSTOM_PREFIX=http://auth-gateway/fetch
```

### Rate Limit Management
Route through your own infrastructure to manage rate limits:
```
CUSTOM_PREFIX=https://ratelimit-proxy.myserver.com
```

### Privacy/Monitoring
Log and monitor all AI web access:
```
CUSTOM_PREFIX=http://monitoring-gateway/fetch
```

## Run
- Open `http://localhost:8080/` for a basic health probe and connect your MCP client to `http://localhost:8080/mcp`.
- The MCP endpoint is on `http://localhost:8080/mcp` with Streamable HTTP semantics for POST/GET/DELETE and CORS exposure for `Mcp-Session-Id`.

## Troubleshooting

### Server won't start
- Check that port 8080 is not in use
- Verify environment variables are set correctly
- Check Docker logs: `docker-compose logs -f`

### Requests failing
- Verify CUSTOM_PREFIX is accessible from container
- Test curl manually: `docker exec -it mcp-web-reader curl -sL YOUR_URL`
- Check timeout settings (default 30s)

### GitHub Actions not building
- Ensure workflow permissions are enabled
- Check that GITHUB_TOKEN has package write access
- Verify Dockerfile syntax

## License

MIT License - Feel free to use and modify as needed.

## Contributing

Pull requests welcome! Please ensure:
- Docker image builds successfully
- README is updated for new features
- GitHub Actions workflow passes
