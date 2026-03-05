import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';

// ── Helpers ──────────────────────────────────────────────────

/** Save and restore env vars around each test */
const ENV_KEYS = [
    'OKTA_ORG_URL', 'OKTA_API_TOKEN', 'OKTA_CLIENT_ID',
    'OKTA_PRIVATE_KEY', 'OKTA_PRIVATE_KEY_FILE', 'OKTA_PRIVATE_KEY_KID',
    'OKTA_SCOPES', 'OKTA_AUTH_SERVER_ID',
];

function clearAuthEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

/** Generate a throwaway RSA key pair for tests */
function generateTestKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { privateKey, publicKey };
}

/** Create a mock fetch that returns a token response */
function mockFetchToken(accessToken = 'mock-access-token', expiresIn = 3600) {
    return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
        headers: new Headers({ 'content-type': 'application/json' }),
    });
}

// ── Tests ────────────────────────────────────────────────────

describe('okta-auth', () => {
    let savedEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        clearAuthEnv();
        // Reset module cache so each test gets a fresh cachedToken
        vi.resetModules();
    });

    afterEach(() => {
        process.env = savedEnv;
        vi.restoreAllMocks();
    });

    // ── detectAuthMode ───────────────────────────────────────

    describe('detectAuthMode()', () => {
        it('returns private_key_jwt when CLIENT_ID + PRIVATE_KEY are set', async () => {
            process.env.OKTA_CLIENT_ID = 'test-client';
            process.env.OKTA_PRIVATE_KEY = 'fake-key';
            const { detectAuthMode } = await import('../src/okta-auth.js');
            expect(detectAuthMode()).toBe('private_key_jwt');
        });

        it('returns private_key_jwt when CLIENT_ID + PRIVATE_KEY_FILE are set', async () => {
            process.env.OKTA_CLIENT_ID = 'test-client';
            process.env.OKTA_PRIVATE_KEY_FILE = '/tmp/key.pem';
            const { detectAuthMode } = await import('../src/okta-auth.js');
            expect(detectAuthMode()).toBe('private_key_jwt');
        });

        it('returns device_auth when only CLIENT_ID is set', async () => {
            process.env.OKTA_CLIENT_ID = 'test-client';
            const { detectAuthMode } = await import('../src/okta-auth.js');
            expect(detectAuthMode()).toBe('device_auth');
        });

        it('returns ssws when only API_TOKEN is set', async () => {
            process.env.OKTA_API_TOKEN = 'test-token';
            const { detectAuthMode } = await import('../src/okta-auth.js');
            expect(detectAuthMode()).toBe('ssws');
        });

        it('prefers private_key_jwt over ssws when both are set', async () => {
            process.env.OKTA_CLIENT_ID = 'test-client';
            process.env.OKTA_PRIVATE_KEY = 'fake-key';
            process.env.OKTA_API_TOKEN = 'test-token';
            const { detectAuthMode } = await import('../src/okta-auth.js');
            expect(detectAuthMode()).toBe('private_key_jwt');
        });

        it('throws when no auth vars are set', async () => {
            const { detectAuthMode } = await import('../src/okta-auth.js');
            expect(() => detectAuthMode()).toThrow('No authentication configured');
        });
    });

    // ── getAuthHeader (SSWS) ─────────────────────────────────

    describe('getAuthHeader() — SSWS mode', () => {
        it('returns SSWS header', async () => {
            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_API_TOKEN = 'my-ssws-token';
            const { getAuthHeader } = await import('../src/okta-auth.js');
            const header = await getAuthHeader();
            expect(header).toBe('SSWS my-ssws-token');
        });

        it('throws when OKTA_ORG_URL is missing', async () => {
            process.env.OKTA_API_TOKEN = 'my-ssws-token';
            const { getAuthHeader } = await import('../src/okta-auth.js');
            await expect(getAuthHeader()).rejects.toThrow('OKTA_ORG_URL');
        });
    });

    // ── getAuthHeader (Private Key JWT) ──────────────────────

    describe('getAuthHeader() — Private Key JWT mode', () => {
        it('fetches token via client_credentials grant and returns Bearer header', async () => {
            const { privateKey } = generateTestKeyPair();

            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_CLIENT_ID = 'test-client-id';
            process.env.OKTA_PRIVATE_KEY = privateKey;

            const mockFetch = mockFetchToken('pkjwt-access-token');
            vi.stubGlobal('fetch', mockFetch);

            const { getAuthHeader } = await import('../src/okta-auth.js');
            const header = await getAuthHeader();

            expect(header).toBe('Bearer pkjwt-access-token');

            // Verify the fetch was called with correct params
            expect(mockFetch).toHaveBeenCalledOnce();
            const [url, opts] = mockFetch.mock.calls[0];
            expect(url).toBe('https://test.okta.com/oauth2/v1/token');
            expect(opts.method).toBe('POST');

            // Verify the body contains the right grant type + assertion
            const body = new URLSearchParams(opts.body);
            expect(body.get('grant_type')).toBe('client_credentials');
            expect(body.get('client_assertion_type')).toBe(
                'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
            );

            // Verify the client_assertion is a valid JWT
            const assertion = body.get('client_assertion');
            const decoded = jwt.decode(assertion, { complete: true });
            expect(decoded.header.alg).toBe('RS256');
            expect(decoded.payload.iss).toBe('test-client-id');
            expect(decoded.payload.sub).toBe('test-client-id');
            expect(decoded.payload.aud).toBe('https://test.okta.com/oauth2/v1/token');
        });

        it('uses custom auth server ID when OKTA_AUTH_SERVER_ID is set', async () => {
            const { privateKey } = generateTestKeyPair();

            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_CLIENT_ID = 'test-client-id';
            process.env.OKTA_PRIVATE_KEY = privateKey;
            process.env.OKTA_AUTH_SERVER_ID = 'custom-server';

            const mockFetch = mockFetchToken();
            vi.stubGlobal('fetch', mockFetch);

            const { getAuthHeader } = await import('../src/okta-auth.js');
            await getAuthHeader();

            const [url] = mockFetch.mock.calls[0];
            expect(url).toBe('https://test.okta.com/oauth2/custom-server/v1/token');
        });

        it('includes kid in JWT header when OKTA_PRIVATE_KEY_KID is set', async () => {
            const { privateKey } = generateTestKeyPair();

            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_CLIENT_ID = 'test-client-id';
            process.env.OKTA_PRIVATE_KEY = privateKey;
            process.env.OKTA_PRIVATE_KEY_KID = 'my-key-id';

            const mockFetch = mockFetchToken();
            vi.stubGlobal('fetch', mockFetch);

            const { getAuthHeader } = await import('../src/okta-auth.js');
            await getAuthHeader();

            const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
            const decoded = jwt.decode(body.get('client_assertion'), { complete: true });
            expect(decoded.header.kid).toBe('my-key-id');
        });

        it('uses custom scopes when OKTA_SCOPES is set', async () => {
            const { privateKey } = generateTestKeyPair();

            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_CLIENT_ID = 'test-client-id';
            process.env.OKTA_PRIVATE_KEY = privateKey;
            process.env.OKTA_SCOPES = 'okta.apps.manage okta.users.read';

            const mockFetch = mockFetchToken();
            vi.stubGlobal('fetch', mockFetch);

            const { getAuthHeader } = await import('../src/okta-auth.js');
            await getAuthHeader();

            const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
            expect(body.get('scope')).toBe('okta.apps.manage okta.users.read');
        });

        it('caches token and reuses on second call', async () => {
            const { privateKey } = generateTestKeyPair();

            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_CLIENT_ID = 'test-client-id';
            process.env.OKTA_PRIVATE_KEY = privateKey;

            const mockFetch = mockFetchToken('cached-token', 3600);
            vi.stubGlobal('fetch', mockFetch);

            const { getAuthHeader } = await import('../src/okta-auth.js');

            const header1 = await getAuthHeader();
            const header2 = await getAuthHeader();

            expect(header1).toBe('Bearer cached-token');
            expect(header2).toBe('Bearer cached-token');
            expect(mockFetch).toHaveBeenCalledOnce(); // only one fetch
        });

        it('throws on token endpoint error', async () => {
            const { privateKey } = generateTestKeyPair();

            process.env.OKTA_ORG_URL = 'https://test.okta.com';
            process.env.OKTA_CLIENT_ID = 'test-client-id';
            process.env.OKTA_PRIVATE_KEY = privateKey;

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                text: async () => '{"error":"invalid_client"}',
            }));

            const { getAuthHeader } = await import('../src/okta-auth.js');
            await expect(getAuthHeader()).rejects.toThrow('Private Key JWT token request failed');
        });
    });
});
