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
 *      Interactive flow: opens browser for user to authorize.
 *      Best for CLI / interactive use.
 *
 *   3. SSWS (legacy) — OKTA_API_TOKEN
 *      Static API token, no OAuth. Kept for backward compatibility.
 *
 * Token Persistence:
 *   Tokens are persisted to ~/.okta-mcp/token-cache.json so that
 *   multiple MCP server processes (okta-users, okta-apps, etc.) can
 *   share a single token without each triggering a separate auth flow.
 *
 * Environment variables:
 *   OKTA_ORG_URL            (required)  Okta org URL
 *   OKTA_API_TOKEN          (ssws)      SSWS API token
 *   OKTA_CLIENT_ID          (oauth)     OAuth app client ID
 *   OKTA_PRIVATE_KEY        (pkjwt)     PEM private key (inline)
 *   OKTA_PRIVATE_KEY_FILE   (pkjwt)     Path to PEM private key file
 *   OKTA_PRIVATE_KEY_KID    (pkjwt)     Key ID for JWT header (optional)
 *   OKTA_SCOPES             (oauth)     Space-separated scopes (optional)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, openSync, closeSync, statSync, constants as fsConstants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

// ── Token cache ──────────────────────────────────────────────
let cachedToken = null;   // { accessToken, expiresAt }

const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry
const TOKEN_CACHE_DIR = join(homedir(), '.okta-mcp');
const TOKEN_CACHE_FILE = join(TOKEN_CACHE_DIR, 'token-cache.json');
const AUTH_LOCK_FILE = join(TOKEN_CACHE_DIR, 'auth.lock');
const AUTH_ERROR_FILE = join(TOKEN_CACHE_DIR, 'auth-error.json');
const AUTH_LOCK_MAX_AGE_MS = 10 * 60 * 1000; // 10 min stale lock timeout
const AUTH_LOCK_POLL_MS = 2000; // poll every 2s while waiting
const MAX_AUTH_RETRIES = 3; // max times a follower will retry after leader failure
const AUTH_ERROR_MAX_AGE_MS = 60 * 1000; // ignore error markers older than 60s

// ── File-based token persistence ─────────────────────────────

/**
 * Load a persisted token from disk.
 * Returns the token object if valid, null otherwise.
 */
function loadPersistedToken() {
    try {
        if (!existsSync(TOKEN_CACHE_FILE)) return null;

        const data = JSON.parse(readFileSync(TOKEN_CACHE_FILE, 'utf-8'));

        // Validate structure and expiry
        if (!data.accessToken || !data.expiresAt) return null;
        if (Date.now() >= data.expiresAt - TOKEN_REFRESH_BUFFER_MS) return null;

        // Validate it's for the same org + client
        const orgUrl = getOrgUrl();
        const clientId = process.env.OKTA_CLIENT_ID || '';
        if (data.orgUrl !== orgUrl || data.clientId !== clientId) return null;

        return { accessToken: data.accessToken, expiresAt: data.expiresAt };
    } catch {
        return null; // corrupt file, ignore
    }
}

/**
 * Persist a token to disk so other server processes can reuse it.
 */
function persistToken(token) {
    try {
        mkdirSync(TOKEN_CACHE_DIR, { recursive: true, mode: 0o700 });

        const data = {
            accessToken: token.accessToken,
            expiresAt: token.expiresAt,
            orgUrl: getOrgUrl(),
            clientId: process.env.OKTA_CLIENT_ID || '',
            createdAt: new Date().toISOString(),
        };

        writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
        // Non-fatal — in-memory cache still works
        process.stderr.write(`[okta-auth] Warning: could not persist token: ${err.message}\n`);
    }
}

/**
 * Persist an auth error to disk so follower processes know why the leader failed.
 */
