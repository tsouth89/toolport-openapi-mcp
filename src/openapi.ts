// Load an OpenAPI/Swagger spec and turn each operation into an MCP tool, then
// execute those tools as HTTP requests against the API.

import SwaggerParser from "@apidevtools/swagger-parser";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

export interface ApiTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // Execution metadata.
  method: string;
  path: string; // templated, e.g. /users/{id}
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  hasBody: boolean;
}

export interface LoadedApi {
  title: string;
  baseUrl: string;
  tools: ApiTool[];
}

export interface ApiConfig {
  baseUrl?: string;
  authHeader?: string;
  authValue?: string;
  toolPrefix?: string;
  includeRegex?: RegExp;
  excludeRegex?: RegExp;
}

// After full dereference, a self-referential schema (e.g. a tree node whose
// `children` items point back at itself) becomes a *circular* JS object. Feeding
// that into a tool's inputSchema deadlocks the client: JSON.stringify on the
// tools/list response throws/never completes. Deep-clone each schema instead,
// tracking the current ancestor chain so a node that reappears above itself
// (a genuine cycle) collapses to an empty "any" stub. A depth cap backstops any
// pathological nesting. Only true cycles are cut; shared-but-acyclic subschemas
// are cloned out just as JSON.stringify would emit them.
const MAX_SCHEMA_DEPTH = 50;

function sanitizeSchema(value: any, ancestors: Set<any> = new Set(), depth = 0): any {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value) || depth > MAX_SCHEMA_DEPTH) {
    // Cycle or runaway depth: bounded, still-valid stub (accepts any value).
    return {};
  }
  ancestors.add(value);
  let out: any;
  if (Array.isArray(value)) {
    out = value.map((v) => sanitizeSchema(v, ancestors, depth + 1));
  } else {
    out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeSchema(v, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
  return out;
}

/** Sanitize an operationId (or method+path fallback) into a valid MCP tool name. */
function toolName(opId: string | undefined, method: string, path: string): string {
  const raw = opId && opId.trim().length > 0 ? opId : `${method}_${path}`;
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "op";
}

/** Build the JSON-schema input for a tool from its parameters + request body. */
function buildInputSchema(
  params: any[],
  bodySchema: any,
  bodyRequired: boolean,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    if (!p || !p.name) continue;
    const schema: Record<string, unknown> = p.schema ? sanitizeSchema(p.schema) : { type: "string" };
    if (p.description && !schema.description) schema.description = p.description;
    properties[p.name] = schema;
    if (p.required) required.push(p.name);
  }
  if (bodySchema) {
    const body: Record<string, unknown> = sanitizeSchema(bodySchema);
    if (!body.description) body.description = "JSON request body.";
    properties.body = body;
    if (bodyRequired) required.push("body");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** Load + dereference a spec and generate the tool set. */
export async function loadApi(specSource: string, config: ApiConfig): Promise<LoadedApi> {
  const spec: any = await SwaggerParser.dereference(specSource);
  const title: string = spec.info?.title ?? "API";

  // Resolve the base URL: explicit override, then OpenAPI 3 `servers`, then
  // Swagger 2.0 host/basePath.
  let baseUrl = config.baseUrl;
  if (!baseUrl) {
    if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
      baseUrl = spec.servers[0].url as string;
    } else if (spec.host) {
      const scheme = (Array.isArray(spec.schemes) && spec.schemes[0]) || "https";
      baseUrl = `${scheme}://${spec.host}${spec.basePath ?? ""}`;
    }
  }
  if (!baseUrl) {
    throw new Error(
      "No base URL: the spec declares no servers and OPENAPI_BASE_URL is unset.",
    );
  }
  baseUrl = baseUrl.replace(/\/+$/, "");

  const tools: ApiTool[] = [];
  const paths: Record<string, any> = spec.paths ?? {};
  for (const [path, item] of Object.entries(paths)) {
    if (!item) continue;
    const shared: any[] = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;

      const params: any[] = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const inParams = params.filter((p) => ["path", "query", "header"].includes(p?.in));
      const pathParams = inParams.filter((p) => p.in === "path").map((p) => p.name);
      const queryParams = inParams.filter((p) => p.in === "query").map((p) => p.name);
      const headerParams = inParams.filter((p) => p.in === "header").map((p) => p.name);

      // Request body: OpenAPI 3 `requestBody`, else a Swagger 2.0 `in: body` param.
      let bodySchema: any = null;
      let bodyRequired = false;
      const rb = op.requestBody;
      if (rb && rb.content) {
        const json = rb.content["application/json"] ?? Object.values(rb.content)[0];
        bodySchema = (json as any)?.schema ?? null;
        bodyRequired = Boolean(rb.required);
      }
      if (!bodySchema) {
        const bodyParam = params.find((p) => p?.in === "body");
        if (bodyParam) {
          bodySchema = bodyParam.schema ?? null;
          bodyRequired = Boolean(bodyParam.required);
        }
      }

      const name = (config.toolPrefix ?? "") + toolName(op.operationId, method, path);
      if (config.includeRegex && !config.includeRegex.test(name)) continue;
      if (config.excludeRegex && config.excludeRegex.test(name)) continue;

      const descParts = [op.summary, op.description].filter(
        (s) => typeof s === "string" && s.trim().length > 0,
      );
      const description = (descParts.join(". ") || `${method.toUpperCase()} ${path}`).slice(0, 1024);

      tools.push({
        name,
        description,
        inputSchema: buildInputSchema(inParams, bodySchema, bodyRequired),
        method,
        path,
        pathParams,
        queryParams,
        headerParams,
        hasBody: Boolean(bodySchema),
      });
    }
  }

  return { title, baseUrl, tools };
}

/** Execute one generated tool as an HTTP request; returns a readable text result. */
export async function executeTool(
  tool: ApiTool,
  args: Record<string, any>,
  config: ApiConfig,
  baseUrl: string,
): Promise<string> {
  // Path parameters.
  let path = tool.path;
  for (const p of tool.pathParams) {
    const v = args[p];
    if (v === undefined || v === null) {
      throw new Error(`missing required path parameter: ${p}`);
    }
    path = path.replace(`{${p}}`, encodeURIComponent(String(v)));
  }

  // Query parameters.
  const url = new URL(baseUrl + path);
  for (const q of tool.queryParams) {
    const v = args[q];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(q, String(item));
    } else {
      url.searchParams.set(q, String(v));
    }
  }

  // Headers + auth.
  const headers: Record<string, string> = {};
  for (const h of tool.headerParams) {
    const v = args[h];
    if (v !== undefined && v !== null) headers[h] = String(v);
  }
  if (config.authHeader && config.authValue) {
    headers[config.authHeader] = config.authValue;
  }

  // Body.
  let body: string | undefined;
  if (tool.hasBody && args.body !== undefined) {
    body = JSON.stringify(args.body);
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  }

  const res = await fetch(url.toString(), { method: tool.method.toUpperCase(), headers, body });
  const raw = await res.text();
  const status = `HTTP ${res.status} ${res.statusText}`.trim();

  // Pretty-print JSON so it reads cleanly (and gives result-shaping structured
  // text to page when the response is large).
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Not JSON, leave as-is.
  }
  return `${status}\n${pretty}`;
}
