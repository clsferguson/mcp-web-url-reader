import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const CUSTOM_PREFIX = process.env.CUSTOM_PREFIX || '';
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || '8080', 10);

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

// Build "CUSTOM_PREFIX/<absolute-url>" while avoiding double slashes
function buildPrefixed(url) {
  if (!CUSTOM_PREFIX) return url;
  const sep = CUSTOM_PREFIX.endsWith('/') ? '' : '/';
  return `${CUSTOM_PREFIX}${sep}${url}`;
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
      try {
        const { stdout } = await execFileAsync(
          'curl',
          ['-sL', '--fail', prefixed],
          { maxBuffer: 25 * 1024 * 1024 } // 25 MiB cap
        );
        return { content: [{ type: 'text', text: stdout }] };
      } catch (err) {
        const msg =
          err && typeof err === 'object' && 'stderr' in err && err.stderr
            ? String(err.stderr)
            : String(err?.message || err);
        return {
          content: [{ type: 'text', text: `curl error for ${prefixed}: ${msg}` }],
          isError: true
        };
      }
    }
  );

  return server;
}

// Streamable HTTP with session management
app.post('/mcp', async (req, res) => {
  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res
        .status(400)
        .json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null
        });
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
      // For local deployments consider DNS rebinding protections and allowedHosts/origins if needed
    });

    const server = createMcpServer();

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
      server.close();
    };

    await server.connect(transport);
    transports.set(transport.sessionId, transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  transports.delete(sessionId);
  transport.close();
  res.status(204).end();
});

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'mcp-web-url-reader',
    prefixConfigured: Boolean(CUSTOM_PREFIX),
    port: INTERNAL_PORT
  });
});

app.listen(INTERNAL_PORT, () => {
  console.log(`MCP Streamable HTTP server listening on ${INTERNAL_PORT}`);
});