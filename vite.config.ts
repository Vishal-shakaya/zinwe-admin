import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readPages, renderPage } from "./docs-render.ts";

/**
 * The Documentation tab (src/pages/DocsPage.tsx) on a local dev server, with live refresh.
 *
 * The docs are Markdown files in `<project>/.claude/dev/docs/` (never pushed; the public repos never contain them).
 * This plugin runs ONLY under the Vite dev server (`apply: "serve"`), so `vite build` has neither the docs nor these
 * endpoints. On the servers the tab reads /api/admin/docs/ instead: staff only, from files deploy.ps1 uploads.
 *   GET /__zinwe_docs/index.json   every page: slug, title, section, headings, plain text (for search)
 *   GET /__zinwe_docs/page/<slug>   one page rendered to HTML
 * Editing a doc pushes a `zinwe-docs:changed` HMR event, so the open page refreshes by itself.
 */
function zinweDocs(): Plugin {
  const findDocsDir = (start: string): string | null => {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      // `<project>/.claude/dev/docs` (the main folder holds only the apps); `.cloude/dev/docs` is the older name.
      const candidates = [path.join(dir, ".claude", "dev", "docs"), path.join(dir, ".cloude", "dev", "docs")];
      for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, "00-overview.md"))) return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
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
        res.end(JSON.stringify({ slug, html: renderPage(md), updated: fs.statSync(file).mtime.toISOString() }));
      });
    },
  };
}

// The internal admin app. Runs on 5174 (the owner dashboard uses 5173) and
// proxies /api to the Django backend so the token-authed calls are same-origin.
// ZINWE_API_TARGET points it at another backend (a worktree's own API, e.g. http://127.0.0.1:8020);
// `vite preview` uses the same proxy.
const API_TARGET = process.env.ZINWE_API_TARGET || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), zinweDocs()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
