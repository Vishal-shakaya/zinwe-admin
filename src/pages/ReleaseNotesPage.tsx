import { useCallback, useState, type FormEvent, type ReactElement } from "react";
import {
  createReleaseNote,
  deleteReleaseNote,
  getReleaseNotes,
  updateReleaseNote,
  type ReleaseNote,
  type ReleaseNoteInput,
} from "../lib/api";
import { dateTime } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

const STATUS_PILL: Record<ReleaseNote["status"], [string, string]> = {
  live: ["pill--good", "Live"],
  scheduled: ["pill--info", "Scheduled"],
  draft: ["pill--muted", "Draft"],
};

const BODY_HINT = `## What's new
- Show QR code: the UPI QR is made only when you ask for it.
- Reports: your team's week or month, downloadable.

## Fixed
- USB read-only now really stops copying to USB drives.`;

/**
 * "What's new" (FR-21): release notes for customers. Write a draft, publish it, and it shows on zinwe.io/whats-new
 * and in the dashboard (account menu → What's new). The body is plain text: "## " heading, "- " bullet.
 */
export function ReleaseNotesPage(): ReactElement {
  const load = useCallback(() => getReleaseNotes(), []);
  const { data, error, pending, reload } = useLoad(load);
  const toast = useToast();
  const [editing, setEditing] = useState<ReleaseNote | "new" | null>(null);
  const [deleting, setDeleting] = useState<ReleaseNote | null>(null);

  const publish = async (n: ReleaseNote, on: boolean) => {
    try {
      await updateReleaseNote(n.id, { published_at: on ? new Date().toISOString() : null });
      toast(on ? "Published. It's on zinwe.io/whats-new now." : "Unpublished: back to a draft.");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.", "bad");
    }
  };

  return (
    <>
      <PageHeader
        title="What's new"
        subtitle="Release notes for customers, on zinwe.io/whats-new and in the dashboard. Write in plain words: what's fixed and what they can do now."
        onReload={reload}
        pending={pending}
      >
        <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
          New release note
        </button>
      </PageHeader>

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <div className="card empty">
          <b>No release notes yet</b>
          <span className="muted">Write the first one: it stays a draft until you publish it.</span>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Published</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.map((n) => {
                  const [pillClass, pillText] = STATUS_PILL[n.status];
                  return (
                    <tr key={n.id}>
                      <td>
                        <span className="pill pill--muted">Zinwe {n.version}</span> <b>{n.title}</b>
                        {n.summary ? <div className="muted">{n.summary}</div> : null}
                      </td>
                      <td className="nowrap">{n.published_at ? dateTime(n.published_at) : "—"}</td>
                      <td>
                        <span className={`pill ${pillClass}`}>{pillText}</span>
                      </td>
                      <td className="nowrap">
                        <button type="button" className="link-btn" onClick={() => setEditing(n)}>
                          Edit
                        </button>{" "}
                        <button type="button" className="link-btn" onClick={() => void publish(n, n.status === "draft")}>
                          {n.status === "draft" ? "Publish" : "Unpublish"}
                        </button>{" "}
                        <button type="button" className="link-btn" onClick={() => setDeleting(n)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <NoteEditor
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            toast(created ? `Draft "${saved.title}" saved. Publish it when it's ready.` : "Saved.");
            reload();
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteReleaseNote(deleting.id);
            setDeleting(null);
            toast("Deleted.");
            reload();
          }}
        >
          <p>It disappears from the website and the dashboard. This can't be undone.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function NoteEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: ReleaseNote | null;
  onClose: () => void;
  onSaved: (note: ReleaseNote, created: boolean) => void;
}): ReactElement {
  const [form, setForm] = useState<ReleaseNoteInput>({
    version: existing?.version ?? "",
    title: existing?.title ?? "",
    summary: existing?.summary ?? "",
    body: existing?.body ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof ReleaseNoteInput, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.version.trim() || !form.title.trim()) {
      setError("Add the version and a title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = existing ? await updateReleaseNote(existing.id, form) : await createReleaseNote(form);
      onSaved(saved, !existing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? "Edit release note" : "New release note"}
      subtitle="Saved as a draft. Customers see it only after you publish it."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="release-note-form" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </button>
        </>
      }
    >
      <form id="release-note-form" onSubmit={submit} noValidate className="rn-form">
        {error ? <p className="alert alert--bad">{error}</p> : null}
        <label className="field">
          <span>Version</span>
          <input value={form.version} maxLength={20} placeholder="1.1" onChange={(e) => set("version", e.target.value)} />
        </label>
        <label className="field">
          <span>Title</span>
          <input
            value={form.title}
            maxLength={120}
            placeholder="Easier payments, reports and notifications"
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Summary (one or two sentences)</span>
          <input value={form.summary} maxLength={280} onChange={(e) => set("summary", e.target.value)} />
        </label>
        <label className="field">
          <span>Notes ("## " for a heading, "- " for a point)</span>
          <textarea rows={14} value={form.body} placeholder={BODY_HINT} onChange={(e) => set("body", e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}
