/**
 * Okta OAuth2 Authentication Manager
 *
 * Supports three authentication modes (auto-detected from env vars):
 *
 *   1. Private Key JWT  — OKTA_CLIENT_ID + OKTA_PRIVATE_KEY / OKTA_PRIVATE_KEY_FILE
 *      Uses client_credentials grant with a signed JWT assertion.
 *      Best for automated, server-to-server communication.
 *
 *   2. Device Authorization Grant — OKTA_CLIENT_ID (no private key)
 *      Interactive flow: prints a code + URL for the user to authorize.
 *      Best for CLI / interactive use.
 *
 *   3. SSWS (legacy) — OKTA_API_TOKEN
 *      Static API token, no OAuth. Kept for backward compatibility.
 *
 * Environment variables:
 *   OKTA_ORG_URL            (required)  Okta org URL
 *   OKTA_API_TOKEN          (ssws)      SSWS API token
 *   OKTA_CLIENT_ID          (oauth)     OAuth app client ID
 *   OKTA_PRIVATE_KEY        (pkjwt)     PEM private key (inline)
 *   OKTA_PRIVATE_KEY_FILE   (pkjwt)     Path to PEM private key file
 *   OKTA_PRIVATE_KEY_KID    (pkjwt)     Key ID for JWT header (optional)
 *   OKTA_SCOPES             (oauth)     Space-separated scopes (optional)
 *   OKTA_AUTH_SERVER_ID     (oauth)     Custom auth server ID (optional)
 */

import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

// ── Token cache ──────────────────────────────────────────────
let cachedToken = null;   // { accessToken, expiresAt }

const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry

// ── Auth mode detection ──────────────────────────────────────

/**
 * Detect which authentication mode to use based on environment variables.
 * @returns {'private_key_jwt' | 'device_auth' | 'ssws'}
 */
export function detectAuthMode() {
    const hasClientId = !!process.env.OKTA_CLIENT_ID;
    const hasPrivateKey = !!(process.env.OKTA_PRIVATE_KEY || process.env.OKTA_PRIVATE_KEY_FILE);
    const hasApiToken = !!process.env.OKTA_API_TOKEN;

    if (hasClientId && hasPrivateKey) return 'private_key_jwt';
    if (hasClientId) return 'device_auth';
    if (hasApiToken) return 'ssws';

    throw new Error(
        'No authentication configured. Set one of:\n' +
        '  • OKTA_CLIENT_ID + OKTA_PRIVATE_KEY (or OKTA_PRIVATE_KEY_FILE) — for Private Key JWT\n' +
        '  • OKTA_CLIENT_ID — for Device Authorization Grant\n' +
        '  • OKTA_API_TOKEN — for SSWS API token'
    );
}

// ── Helper: build token endpoint URL ─────────────────────────

function getTokenEndpoint(orgUrl) {
    const authServerId = process.env.OKTA_AUTH_SERVER_ID;
    if (authServerId) {
        return `${orgUrl}/oauth2/${authServerId}/v1/token`;
    }
    return `${orgUrl}/oauth2/v1/token`;
}

function getDeviceAuthorizeEndpoint(orgUrl) {
    const authServerId = process.env.OKTA_AUTH_SERVER_ID;
    if (authServerId) {
        return `${orgUrl}/oauth2/${authServerId}/v1/device/authorize`;
    }
    return `${orgUrl}/oauth2/v1/device/authorize`;
}

function getScopes() {
    return process.env.OKTA_SCOPES || 'okta.users.manage';
}

// ── Private Key JWT flow ─────────────────────────────────────

function loadPrivateKey() {
    if (process.env.OKTA_PRIVATE_KEY) {
        return process.env.OKTA_PRIVATE_KEY;
    }
    if (process.env.OKTA_PRIVATE_KEY_FILE) {
        return readFileSync(process.env.OKTA_PRIVATE_KEY_FILE, 'utf-8');
    }
    throw new Error('Private key not found. Set OKTA_PRIVATE_KEY or OKTA_PRIVATE_KEY_FILE.');
}

/**
 * Obtain an access token via the client_credentials grant
 * using a Private Key JWT assertion (RFC 7523).
 */