function persistAuthError(error) {
    try {
        mkdirSync(TOKEN_CACHE_DIR, { recursive: true, mode: 0o700 });
        const data = {
            message: error.message,
            createdAt: Date.now(),
        };
        writeFileSync(AUTH_ERROR_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch { /* non-fatal */ }
}

/**
 * Load a recent auth error persisted by the leader process.
 * Returns the error message if recent, null otherwise.
 */
function loadAuthError() {
    try {
        if (!existsSync(AUTH_ERROR_FILE)) return null;
        const data = JSON.parse(readFileSync(AUTH_ERROR_FILE, 'utf-8'));
        if (!data.message || !data.createdAt) return null;
        // Ignore old errors
        if (Date.now() - data.createdAt > AUTH_ERROR_MAX_AGE_MS) return null;
        return data.message;
    } catch {
        return null;
    }
}

function clearAuthError() {
    try { unlinkSync(AUTH_ERROR_FILE); } catch { /* ignore */ }
}

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

function getOrgUrl() {
    const orgUrl = process.env.OKTA_ORG_URL;
    if (!orgUrl) throw new Error('OKTA_ORG_URL env var is required');
    return orgUrl.replace(/\/+$/, '');
}

function getTokenEndpoint(orgUrl) {
    return `${orgUrl}/oauth2/v1/token`;
}

function getDeviceAuthorizeEndpoint(orgUrl) {
    return `${orgUrl}/oauth2/v1/device/authorize`;
}

function getScopes() {
    const envScopes = (process.env.OKTA_SCOPES || '').replace(/^["']|["']$/g, '').trim();
    return envScopes || 'okta.users.manage';
}

// ── Browser helper ───────────────────────────────────────────

function openBrowser(url) {
    const platform = process.platform;
    let cmd;
    if (platform === 'darwin') cmd = `open "${url}"`;
    else if (platform === 'win32') cmd = `start "" "${url}"`;
    else cmd = `xdg-open "${url}"`;

    exec(cmd, (err) => {
        if (err) {
            process.stderr.write(`Could not open browser automatically. Please open manually:\n  ${url}\n`);
        }
    });
}

// ── Private Key JWT flow ─────────────────────────────────────

function loadPrivateKey() {
    if (process.env.OKTA_PRIVATE_KEY) {
        let key = process.env.OKTA_PRIVATE_KEY;
        if (key.includes('\\n')) {
            key = key.replace(/\\n/g, '\n');
        }
        return key;
    }
    if (process.env.OKTA_PRIVATE_KEY_FILE) {
        return readFileSync(process.env.OKTA_PRIVATE_KEY_FILE, 'utf-8');
    }
    throw new Error('Private key not found. Set OKTA_PRIVATE_KEY or OKTA_PRIVATE_KEY_FILE.');
}

async function getTokenViaPrivateKeyJwt(orgUrl) {
    const clientId = process.env.OKTA_CLIENT_ID;
    const privateKey = loadPrivateKey();
    const tokenEndpoint = getTokenEndpoint(orgUrl);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: clientId,
        sub: clientId,
        aud: tokenEndpoint,
        iat: now,
        exp: now + 300,
        jti: randomUUID(),
    };

    const header = { algorithm: 'RS256' };
    const kid = process.env.OKTA_PRIVATE_KEY_KID || process.env.OKTA_KEY_ID;
    if (kid) header.keyid = kid;

    const assertion = jwt.sign(payload, privateKey, header);

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: getScopes(),
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
    });

    process.stderr.write('[okta-auth] Requesting token via Private Key JWT...\n');

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
    process.stderr.write('[okta-auth] ✓ Token acquired via Private Key JWT\n');

    const token = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
    };

    persistToken(token);
    return token;
}

// ── Device Authorization Grant flow ──────────────────────────

async function getTokenViaDeviceAuth(orgUrl) {
    const clientId = process.env.OKTA_CLIENT_ID;
    const deviceAuthorizeUrl = getDeviceAuthorizeEndpoint(orgUrl);
    const tokenEndpoint = getTokenEndpoint(orgUrl);
    const scopes = getScopes();

    const deviceBody = new URLSearchParams({
        client_id: clientId,
        scope: scopes,
    });

    process.stderr.write('[okta-auth] Initiating device authorization flow...\n');

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

    const displayUri = verificationUriComplete || verificationUri;
    openBrowser(displayUri);

    process.stderr.write('\n');
    process.stderr.write('┌─────────────────────────────────────────────────────────┐\n');
    process.stderr.write('│              Okta Device Authorization                  │\n');
    process.stderr.write('├─────────────────────────────────────────────────────────┤\n');
    process.stderr.write(`│  URL: ${displayUri}\n`);
    if (userCode) {
        process.stderr.write(`│  Code: ${userCode}\n`);
    }
    process.stderr.write('└─────────────────────────────────────────────────────────┘\n');
    process.stderr.write('\n');
    process.stderr.write('[okta-auth] Waiting for authorization...\n');

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

        if (tokenResponse.ok && tokenData.access_token) {
            process.stderr.write('[okta-auth] ✓ Authorization successful!\n\n');
            const token = {
                accessToken: tokenData.access_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
            };
            persistToken(token);
            return token;
        }

        if (tokenData.error === 'authorization_pending') continue;
        if (tokenData.error === 'slow_down') { pollInterval += 5000; continue; }
        if (tokenData.error === 'access_denied') throw new Error('Device authorization was denied by the user.');
        throw new Error(`Device auth token polling failed: ${tokenData.error} — ${tokenData.error_description || ''}`);
    }

    throw new Error('Device authorization timed out. The user did not authorize in time.');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Lock file coordination ───────────────────────────────────

/**
 * Try to acquire the auth lock (atomic, non-blocking).
 * Uses O_EXCL to guarantee only one process wins.
 * @returns {boolean} true if lock was acquired
 */
