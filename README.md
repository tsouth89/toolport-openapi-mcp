# conduit-openapi-mcp

[![CI](https://github.com/tsouth89/conduit-openapi-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tsouth89/conduit-openapi-mcp/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/conduit-openapi-mcp.svg)](https://www.npmjs.com/package/conduit-openapi-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Turn any OpenAPI / Swagger spec into an MCP server.** One tool per endpoint, zero code.

Point it at a spec URL or file, give it auth, and every operation in the API becomes a tool your AI client can call. Built by the team behind [Conduit](https://conduitmcp.app).

> Pointed at Stripe's OpenAPI spec, it generates **587 tools** from one URL. (Behind [Conduit](https://conduitmcp.app), your agent sees a handful of meta-tools and searches them, for ~90% fewer tokens.)

```bash
npx conduit-openapi-mcp
```

## Quick start

It's configured entirely through environment variables, so it drops into any MCP client. The only required one is the spec:

```jsonc
{
  "mcpServers": {
    "petstore": {
      "command": "npx",
      "args": ["-y", "conduit-openapi-mcp"],
      "env": {
        "OPENAPI_SPEC": "https://petstore3.swagger.io/api/v3/openapi.json"
      }
    }
  }
}
```

That one URL gives the model 19 tools (`getPetById`, `findPetsByStatus`, `addPet`, ...), each with the right input schema pulled straight from the spec.

> **Not on npm yet?** Until it's published, run from source: clone the repo, `npm install && npm run build`, then swap the `npx` line for `"command": "node", "args": ["/absolute/path/to/conduit-openapi-mcp/dist/index.js"]`.

### With auth

Most real APIs need a key. Pass the header name and value:

```jsonc
"env": {
  "OPENAPI_SPEC": "https://api.example.com/openapi.json",
  "OPENAPI_AUTH_HEADER": "Authorization",
  "OPENAPI_AUTH_VALUE": "Bearer YOUR_TOKEN"
}
```

### Xquik API example

Xquik publishes an OpenAPI 3.1 spec and uses the `x-api-key` header for API-key auth:

```jsonc
{
  "mcpServers": {
    "xquik": {
      "command": "npx",
      "args": ["-y", "conduit-openapi-mcp"],
      "env": {
        "OPENAPI_SPEC": "https://xquik.com/openapi.json",
        "OPENAPI_AUTH_HEADER": "x-api-key",
        "OPENAPI_AUTH_VALUE": "YOUR_XQUIK_API_KEY",
        "OPENAPI_TOOL_PREFIX": "xquik_"
      }
    }
  }
}
```

## Configuration

| Env var | Required | Description |
|---|---|---|
| `OPENAPI_SPEC` | yes | URL or file path to an OpenAPI 3.x / Swagger 2.0 spec. |
| `OPENAPI_BASE_URL` | no | Override the API base URL (defaults to the spec's `servers`). |
| `OPENAPI_AUTH_HEADER` | no | Header name for auth, e.g. `Authorization` or `X-API-Key`. |
| `OPENAPI_AUTH_VALUE` | no | The auth value, e.g. `Bearer xxx`. Keep this secret. |
| `OPENAPI_TOOL_PREFIX` | no | Prefix added to every tool name (e.g. `stripe_`). |
| `OPENAPI_INCLUDE` | no | Regex; only operations whose tool name matches are exposed. |
| `OPENAPI_EXCLUDE` | no | Regex; operations whose tool name matches are dropped. |

## Pairs perfectly with Conduit

A real API spec is often 50 to 200+ endpoints. Point this at one and your AI client gets 50 to 200+ tool definitions dumped into the model's context on every request, plus fat JSON responses that bloat it further.

[Conduit](https://conduitmcp.app) fixes both halves:
- **Lazy discovery** collapses those 200 tools into 3 the agent searches on demand (~90% fewer tokens).
- **Result-shaping** caps oversized API responses so a 10,000-row reply doesn't blow your context.

So this server gives you the whole API, and Conduit makes it cheap to actually use.

## How it works

1. Loads and dereferences the spec (via [`@apidevtools/swagger-parser`](https://www.npmjs.com/package/@apidevtools/swagger-parser)).
2. Maps each operation to an MCP tool: the `operationId` becomes the tool name; parameters and the request body become the input schema.
3. On a call, builds the HTTP request (path / query / header params, JSON body, your auth header) and returns the response.

Runs on stdio, no network ports, and your auth token stays in the env you give it.

## Contributing

Issues and PRs are welcome. To hack on it: `npm install`, then `npm run build`.

## License

MIT
