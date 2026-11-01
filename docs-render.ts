import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";

/**
 * Turns the project documentation (Markdown outside every repo) into what the Documentation tab shows. Used by the
 * local dev server (vite.config.ts) and by the upload to the servers (.claude/dev/ops/deploy/build-docs.mjs).
 * This file holds no documentation itself.
 */

export interface DocPage {
  slug: string;
  title: string;
  section: string;
  order: number;
  file: string;
  updated: string;
  headings: { id: string; text: string; level: number }[];
  text: string;
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const plainText = (md: string): string =>
  md
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    // keep _ and - inside words so names like z_notification or set-env stay searchable
    .replace(/[#>*`|[\]()]|-{2,}|(^|\s)[_-]+|[_-]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const readPages = (dir: string): DocPage[] =>
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

export const renderPage = (md: string): string => {
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
