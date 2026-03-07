import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SERVER_GROUPS, SERVER_DESCRIPTIONS } from '../src/server-groups.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('server-groups', () => {
    const serverNames = Object.keys(SERVER_GROUPS);

    it('defines exactly 6 servers', () => {
        expect(serverNames).toHaveLength(6);
    });

    it('defines all expected server names', () => {
        const expected = [
            'okta-users', 'okta-apps', 'okta-idps', 'okta-security',
            'okta-roles', 'okta-devices',
        ];
        expect(serverNames.sort()).toEqual(expected.sort());
    });

    it('every server has at least one tag', () => {
        for (const [name, tags] of Object.entries(SERVER_GROUPS)) {
            expect(tags.length, `${name} should have tags`).toBeGreaterThan(0);
        }
    });

    it('no tags are duplicated across servers', () => {
        const allTags = [];
        for (const tags of Object.values(SERVER_GROUPS)) {
            allTags.push(...tags);
        }
        const unique = new Set(allTags);
        expect(unique.size).toBe(allTags.length);
    });

    it('every server has a description in SERVER_DESCRIPTIONS', () => {
        for (const name of serverNames) {
            expect(SERVER_DESCRIPTIONS[name], `${name} missing description`).toBeTruthy();
            expect(typeof SERVER_DESCRIPTIONS[name]).toBe('string');
        }
    });

    it('SERVER_DESCRIPTIONS has no extra keys', () => {
        const descKeys = Object.keys(SERVER_DESCRIPTIONS).sort();
        expect(descKeys).toEqual(serverNames.sort());
    });

    it('every server has a matching manifest file', () => {
        for (const name of serverNames) {
            const manifestPath = join(__dirname, '..', 'src', 'servers', `${name}.json`);
            expect(existsSync(manifestPath), `${manifestPath} should exist`).toBe(true);
        }
    });

    it('every server has a matching entry point', () => {
        for (const name of serverNames) {
            const entryPath = join(__dirname, '..', 'servers', `${name}.js`);
            expect(existsSync(entryPath), `${entryPath} should exist`).toBe(true);
        }
    });
});
