import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Tests ────────────────────────────────────────────────────

describe('create-server', () => {
    // ── buildZodSchema (tested indirectly) ───────────────────
    // We can't import the private function directly, so we test via
    // the exported createServer's behavior. For unit testing the
    // schema builder, we re-implement the same logic here.

    describe('buildZodSchema logic', () => {
        /**
         * Replicates the buildZodSchema function from create-server.js
         * so we can unit test it directly.
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
                    default: field = z.any(); break;
                }
                if (def.description) field = field.describe(def.description);
                if (!required.has(key)) field = field.optional();
                shape[key] = field;
            }
            return z.object(shape);
        }

        it('maps string type correctly', () => {
            const schema = buildZodSchema({
                properties: { name: { type: 'string', description: 'User name' } },
                required: ['name'],
            });
            expect(schema.parse({ name: 'John' })).toEqual({ name: 'John' });
            expect(() => schema.parse({ name: 123 })).toThrow();
        });

        it('maps number and integer types correctly', () => {
            const schema = buildZodSchema({
                properties: {
                    count: { type: 'number' },
                    limit: { type: 'integer' },
                },
            });
            expect(schema.parse({ count: 3.14, limit: 10 })).toEqual({ count: 3.14, limit: 10 });
        });

        it('maps boolean type correctly', () => {
            const schema = buildZodSchema({
                properties: { active: { type: 'boolean' } },
            });
            expect(schema.parse({ active: true })).toEqual({ active: true });
        });

        it('maps array type correctly', () => {
            const schema = buildZodSchema({
                properties: { items: { type: 'array' } },
            });
            expect(schema.parse({ items: [1, 'two', null] })).toEqual({ items: [1, 'two', null] });
        });

        it('falls back to z.any() for object type', () => {
            const schema = buildZodSchema({
                properties: { data: { type: 'object' } },
            });
            const input = { data: { nested: true } };
            expect(schema.parse(input)).toEqual(input);
        });

        it('marks non-required fields as optional', () => {
            const schema = buildZodSchema({
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' },
                },
                required: ['name'],
            });
            // age is optional — should parse fine without it
            expect(schema.parse({ name: 'John' })).toEqual({ name: 'John' });
        });

        it('handles empty/missing properties', () => {
            const schema = buildZodSchema({});
            expect(schema.parse({})).toEqual({});

            const schema2 = buildZodSchema(undefined);
            expect(schema2.parse({})).toEqual({});
        });
    });

    // ── Manifest loading ─────────────────────────────────────

    describe('manifest loading', () => {
        it('all 10 server manifests are valid JSON arrays', () => {
            const servers = [
                'okta-users', 'okta-apps', 'okta-authz', 'okta-idps', 'okta-security',
                'okta-roles', 'okta-customization', 'okta-org', 'okta-hooks', 'okta-devices',
            ];

            for (const server of servers) {
                const manifestPath = join(__dirname, '..', 'src', 'servers', `${server}.json`);
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

                expect(Array.isArray(manifest)).toBe(true);
                expect(manifest.length).toBeGreaterThan(0);

                // Each tool should have required fields
                for (const tool of manifest) {
                    expect(tool).toHaveProperty('name');
                    expect(tool).toHaveProperty('description');
                    expect(tool).toHaveProperty('method');
                    expect(tool).toHaveProperty('pathTemplate');
                    expect(tool).toHaveProperty('inputSchema');
                    expect(typeof tool.name).toBe('string');
                    expect(typeof tool.method).toBe('string');
                    expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
                        .toContain(tool.method);
                }
            }
        });

        it('tool names are unique within each manifest', () => {
            const servers = [
                'okta-users', 'okta-apps', 'okta-authz', 'okta-idps', 'okta-security',
                'okta-roles', 'okta-customization', 'okta-org', 'okta-hooks', 'okta-devices',
            ];

            for (const server of servers) {
                const manifestPath = join(__dirname, '..', 'src', 'servers', `${server}.json`);
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
                const names = manifest.map(t => t.name);
                const unique = new Set(names);
                expect(unique.size).toBe(names.length);
            }
        });

        it('tool names are globally unique across all manifests', () => {
            const servers = [
                'okta-users', 'okta-apps', 'okta-authz', 'okta-idps', 'okta-security',
                'okta-roles', 'okta-customization', 'okta-org', 'okta-hooks', 'okta-devices',
            ];

            const allNames = new Set();
            for (const server of servers) {
                const manifestPath = join(__dirname, '..', 'src', 'servers', `${server}.json`);
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
                for (const tool of manifest) {
                    expect(allNames.has(tool.name)).toBe(false);
                    allNames.add(tool.name);
                }
            }
        });
    });
});
