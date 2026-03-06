/**
 * Okta HTTP Client
 *
 * Thin wrapper around `fetch` to call the Okta Management API.
 * Handles auth, URL construction, path-parameter interpolation,
 * query parameters, and JSON request/response bodies.
 *
 * Authentication is delegated to okta-auth.js which supports:
 *   - Private Key JWT  (OKTA_CLIENT_ID + OKTA_PRIVATE_KEY)
 *   - Device Auth Grant (OKTA_CLIENT_ID only)
 *   - SSWS API token    (OKTA_API_TOKEN)
 *
 * Configuration (env vars):
 *   OKTA_ORG_URL – e.g. https://my-org.okta.com
 *   (plus auth-specific vars — see okta-auth.js)
 */

import { getAuthHeader } from './okta-auth.js';

function getOrgUrl() {
    const orgUrl = process.env.OKTA_ORG_URL;
    if (!orgUrl) throw new Error('OKTA_ORG_URL env var is required');
    return orgUrl.replace(/\/+$/, '');  // strip trailing slash
}

/**
 * Call an Okta Management API endpoint.
 *
 * @param {object} opts
 * @param {string} opts.method        HTTP method (GET, POST, …)
 * @param {string} opts.pathTemplate  e.g. "/api/v1/users/{userId}"
 * @param {object} opts.pathParams    e.g. { userId: "00u123" }
 * @param {object} opts.queryParams   e.g. { limit: 10 }
 * @param {object} [opts.body]        JSON request body
 * @returns {Promise<{ status: number, data: any }>}
 */
export async function callOktaApi({ method, pathTemplate, pathParams = {}, queryParams = {}, body }) {
    const orgUrl = getOrgUrl();

    // Interpolate path parameters
    let path = pathTemplate;
    for (const [key, value] of Object.entries(pathParams)) {
        path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }

    // Build query string
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== '') {
            qs.append(key, String(value));
        }
    }
    const queryString = qs.toString();
    const url = `${orgUrl}${path}${queryString ? '?' + queryString : ''}`;

    // Get auth header (handles token lifecycle automatically)
    const authorization = await getAuthHeader();

    const headers = {
        'Accept': 'application/json',
        'Authorization': authorization,
    };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const fetchOpts = {
        method,
        headers,
    };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOpts);

    // Try to parse JSON; fall back to text
    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        data = await response.json();
    } else {
        const text = await response.text();
        data = text || null;
    }

    if (!response.ok) {
        return {
            status: response.status,
            error: data,
        };
    }

    return { status: response.status, data };
}
