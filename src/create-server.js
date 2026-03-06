/**
 * Shared MCP Server Factory
 *
 * Creates an MCP server for a given server name by loading its
 * per-group JSON tool manifest and registering every tool.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { callOktaApi } from './okta-client.js';
import { SERVER_DESCRIPTIONS } from './server-groups.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build a Zod schema from a JSON Schema `properties` object.
 * Supports string, number, integer, boolean, array, and falls
 * back to z.any() for objects/unknown types.
 */
function buildZodSchema(inputSchema) {
    const shape = {};
    const props = inputSchema?.properties ?? {};
    const required = new Set(inputSchema?.required ?? []);

    for (const [key, def] of Object.entries(props)) {
        let field;
        switch (def.type) {
            case 'string': field = z.string(); break;
            case 'number':
            case 'integer': field = z.number(); break;
            case 'boolean': field = z.boolean(); break;
            case 'array': field = z.array(z.any()); break;
            default: field = z.any(); break;   // object / mixed
        }
        if (def.description) field = field.describe(def.description);
        if (!required.has(key)) field = field.optional();
        shape[key] = field;
    }
    return z.object(shape);
}

/**
 * Create and start an MCP server for the given server name.
 *
 * @param {string} serverName  e.g. "okta-users"
 */
export async function createServer(serverName) {
    // ── Load the per-group manifest ──────────────────────────
    const manifestPath = join(__dirname, 'servers', `${serverName}.json`);
    let tools;
    try {
        tools = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
        console.error(`Failed to load manifest for ${serverName}: ${err.message}`);
        console.error(`Run "npm run generate" first.`);
        process.exit(1);
    }

    // ── Create the MCP server ────────────────────────────────
    const description = SERVER_DESCRIPTIONS[serverName] ?? serverName;
    const server = new McpServer({
        name: serverName,
        version: '1.0.0',
        description: `Okta Management API — ${description}`,
    });

    // Force MCP protocol version to 2024-11-05 (pre-auth).
    // SDK v1.27.1 defaults to 2025-11-25 which includes MCP-level OAuth.
    // Gemini CLI sees 2025-11-25 and tries dynamic client registration,
    // which fails because our server handles auth internally via Okta.
    const origConnect = server.server.connect.bind(server.server);
    server.server.connect = async function(transport) {
        await origConnect(transport);
        const origSend = transport.send.bind(transport);
        transport.send = async function(message) {
            if (message.result && message.result.protocolVersion) {
                message.result.protocolVersion = '2024-11-05';
            }
            return origSend(message);
        };
    };

    // ── Register every tool ──────────────────────────────────
    for (const tool of tools) {
        const zodSchema = buildZodSchema(tool.inputSchema);

        server.tool(tool.name, tool.description, zodSchema.shape, async (params) => {
            try {
                const result = await callOktaApi(tool, params);
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true,
                };
            }
        });
    }

    // ── Connect transport ────────────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
