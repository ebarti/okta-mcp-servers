import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock okta-auth before importing okta-client ──────────────
vi.mock('../src/okta-auth.js', () => ({
    getAuthHeader: vi.fn().mockResolvedValue('SSWS mock-token'),
}));

import { callOktaApi } from '../src/okta-client.js';
import { getAuthHeader } from '../src/okta-auth.js';

// ── Tests ────────────────────────────────────────────────────

describe('okta-client — callOktaApi()', () => {
    let savedEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        process.env.OKTA_ORG_URL = 'https://test.okta.com';
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        process.env = savedEnv;
        vi.restoreAllMocks();
    });

    /** Helper to set up a mock fetch response */
    function setupFetchResponse(data, status = 200, contentType = 'application/json') {
        fetch.mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers({ 'content-type': contentType }),
            json: async () => data,
            text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
        });
    }

    // ── URL construction ─────────────────────────────────────

    it('constructs URL with path parameters', async () => {
        setupFetchResponse({ id: '00u123' });

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users/{userId}',
            pathParams: { userId: '00u123' },
        });

        const [url] = fetch.mock.calls[0];
        expect(url).toBe('https://test.okta.com/api/v1/users/00u123');
    });

    it('URL-encodes path parameters', async () => {
        setupFetchResponse({});

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users/{userId}',
            pathParams: { userId: 'user with spaces' },
        });

        const [url] = fetch.mock.calls[0];
        expect(url).toContain('user%20with%20spaces');
    });

    it('constructs URL with query parameters', async () => {
        setupFetchResponse([]);

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users',
            queryParams: { limit: 10, search: 'john' },
        });

        const [url] = fetch.mock.calls[0];
        expect(url).toContain('limit=10');
        expect(url).toContain('search=john');
    });

    it('skips null, undefined, and empty query params', async () => {
        setupFetchResponse([]);

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users',
            queryParams: { limit: 10, filter: null, search: undefined, q: '' },
        });

        const [url] = fetch.mock.calls[0];
        expect(url).toContain('limit=10');
        expect(url).not.toContain('filter');
        expect(url).not.toContain('search');
        expect(url).not.toContain('q=');
    });

    it('strips trailing slash from OKTA_ORG_URL', async () => {
        process.env.OKTA_ORG_URL = 'https://test.okta.com///';
        setupFetchResponse({});

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users',
        });

        const [url] = fetch.mock.calls[0];
        expect(url).toBe('https://test.okta.com/api/v1/users');
    });

    // ── Auth header ──────────────────────────────────────────

    it('uses getAuthHeader() for authorization', async () => {
        getAuthHeader.mockResolvedValue('Bearer oauth-token');
        setupFetchResponse({});

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users',
        });

        const [, opts] = fetch.mock.calls[0];
        expect(opts.headers.Authorization).toBe('Bearer oauth-token');
        expect(getAuthHeader).toHaveBeenCalled();
    });

    // ── Request body ─────────────────────────────────────────

    it('sends JSON body for POST requests', async () => {
        setupFetchResponse({ id: '00u456' }, 200);

        await callOktaApi({
            method: 'POST',
            pathTemplate: '/api/v1/users',
            body: { profile: { firstName: 'Jane' } },
        });

        const [, opts] = fetch.mock.calls[0];
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(opts.body)).toEqual({ profile: { firstName: 'Jane' } });
    });

    it('does not send body for GET even if body is provided', async () => {
        setupFetchResponse([]);

        await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users',
            body: { ignored: true },
        });

        const [, opts] = fetch.mock.calls[0];
        expect(opts.body).toBeUndefined();
    });

    // ── Response handling ────────────────────────────────────

    it('returns { status, data } for successful JSON response', async () => {
        setupFetchResponse({ id: '00u789', status: 'ACTIVE' }, 200);

        const result = await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users/{userId}',
            pathParams: { userId: '00u789' },
        });

        expect(result).toEqual({ status: 200, data: { id: '00u789', status: 'ACTIVE' } });
    });

    it('returns { status, error } for error responses', async () => {
        setupFetchResponse({ errorCode: 'E0000007', errorSummary: 'Not found' }, 404);

        const result = await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/users/{userId}',
            pathParams: { userId: 'nonexistent' },
        });

        expect(result.status).toBe(404);
        expect(result.error).toEqual({ errorCode: 'E0000007', errorSummary: 'Not found' });
    });

    it('falls back to text for non-JSON responses', async () => {
        fetch.mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => 'plain text response',
        });

        const result = await callOktaApi({
            method: 'GET',
            pathTemplate: '/api/v1/something',
        });

        expect(result.data).toBe('plain text response');
    });

    // ── Env var validation ───────────────────────────────────

    it('throws when OKTA_ORG_URL is not set', async () => {
        delete process.env.OKTA_ORG_URL;

        await expect(
            callOktaApi({ method: 'GET', pathTemplate: '/api/v1/users' })
        ).rejects.toThrow('OKTA_ORG_URL');
    });
});
