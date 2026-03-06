# Okta Management MCP Servers

Gemini CLI extension that exposes **all 694 Okta Management API operations** as MCP tools — auto-generated from the official OpenAPI spec and split into **10 domain-specific servers** so you only load what you need.

## Servers

| Server | Tools | Domain |
|--------|------:|--------|
| `okta-users` | 93 | Users, Groups, Sessions, Factors, Credentials |
| `okta-apps` | 75 | Applications, SSO, Provisioning, App Users/Groups |
| `okta-authz` | 48 | Authorization Servers, Policies, Rules, Claims, Scopes |
| `okta-idps` | 39 | Identity Providers, Keys, Identity Sources |
| `okta-security` | 87 | Authenticators, Policies, Behavior Rules, Network Zones |
| `okta-roles` | 81 | Role Assignments, Targets, Resource Sets, Custom Roles |
| `okta-customization` | 97 | Brands, Themes, Custom Pages, Schemas, Emails |
| `okta-org` | 68 | Org Settings, Features, Trusted Origins, Rate Limits |
| `okta-hooks` | 55 | Event/Inline Hooks, Log Streams, System Log, SSF |
| `okta-devices` | 51 | Devices, Agent Pools, Realms, Push Providers |

## Installation

### 1. Install the extension

```bash
gemini extension install /path/to/okta-mcp-server
```

### 2. Configure authentication

The servers support three authentication modes, auto-detected from environment variables.

#### Option A — Private Key JWT *(recommended for automation)*

Best for CI/CD, scripts, and server-to-server use. No user interaction required.

**Okta setup:** Create a **Service** application in Okta Admin Console → Applications, enable **Client Credentials** grant type, and add a public key (JWK) under the application's credentials.

```bash
export OKTA_ORG_URL=https://your-org.okta.com
export OKTA_CLIENT_ID=0oa...your-client-id
export OKTA_PRIVATE_KEY_FILE=/path/to/private-key.pem
# Optional:
export OKTA_PRIVATE_KEY_KID=your-key-id        # if multiple keys are registered
export OKTA_SCOPES="okta.users.manage okta.apps.manage"  # space-separated scopes
export OKTA_AUTH_SERVER_ID=default              # omit for org-level authorization server
```

Alternatively, pass the PEM key inline:

```bash
export OKTA_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

#### Option B — Device Authorization Grant *(recommended for interactive use)*

Best for CLI sessions where a human is present. The server will print a URL and code — open the URL in your browser and enter the code to authorize.

**Okta setup:** Create a **Native** application in Okta Admin Console → Applications, enable **Device Authorization** grant type, and ensure the authorization server policy allows device authorization.

```bash
export OKTA_ORG_URL=https://your-org.okta.com
export OKTA_CLIENT_ID=0oa...your-client-id
# Optional:
export OKTA_SCOPES="okta.users.manage okta.apps.manage"
export OKTA_AUTH_SERVER_ID=default
```

#### Option C — SSWS API Token *(legacy)*

Static API token — simple but less secure. Kept for backward compatibility.

```bash
export OKTA_ORG_URL=https://your-org.okta.com
export OKTA_API_TOKEN=your-ssws-token
```

### Auth mode priority

When multiple variables are set, the server picks the most secure option:

1. **Private Key JWT** — if `OKTA_CLIENT_ID` + `OKTA_PRIVATE_KEY` / `OKTA_PRIVATE_KEY_FILE` are set
2. **Device Authorization Grant** — if only `OKTA_CLIENT_ID` is set
3. **SSWS** — if only `OKTA_API_TOKEN` is set

## Automatic Updates

A [GitHub Actions workflow](.github/workflows/update-spec.yml) runs weekly (every Monday) to check for upstream changes to the [Okta OpenAPI spec](https://github.com/okta/okta-management-openapi-spec). If changes are detected, it regenerates the tool manifests and opens a PR automatically.

You can also trigger it manually from the Actions tab.

## Regenerating (for contributors)

If you update the OpenAPI spec:

1. Replace `okta-management-openapi.yaml`
2. Run `npm install && npm run generate`
3. Commit the updated JSON manifests in `src/servers/`

## Project Structure

```
├── okta-management-openapi.yaml   # Okta OpenAPI spec (input)
├── scripts/
│   └── generate-tools.js          # Parses YAML → per-server JSON manifests
├── src/
│   ├── server-groups.js           # Tag-to-server mapping config
│   ├── create-server.js           # Shared MCP server factory
│   ├── okta-auth.js               # OAuth2 token manager (Device Auth / PKJWT / SSWS)
│   ├── okta-client.js             # HTTP client (delegates auth to okta-auth.js)
│   └── servers/                   # Pre-generated per-server manifests
│       ├── okta-users.json
│       ├── okta-apps.json
│       └── ...
├── servers/                       # Entry points (one per server)
│   ├── okta-users.js
│   ├── okta-apps.js
│   └── ...
└── gemini-extension.json          # Registers all 10 servers
```
