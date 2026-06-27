#!/usr/bin/env node
// conduit-openapi-mcp: an MCP server that turns any OpenAPI/Swagger spec into one
// tool per endpoint. Configured entirely via environment variables so it drops
// straight into any MCP client (or Conduit).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadApi, executeTool, type ApiConfig } from "./openapi.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

async function main(): Promise<void> {
  const spec = env("OPENAPI_SPEC");
  if (!spec) {
    console.error(
      "conduit-openapi-mcp: set OPENAPI_SPEC to a URL or file path of an OpenAPI/Swagger spec.",
    );
    process.exit(1);
  }

  const config: ApiConfig = {
    baseUrl: env("OPENAPI_BASE_URL"),
    authHeader: env("OPENAPI_AUTH_HEADER"),
    authValue: env("OPENAPI_AUTH_VALUE"),
    toolPrefix: env("OPENAPI_TOOL_PREFIX"),
    includeRegex: env("OPENAPI_INCLUDE") ? new RegExp(env("OPENAPI_INCLUDE")!) : undefined,
    excludeRegex: env("OPENAPI_EXCLUDE") ? new RegExp(env("OPENAPI_EXCLUDE")!) : undefined,
  };

  const api = await loadApi(spec, config);
  // Logs go to stderr so they never corrupt the stdio JSON-RPC stream.
  console.error(
    `conduit-openapi-mcp: loaded "${api.title}" -> ${api.tools.length} tools, base ${api.baseUrl}`,
  );

  const server = new Server(
    { name: "conduit-openapi-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: api.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = api.tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const text = await executeTool(
        tool,
        (request.params.arguments ?? {}) as Record<string, any>,
        config,
        api.baseUrl,
      );
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error calling ${tool.name}: ${(e as Error).message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("conduit-openapi-mcp: ready on stdio.");
}

main().catch((e) => {
  console.error("conduit-openapi-mcp: fatal:", e);
  process.exit(1);
});
