import { useRef, useState, type ReactElement } from "react";
import { deleteAttachment, renameAttachment, uploadAttachment, type Article } from "../lib/blogApi";
import { useToast } from "./Toast";

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const KIND: Record<string, string> = { "application/pdf": "PDF", "application/zip": "ZIP", "image/png": "PNG", "image/jpeg": "JPG" };

/** An article's downloads (the episode's case-file PDF, checklists...). Members-only for series episodes. */
export function AttachmentsCard({
  article,
  membersOnly,
  onChange,
}: {
  article: Article;
  membersOnly: boolean;
  onChange: (next: Article) => void;
}): ReactElement {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<number | "upload" | null>(null);

  const upload = async (file: File) => {
    setBusy("upload");
    try {
      onChange(await uploadAttachment(article.id, file, title.trim() || file.name.replace(/\.[^.]+$/, "")));
      setTitle("");
      toast("File added.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the file.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const rename = async (id: number, current: string) => {
    const next = window.prompt("File title (what readers see)", current)?.trim();
    if (!next || next === current) return;
    setBusy(id);
    try {
      onChange(await renameAttachment(id, next));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't rename it.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    setBusy(id);
    try {
      onChange(await deleteAttachment(id));
      toast("File removed.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove it.", "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="side-card">
      <h3>Downloads</h3>
      <p className="side-card__note">
        {membersOnly
          ? "For members only, like the episode. Readers see the titles locked until they join."
          : "Anyone reading the article can download these."}
      </p>
      {article.attachments.length ? (
        <ul className="att-list">
          {article.attachments.map((a) => (
            <li key={a.id}>
              <span className="att-list__kind">{KIND[a.content_type] ?? "FILE"}</span>
              <span className="att-list__name">
                <b>{a.title}</b>
                <small className="muted">
                  {a.filename} · {size(a.size)}
                </small>
              </span>
              <span className="att-list__actions">
                <button type="button" className="link-btn" disabled={busy !== null} onClick={() => void rename(a.id, a.title)}>
                  Rename
                </button>
                <button type="button" className="link-btn link-btn--danger" disabled={busy !== null} onClick={() => void remove(a.id)}>
                  {busy === a.id ? "…" : "Remove"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="editor__field">
        <span>
          Title <small>e.g. The case file (PDF)</small>
        </span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="The case file" />
      </label>
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => input.current?.click()}>
        {busy === "upload" ? "Uploading…" : "Add a file"}
      </button>
      <small className="muted">PDF, PNG, JPG or ZIP, up to 9 MB.</small>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg,application/zip,.zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </section>
  );
}
