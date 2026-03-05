#!/usr/bin/env node

/**
 * OpenAPI-to-MCP Tool Generator
 *
 * Parses the Okta Management OpenAPI spec and generates a JSON manifest
 * of MCP tool definitions that the server loads at startup.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from 'yaml';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SERVER_GROUPS } from '../src/server-groups.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPEC_PATH = join(ROOT, 'okta-management-openapi.yaml');

// ── helpers ──────────────────────────────────────────────────────────

function resolveRef(spec, ref) {
    // e.g. '#/components/parameters/pathPoolId'
    const parts = ref.replace(/^#\//, '').split('/');
    let node = spec;
    for (const p of parts) {
        node = node?.[p];
        if (!node) return undefined;
    }
    return node;
}

/** Map OpenAPI schema type → JSON Schema type acceptable by zod / MCP */
function schemaTypeFor(schema) {
    if (!schema) return 'string';
    if (schema.type === 'integer') return 'number';
    return schema.type || 'string';
}

/** Build a single param descriptor */
function buildParam(raw, spec) {
    if (raw.$ref) {
        raw = resolveRef(spec, raw.$ref);
        if (!raw) return null;
    }
    return {
        name: raw.name,
        in: raw.in,   // path | query | header
        required: !!raw.required,
        type: schemaTypeFor(raw.schema),
        description: raw.description || '',
        enum: raw.schema?.enum || undefined,
    };
}

/** Truncate a description to keep tool manifests from being enormous */
function truncate(str, max = 300) {
    if (!str) return '';
    str = str.replace(/\s+/g, ' ').trim();
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ── main ─────────────────────────────────────────────────────────────

console.log('Reading spec …');
const raw = readFileSync(SPEC_PATH, 'utf-8');
console.log('Parsing YAML (this may take a moment) …');
const spec = parse(raw, { uniqueKeys: false });

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const tools = [];
const seenIds = new Set();

for (const [pathTemplate, pathItem] of Object.entries(spec.paths)) {
    // Path-level parameters (shared by all methods under this path)
    const sharedParams = (pathItem.parameters || []).map(p => buildParam(p, spec)).filter(Boolean);

    for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (!op || !op.operationId) continue;

        const operationId = op.operationId;
        // Deduplicate (shouldn't happen, but just in case)
        if (seenIds.has(operationId)) continue;
        seenIds.add(operationId);

        // Merge path-level + operation-level parameters
        const opParams = (op.parameters || []).map(p => buildParam(p, spec)).filter(Boolean);
        const allParams = [...sharedParams, ...opParams];

        // Deduplicate by name (operation-level wins)
        const paramMap = new Map();
        for (const param of allParams) {
            paramMap.set(param.name, param);
        }
        const params = [...paramMap.values()];

        // Separate by location
        const pathParams = params.filter(p => p.in === 'path');
        const queryParams = params.filter(p => p.in === 'query');

        // Build JSON Schema-style inputSchema properties
        const properties = {};
        const required = [];

        for (const p of pathParams) {
            properties[p.name] = {
                type: p.type,
                description: truncate(p.description),
            };
            if (p.enum) properties[p.name].enum = p.enum;
            required.push(p.name); // path params are always required
        }
        for (const p of queryParams) {
            properties[p.name] = {
                type: p.type,
                description: truncate(p.description),
            };
            if (p.enum) properties[p.name].enum = p.enum;
            if (p.required) required.push(p.name);
        }

        // If there's a requestBody, add a generic `requestBody` property
        const hasBody = !!op.requestBody;
        if (hasBody) {
            properties.requestBody = {
                type: 'object',
                description: 'The JSON request body. Refer to the Okta API docs for the schema.',
            };
            // Mark required if the spec says so
            if (op.requestBody.required) {
                required.push('requestBody');
            }
        }

        const description = truncate(
            (op.summary || '') + (op.description ? '. ' + op.description : ''),
            500,
        );

        const tags = op.tags || [];

        tools.push({
            name: operationId,
            description,
            tags,
            method: method.toUpperCase(),
            pathTemplate,
            pathParams: pathParams.map(p => p.name),
            queryParams: queryParams.map(p => p.name),
            hasBody,
            inputSchema: {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
            },
        });
    }
}

console.log(`\nParsed ${tools.length} tool definitions from spec.`);

// ── Split by server group ────────────────────────────────────────────

const serversDir = join(ROOT, 'src', 'servers');
mkdirSync(serversDir, { recursive: true });

// Build a reverse map: tag → server name
const tagToServer = {};
for (const [serverName, tags] of Object.entries(SERVER_GROUPS)) {
    for (const tag of tags) {
        tagToServer[tag] = serverName;
    }
}

// Bucket tools by server
const buckets = {};
for (const name of Object.keys(SERVER_GROUPS)) {
    buckets[name] = [];
}

for (const tool of tools) {
    let placed = false;
    for (const tag of tool.tags) {
        const server = tagToServer[tag];
        if (server) {
            buckets[server].push(tool);
            placed = true;
            break; // each tool goes into exactly one server
        }
    }
    if (!placed) {
        console.warn(`⚠️  Tool "${tool.name}" has no matching server (tags: ${tool.tags.join(', ')})`);
    }
}

// Write per-server manifests
let totalSplit = 0;
for (const [serverName, serverTools] of Object.entries(buckets)) {
    const outFile = join(serversDir, `${serverName}.json`);
    writeFileSync(outFile, JSON.stringify(serverTools, null, 2));
    console.log(`   ${serverName}: ${serverTools.length} tools`);
    totalSplit += serverTools.length;
}
console.log(`\n✅ Split into ${Object.keys(buckets).length} servers (${totalSplit} tools total)`);
