#!/usr/bin/env node
/**
 * Qiita MCP server
 *
 * Wraps the Qiita API v2 (https://qiita.com/api/v2/docs) as MCP tools so that
 * Claude Code can search, read, post, edit, delete articles, comment and stock.
 *
 * Auth: set the QIITA_ACCESS_TOKEN environment variable.
 *   Generate a token at https://qiita.com/settings/applications
 *   Write operations require the write_qiita scope.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://qiita.com/api/v2";
const TOKEN = process.env.QIITA_ACCESS_TOKEN;

/** A single tag entry as the Qiita API expects it. */
const tagSchema = z.object({
  name: z.string().describe("Tag name, e.g. 'Ruby'"),
  versions: z
    .array(z.string())
    .optional()
    .describe("Optional version strings, e.g. ['0.0.1']"),
});

type QiitaError = { message?: string; type?: string };

/**
 * Thin wrapper around fetch for the Qiita API.
 * - Adds auth + JSON headers.
 * - Throws a readable Error on non-2xx.
 * - Returns null on 204 (no body).
 */
async function qiita(
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | undefined> } = {}
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const res = await fetch(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // Surface remaining rate-limit budget when the server reports it.
  const remaining = res.headers.get("Rate-Remaining");

  if (res.status === 204) return { ok: true, status: 204, rate_remaining: remaining };

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const err = (parsed ?? {}) as QiitaError;
    const detail = err.message
      ? `${err.message}${err.type ? ` (${err.type})` : ""}`
      : `HTTP ${res.status}`;
    throw new Error(`Qiita API error: ${detail}`);
  }

  return parsed;
}

/** Format any value as a text content block for an MCP tool result. */
function ok(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}

/** Format an error as an MCP tool result (isError flag set). */
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const server = new McpServer({ name: "qiita-mcp", version: "1.0.0" });

/* ----------------------------- READ TOOLS ------------------------------ */

server.registerTool(
  "qiita_search_items",
  {
    title: "Search Qiita articles",
    description:
      "Search public Qiita articles. The query supports Qiita search syntax, " +
      "e.g. 'Docker user:Qiita tag:Ruby stocks:>10 created:>=2024-01-01'.",
    inputSchema: {
      query: z.string().optional().describe("Qiita search query string"),
      page: z.number().int().min(1).max(100).default(1),
      per_page: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, page, per_page }) => {
    try {
      const data = await qiita("GET", "/items", { query: { query, page, per_page } });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_get_item",
  {
    title: "Get a Qiita article",
    description: "Fetch one article (with Markdown body) by its item ID.",
    inputSchema: {
      item_id: z.string().describe("The article ID, e.g. 'c686397e4a0f4f11683d'"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ item_id }) => {
    try {
      return ok(await qiita("GET", `/items/${item_id}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_get_authenticated_user",
  {
    title: "Get the authenticated user",
    description:
      "Return the profile of the user tied to QIITA_ACCESS_TOKEN, including " +
      "image upload limits. Useful to verify the token works.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return ok(await qiita("GET", "/authenticated_user"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_list_my_items",
  {
    title: "List my articles",
    description: "List the authenticated user's own articles, newest first.",
    inputSchema: {
      page: z.number().int().min(1).max(100).default(1),
      per_page: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ page, per_page }) => {
    try {
      return ok(await qiita("GET", "/authenticated_user/items", { query: { page, per_page } }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_list_item_comments",
  {
    title: "List comments on an article",
    description: "List comments on a given article, newest first.",
    inputSchema: { item_id: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ item_id }) => {
    try {
      return ok(await qiita("GET", `/items/${item_id}/comments`));
    } catch (e) {
      return fail(e);
    }
  }
);

/* ----------------------------- WRITE TOOLS ----------------------------- */

server.registerTool(
  "qiita_create_item",
  {
    title: "Create a Qiita article",
    description:
      "Publish a new article. Requires the write_qiita scope. Set private:true " +
      "to publish as a limited-share (private) article first if unsure.",
    inputSchema: {
      title: z.string().describe("Article title"),
      body: z.string().describe("Article body in Markdown"),
      tags: z.array(tagSchema).min(1).describe("At least one tag is required"),
      private: z
        .boolean()
        .default(true)
        .describe("If true (default), publish as a private/limited-share article"),
      tweet: z
        .boolean()
        .optional()
        .describe("Post a tweet on publish (only if Twitter integration is enabled)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ title, body, tags, private: isPrivate, tweet }) => {
    try {
      return ok(
        await qiita("POST", "/items", {
          body: { title, body, tags, private: isPrivate, tweet },
        })
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_update_item",
  {
    title: "Update a Qiita article",
    description:
      "Update an existing article. Qiita replaces the fields you send, so pass " +
      "the full title, body and tags you want the article to end up with. " +
      "Tip: call qiita_get_item first to read the current content.",
    inputSchema: {
      item_id: z.string(),
      title: z.string(),
      body: z.string().describe("Full Markdown body to replace the existing one"),
      tags: z.array(tagSchema).min(1),
      private: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ item_id, title, body, tags, private: isPrivate }) => {
    try {
      return ok(
        await qiita("PATCH", `/items/${item_id}`, {
          body: { title, body, tags, private: isPrivate },
        })
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_delete_item",
  {
    title: "Delete a Qiita article",
    description:
      "Permanently delete an article by ID. This cannot be undone — confirm the " +
      "item_id with qiita_get_item before calling.",
    inputSchema: { item_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ item_id }) => {
    try {
      await qiita("DELETE", `/items/${item_id}`);
      return ok({ deleted: true, item_id });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_post_comment",
  {
    title: "Post a comment",
    description: "Post a Markdown comment on an article.",
    inputSchema: {
      item_id: z.string(),
      body: z.string().describe("Comment body in Markdown"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ item_id, body }) => {
    try {
      return ok(await qiita("POST", `/items/${item_id}/comments`, { body: { body } }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_stock_item",
  {
    title: "Stock an article",
    description: "Add an article to the authenticated user's stocks.",
    inputSchema: { item_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ item_id }) => {
    try {
      await qiita("PUT", `/items/${item_id}/stock`);
      return ok({ stocked: true, item_id });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "qiita_unstock_item",
  {
    title: "Unstock an article",
    description: "Remove an article from the authenticated user's stocks.",
    inputSchema: { item_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ item_id }) => {
    try {
      await qiita("DELETE", `/items/${item_id}/stock`);
      return ok({ unstocked: true, item_id });
    } catch (e) {
      return fail(e);
    }
  }
);

/* ------------------------------- STARTUP ------------------------------- */

async function main() {
  if (!TOKEN) {
    // Read-only public endpoints still work without a token (60 req/hour/IP),
    // but write tools will fail. Warn on stderr (never stdout — that's the
    // JSON-RPC channel).
    console.error(
      "[qiita-mcp] WARNING: QIITA_ACCESS_TOKEN is not set. " +
        "Write operations will fail and read calls are rate-limited to 60/hour."
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[qiita-mcp] server running on stdio");
}

main().catch((err) => {
  console.error("[qiita-mcp] fatal:", err);
  process.exit(1);
});