function tryAcquireLock() {
    try {
        mkdirSync(TOKEN_CACHE_DIR, { recursive: true, mode: 0o700 });

        // O_CREAT | O_EXCL | O_WRONLY — fails if file already exists
        const fd = openSync(AUTH_LOCK_FILE, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
        writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        closeSync(fd);
        return true;
    } catch {
        return false; // another process holds the lock
    }
}

function releaseLock() {
    try { unlinkSync(AUTH_LOCK_FILE); } catch { /* ignore */ }
}

function isLockStale() {
    try {
        const stat = statSync(AUTH_LOCK_FILE);
        return (Date.now() - stat.mtimeMs) > AUTH_LOCK_MAX_AGE_MS;
    } catch {
        return true; // file doesn't exist or can't be read
    }
}

// ── Eager authentication ─────────────────────────────────────

/**
 * Perform authentication eagerly at server startup.
 *
 * Uses a lock file to coordinate across the 10 server processes:
 * - The first process to start acquires the lock and performs the auth flow
 * - Other processes wait for the lock to be released and reuse the persisted token
 *
 * This prevents 10 simultaneous device auth flows (and avoids 429 rate limits).
 */
export async function initializeAuth(retryCount = 0) {
    const mode = detectAuthMode();
    process.stderr.write(`[okta-auth] Auth mode: ${mode}\n`);

    if (mode === 'ssws') {
        process.stderr.write('[okta-auth] Using SSWS API token\n');
        return;
    }

    // 1. Check persisted token (fast path — another process already authenticated)
    const persisted = loadPersistedToken();
    if (persisted) {
        cachedToken = persisted;
        const remainingSec = Math.round((persisted.expiresAt - Date.now()) / 1000);
        process.stderr.write(`[okta-auth] ✓ Reusing persisted token (expires in ${remainingSec}s)\n`);
        return;
    }

    // 2. Check if a recent leader already failed (don't repeat the same failure)
    const recentError = loadAuthError();
    if (recentError) {
        throw new Error(`Authentication failed (from leader process): ${recentError}`);
    }

    // 3. Try to become the leader (acquire lock)
    if (tryAcquireLock()) {
        process.stderr.write('[okta-auth] Acquired auth lock — this process will authenticate\n');
        clearAuthError(); // clear any old error marker
        try {
            const orgUrl = getOrgUrl();
            if (mode === 'private_key_jwt') {
                cachedToken = await getTokenViaPrivateKeyJwt(orgUrl);
            } else {
                cachedToken = await getTokenViaDeviceAuth(orgUrl);
            }
        } catch (err) {
            process.stderr.write(`[okta-auth] ✗ Authentication failed: ${err.message}\n`);
            persistAuthError(err);
            throw err;
        } finally {
            releaseLock();
        }
        return;
    }

    // 3. Another process is authenticating — wait for it
    process.stderr.write('[okta-auth] Another server is authenticating, waiting...\n');

    const waitDeadline = Date.now() + AUTH_LOCK_MAX_AGE_MS;
    while (Date.now() < waitDeadline) {
        await sleep(AUTH_LOCK_POLL_MS);

        // Check if the leader has persisted a token
        const token = loadPersistedToken();
        if (token) {
            cachedToken = token;
            const remainingSec = Math.round((token.expiresAt - Date.now()) / 1000);
            process.stderr.write(`[okta-auth] ✓ Received token from another process (expires in ${remainingSec}s)\n`);
            return;
        }

        // Check if the leader failed — stop immediately with the real error
        const leaderError = loadAuthError();
        if (leaderError) {
            throw new Error(`Authentication failed (from leader process): ${leaderError}`);
        }

        // If lock is gone but no token, the leader failed — try to become leader
        if (!existsSync(AUTH_LOCK_FILE) || isLockStale()) {
            if (retryCount >= MAX_AUTH_RETRIES) {
                throw new Error(
                    `Authentication failed after ${MAX_AUTH_RETRIES} retries. ` +
                    'The leader process failed repeatedly to acquire a token.'
                );
            }
            // Remove stale lock so tryAcquireLock() (O_EXCL) can succeed on retry
            releaseLock();
            const backoffMs = Math.pow(2, retryCount) * 1000;
            process.stderr.write(`[okta-auth] Leader process finished/failed, retrying auth (attempt ${retryCount + 1}/${MAX_AUTH_RETRIES}, backoff ${backoffMs}ms)...\n`);
            await sleep(backoffMs);
            return initializeAuth(retryCount + 1);
        }
    }

    throw new Error('Timed out waiting for another process to complete authentication.');
}

// ── Main entry point ─────────────────────────────────────────

/**
 * Returns the Authorization header value for Okta API requests.
 * Handles token acquisition, caching, and refresh automatically.
 *
 * @returns {Promise<string>} e.g. "Bearer xxx" or "SSWS xxx"
 */
export async function getAuthHeader() {
    const orgUrl = getOrgUrl();
    const mode = detectAuthMode();

    if (mode === 'ssws') {
        return `SSWS ${process.env.OKTA_API_TOKEN}`;
    }

    // Check in-memory cache
    if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
        return `Bearer ${cachedToken.accessToken}`;
    }

    // Check persisted token (another process may have refreshed)
    const persisted = loadPersistedToken();
    if (persisted) {
        cachedToken = persisted;
        return `Bearer ${cachedToken.accessToken}`;
    }

    // Acquire new token
    process.stderr.write('[okta-auth] Token expired, refreshing...\n');
    if (mode === 'private_key_jwt') {
        cachedToken = await getTokenViaPrivateKeyJwt(orgUrl);
    } else {
        cachedToken = await getTokenViaDeviceAuth(orgUrl);
    }

    return `Bearer ${cachedToken.accessToken}`;
}