async function getTokenViaPrivateKeyJwt(orgUrl) {
    const clientId = process.env.OKTA_CLIENT_ID;
    const privateKey = loadPrivateKey();
    const tokenEndpoint = getTokenEndpoint(orgUrl);

    // Build the JWT assertion
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: clientId,
        sub: clientId,
        aud: tokenEndpoint,
        iat: now,
        exp: now + 300,       // 5 min lifetime
        jti: randomUUID(),
    };

    const header = { algorithm: 'RS256' };
    if (process.env.OKTA_PRIVATE_KEY_KID) {
        header.keyid = process.env.OKTA_PRIVATE_KEY_KID;
    }

    const assertion = jwt.sign(payload, privateKey, header);

    // Exchange for access token
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: getScopes(),
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
    });

    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: body.toString(),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Private Key JWT token request failed (${response.status}): ${err}`);
    }

    const data = await response.json();
    return {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
    };
}

// ── Device Authorization Grant flow ──────────────────────────

/**
 * Obtain an access token via the Device Authorization Grant (RFC 8628).
 * Prints the verification URL and user code to stderr for the user.
 */
async function getTokenViaDeviceAuth(orgUrl) {
    const clientId = process.env.OKTA_CLIENT_ID;
    const deviceAuthorizeUrl = getDeviceAuthorizeEndpoint(orgUrl);
    const tokenEndpoint = getTokenEndpoint(orgUrl);
    const scopes = getScopes();

    // Step 1: Request device code
    const deviceBody = new URLSearchParams({
        client_id: clientId,
        scope: scopes,
    });

    const deviceResponse = await fetch(deviceAuthorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: deviceBody.toString(),
    });

    if (!deviceResponse.ok) {
        const err = await deviceResponse.text();
        throw new Error(`Device authorization request failed (${deviceResponse.status}): ${err}`);
    }

    const deviceData = await deviceResponse.json();
    const {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: verificationUriComplete,
        interval = 5,
        expires_in: expiresIn = 600,
    } = deviceData;

    // Print instructions to stderr (stdout is reserved for MCP JSON-RPC)
    const displayUri = verificationUriComplete || verificationUri;
    process.stderr.write('\n');
    process.stderr.write('┌─────────────────────────────────────────────────────────┐\n');
    process.stderr.write('│              Okta Device Authorization                  │\n');
    process.stderr.write('├─────────────────────────────────────────────────────────┤\n');
    process.stderr.write(`│  1. Open: ${displayUri}\n`);
    process.stderr.write(`│  2. Enter code: ${userCode}\n`);
    process.stderr.write('└─────────────────────────────────────────────────────────┘\n');
    process.stderr.write('\n');
    process.stderr.write('Waiting for authorization...\n');

    // Step 2: Poll for token
    const deadline = Date.now() + (expiresIn * 1000);
    let pollInterval = interval * 1000;

    while (Date.now() < deadline) {
        await sleep(pollInterval);

        const tokenBody = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: clientId,
        });

        const tokenResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: tokenBody.toString(),
        });

        const tokenData = await tokenResponse.json();

        if (tokenResponse.ok) {
            process.stderr.write('✓ Authorization successful!\n\n');
            return {
                accessToken: tokenData.access_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
            };
        }

        // Handle polling responses
        if (tokenData.error === 'authorization_pending') {
            continue;  // keep polling
        }
        if (tokenData.error === 'slow_down') {
            pollInterval += 5000;  // back off
            continue;
        }
        // Any other error is fatal
        throw new Error(`Device auth token polling failed: ${tokenData.error} — ${tokenData.error_description || ''}`);
    }

    throw new Error('Device authorization timed out. The user did not authorize in time.');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main entry point ─────────────────────────────────────────

/**
 * Returns the Authorization header value for Okta API requests.
 * Handles token acquisition, caching, and refresh automatically.
 *
 * @returns {Promise<string>} e.g. "Bearer xxx" or "SSWS xxx"
 */
export async function getAuthHeader() {
    const orgUrl = process.env.OKTA_ORG_URL;
    if (!orgUrl) throw new Error('OKTA_ORG_URL env var is required');
    const baseUrl = orgUrl.replace(/\/+$/, '');

    const mode = detectAuthMode();

    // SSWS — no token lifecycle, just return the static header
    if (mode === 'ssws') {
        return `SSWS ${process.env.OKTA_API_TOKEN}`;
    }

    // Check cached token
    if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
        return `Bearer ${cachedToken.accessToken}`;
    }

    // Acquire new token
    if (mode === 'private_key_jwt') {
        cachedToken = await getTokenViaPrivateKeyJwt(baseUrl);
    } else {
        cachedToken = await getTokenViaDeviceAuth(baseUrl);
    }

    return `Bearer ${cachedToken.accessToken}`;
}
