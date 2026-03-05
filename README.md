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

### 2. Set your Okta credentials

```bash
export OKTA_ORG_URL=https://your-org.okta.com
export OKTA_API_TOKEN=your-ssws-token
```

That's it — the servers are ready to use. You can selectively enable the ones you need from the extension settings.

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
│   ├── okta-client.js             # HTTP client (SSWS auth)
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
