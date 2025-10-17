import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const CUSTOM_PREFIX = process.env.CUSTOM_PREFIX || '';
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || '8080', 10);

// Basic timestamped logging
function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

// Build "CUSTOM_PREFIX/<absolute-url>" while avoiding double slashes
function buildPrefixed(url) {
  if (!CUSTOM_PREFIX) return url;
  const sep = CUSTOM_PREFIX.endsWith('/') ? '' : '/';
  return `${CUSTOM_PREFIX}${sep}${url}`;
}

const app = express();
app.use(express.json());

// CORS allowing any origin; expose Mcp-Session-Id header for browser clients
app.use(
  cors({
    origin: '*',
    credentials: false,
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'mcp-session-id']
  })
);

// In-memory transport map per session
const transports = new Map();

// Helper: read session id from header or from query (?session=...)
// This improves compatibility with clients that cannot attach custom headers.
function getSessionId(req) {
  const h = req.headers['mcp-session-id'];
  const fromHeader = Array.isArray(h) ? h[0] : h;
  const fromQuery = typeof req.query?.session === 'string' ? req.query.session : undefined;
  return fromHeader || fromQuery || null;
}

// Create MCP server and register tools
function createMcpServer() {
  const server = new McpServer({ name: 'mcp-web-url-reader', version: '0.1.0' });

  server.registerTool(
    'read_web_url',
    {
      title: 'Web URL Reader',
      description:
        'Fetch an absolute HTTP/HTTPS URL using curl -sL after prepending a server-side CUSTOM_PREFIX.',
      inputSchema: {
        url: z.string().url().describe('Absolute URL starting with http:// or https://')
      }
    },
    async ({ url }) => {
      const prefixed = buildPrefixed(url);

      // Log the request info
      log(`[tool:read_web_url] request`, { originalUrl: url, prefixedUrl: prefixed });

      // Use a sentinel marker so we can capture HTTP status without logging/returning the body
      const STATUS_MARKER = '<<<MCP_HTTP_STATUS:';
      const STATUS_END = '>>>';

      try {
        const { stdout } = await execFileAsync(
          'curl',
          [
            '-sL',
            '--fail',
            // Follow redirects and fetch content
            prefixed,
            // Append final HTTP status code to stdout after the body
            '-w',
            `\n${STATUS_MARKER}%{http_code}${STATUS_END}`
          ],
          {
            maxBuffer: 25 * 1024 * 1024 // 25 MiB cap
          }
        );

        // Split body and status using the marker
        let body = stdout;
        let httpCode = '000';
        const idx = stdout.lastIndexOf(STATUS_MARKER);
        if (idx !== -1) {
          body = stdout.slice(0, idx);
          const tail = stdout.slice(idx + STATUS_MARKER.length);
          const endIdx = tail.indexOf(STATUS_END);
          if (endIdx !== -1) {
            httpCode = tail.slice(0, endIdx).trim();
          }
        }

        // Log summary without printing the response body
        log(`[tool:read_web_url] response received`, {
          prefixedUrl: prefixed,
          httpCode,
          bytes: body.length
        });

        return { content: [{ type: 'text', text: body }] };
      } catch (err) {
        // Log error details but not the response body
        const msg =
          err && typeof err === 'object' && 'stderr' in err && err.stderr
            ? String(err.stderr)
            : String(err?.message || err);
        log(`[tool:read_web_url] error`, { prefixedUrl: prefixed, error: msg });
        return {
          content: [{ type: 'text', text: `curl error for ${prefixed}: ${msg}` }],
          isError: true
        };
      }
    }
  );

  return server;
}

// POST: JSON-RPC over Streamable HTTP
app.post('/mcp', async (req, res) => {
  const body = req.body || {};
  const method = body?.method;
  let sessionId = getSessionId(req);
  let transport = sessionId ? transports.get(sessionId) : undefined;

  const isInit = method === 'initialize';
  log(`[mcp] POST`, { method, sessionId: sessionId || null, isInit });

  // Create a new session if:
  // - The request is initialize, or
  // - No session was provided (compat mode for clients that don't initialize explicitly)
  if (!transport && (isInit || !sessionId)) {
    log(`[mcp] creating new session`);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
      // Optionally: allowedOrigins / allowedHosts for hardened deployments
    });

    const server = createMcpServer();
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
      server.close();
      log(`[mcp] session closed`, { sessionId: transport.sessionId || null });
    };

    await server.connect(transport);
    transports.set(transport.sessionId, transport);
    sessionId = transport.sessionId;
    res.setHeader('Mcp-Session-Id', sessionId);
    log(`[mcp] session created`, { sessionId });
  }

  if (!transport) {
    log(`[mcp] missing/invalid session`, { method, sessionId: sessionId || null });
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: body?.id ?? null
    });
  }

  // Always expose session ID for clients to persist it
  res.setHeader('Mcp-Session-Id', sessionId);

  // Hand off to the transport
  await transport.handleRequest(req, res, body);
});

// GET: SSE stream for notifications (requires a valid session)
app.get('/mcp', async (req, res) => {
  const sessionId = getSessionId(req);
  log(`[mcp] GET (SSE)`, { sessionId: sessionId || null });
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    log(`[mcp] GET invalid/missing session`, { sessionId: sessionId || null });
    return res.status(400).send('Invalid or missing session ID');
  }
  await transport.handleRequest(req, res);
});

// DELETE: close a session
app.delete('/mcp', async (req, res) => {
  const sessionId = getSessionId(req);
  log(`[mcp] DELETE`, { sessionId: sessionId || null });
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    log(`[mcp] DELETE invalid/missing session`, { sessionId: sessionId || null });
    return res.status(400).send('Invalid or missing session ID');
  }
  transports.delete(sessionId);
  transport.close();
  log(`[mcp] session deleted`, { sessionId });
  res.status(204).end();
});

// Simple health endpoint
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'mcp-web-url-reader',
    prefixConfigured: Boolean(CUSTOM_PREFIX),
    port: INTERNAL_PORT
  });
});

app.listen(INTERNAL_PORT, () => {
  log(`MCP Streamable HTTP server listening on ${INTERNAL_PORT}`);
});