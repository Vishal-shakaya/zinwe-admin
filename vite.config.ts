import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { Marked, type Tokens } from "marked";

/**
 * Local-only project documentation for the admin's Documentation tab (src/pages/DocsPage.tsx).
 *
 * The docs are Markdown files in the project brain, `<project>/.claude/dev/docs/` (never pushed; the
 * public repos never contain them). This plugin runs ONLY under the Vite dev server (`apply: "serve"`),
 * so `vite build` -- what dev/prod servers deploy -- has neither the docs nor these endpoints:
 *   GET /__zinwe_docs/index.json   every page: slug, title, section, headings, plain text (for search)
 *   GET /__zinwe_docs/page/<slug>   one page rendered to HTML
 * Editing a doc pushes a `zinwe-docs:changed` HMR event, so the open page refreshes by itself.
 */
function zinweDocs(): Plugin {
  const findDocsDir = (start: string): string | null => {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      for (const brain of [".claude", ".cloude"]) {
        const candidate = path.join(dir, brain, "dev", "docs");
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };

  const slugify = (text: string) =>
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z]+;|&#\d+;/g, "")
      .replace(/[`*_~]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

  const plainText = (md: string) =>
    md
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/```[\s\S]*?```/g, " ")
      // keep _ and - inside words so names like z_notification or set-env stay searchable
      .replace(/[#>*`|[\]()]|-{2,}|(^|\s)[_-]+|[_-]+(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  interface Page {
    slug: string;
    title: string;
    section: string;
    order: number;
    file: string;
    updated: string;
    headings: { id: string; text: string; level: number }[];
    text: string;
  }

  const readPages = (dir: string): Page[] =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
      .sort()
      .map((file, order) => {
        const full = path.join(dir, file);
        const md = fs.readFileSync(full, "utf8");
        const title = md.match(/^#\s+(.+)$/m)?.[1].trim() ?? file.replace(/\.md$/, "");
        const section = md.match(/<!--\s*section:\s*(.+?)\s*-->/)?.[1] ?? "Documentation";
        const headings = [...md.matchAll(/^(#{2,3})\s+(.+)$/gm)].map((m) => ({
          level: m[1].length,
          text: m[2].replace(/[`*]/g, ""),
          id: slugify(m[2]),
        }));
        return {
          slug: file.replace(/\.md$/, ""),
          title,
          section,
          order,
          file,
          updated: fs.statSync(full).mtime.toISOString(),
          headings,
          text: plainText(md),
        };
      });

  const render = (md: string): string => {
    const marked = new Marked({ gfm: true });
    marked.use({
      renderer: {
        heading({ tokens, depth }: Tokens.Heading) {
          const inner = this.parser.parseInline(tokens);
          return `<h${depth} id="${slugify(inner)}">${inner}</h${depth}>\n`;
        },
        link({ href, title, tokens }: Tokens.Link) {
          const text = this.parser.parseInline(tokens);
          // Links between docs: "07-admin-panel.md#x" -> "/docs/07-admin-panel#x".
          const local = href.match(/^(?:\.\/)?([\w-]+)\.md(#.*)?$/);
          const target = local ? `/docs/${local[1]}${local[2] ?? ""}` : href;
          const external = /^https?:/.test(target);
          const t = title ? ` title="${title}"` : "";
          return `<a href="${target}"${t}${external ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
        },
      },
    });
    return marked.parse(md.replace(/<!--[\s\S]*?-->/g, "")) as string;
  };

  return {
    name: "zinwe-docs",
    apply: "serve",
    configureServer(server) {
      const dir = findDocsDir(server.config.root);
      if (dir) {
        server.watcher.add(dir);
        server.watcher.on("all", (_event, file) => {
          if (file.startsWith(dir) && file.endsWith(".md")) {
            server.ws.send({ type: "custom", event: "zinwe-docs:changed" });
          }
        });
      }
      server.middlewares.use("/__zinwe_docs", (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (!dir) {
          res.end(JSON.stringify({ missing: true, pages: [] }));
          return;
        }
        const url = (req.url ?? "/").split("?")[0];
        if (url === "/index.json") {
          res.end(JSON.stringify({ dir, pages: readPages(dir) }));
          return;
        }
        const slug = url.match(/^\/page\/([\w-]+)$/)?.[1];
        const file = slug ? path.join(dir, `${slug}.md`) : null;
        if (!file || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        const md = fs.readFileSync(file, "utf8");
        res.end(JSON.stringify({ slug, html: render(md), updated: fs.statSync(file).mtime.toISOString() }));
      });
    },
  };
}

// The internal admin app. Runs on 5174 (the owner dashboard uses 5173) and
// proxies /api to the Django backend so the token-authed calls are same-origin.
export default defineConfig({
  plugins: [react(), zinweDocs()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
