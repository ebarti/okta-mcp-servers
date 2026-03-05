/**
 * Okta HTTP Client
 *
 * Thin wrapper around `fetch` to call the Okta Management API.
 * Handles auth, URL construction, path-parameter interpolation,
 * query parameters, and JSON request/response bodies.
 *
 * Configuration (env vars):
 *   OKTA_ORG_URL  – e.g. https://my-org.okta.com
 *   OKTA_API_TOKEN – SSWS API token
 */

function getConfig() {
    const orgUrl = process.env.OKTA_ORG_URL;
    const apiToken = process.env.OKTA_API_TOKEN;
    if (!orgUrl) throw new Error('OKTA_ORG_URL env var is required');
    if (!apiToken) throw new Error('OKTA_API_TOKEN env var is required');
    return {
        orgUrl: orgUrl.replace(/\/+$/, ''),  // strip trailing slash
        apiToken,
    };
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
    const { orgUrl, apiToken } = getConfig();

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

    const headers = {
        'Accept': 'application/json',
        'Authorization': `SSWS ${apiToken}`,
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
