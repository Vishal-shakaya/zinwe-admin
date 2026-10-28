import { useMemo, useState, type ReactElement } from "react";
import { sendCustomerEmail, type Subscriber } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { RichTextEditor, type RichTextValue } from "../../components/RichTextEditor";
import { EMAIL_TEMPLATES, TEMPLATE_GROUPS, contextFor } from "../../content/emailTemplates";

function fill(row: Subscriber, id: string): { subject: string; html: string } {
  const tpl = EMAIL_TEMPLATES.find((t) => t.id === id);
  return tpl ? tpl.build(contextFor(row)) : { subject: "", html: "" };
}

/** Write and send a custom email (subject + rich text) to one customer, in the branded Zinwe layout. */
export function EmailComposer({
  row,
  onClose,
  onSent,
  initialTemplate = "",
}: {
  row: Subscriber;
  onClose: () => void;
  onSent: () => void;
  /** Start from this template (e.g. "payment_details_needed" for a short-paid payment). */
  initialTemplate?: string;
}): ReactElement {
  const start = useMemo(() => fill(row, initialTemplate), [row, initialTemplate]);
  const [templateId, setTemplateId] = useState(initialTemplate);
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState<RichTextValue>({ html: "", text: "" });
  // The editor is uncontrolled: a template loads by remounting it with new starting content.
  const [editor, setEditor] = useState<{ key: number; html: string }>({ key: 0, html: start.html });
  // What the last template put in, so we only ask before replacing the operator's own edits.
  const [applied, setApplied] = useState<{ subject: string; text: string }>({ subject: start.subject, text: "" });
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const first = (row.full_name || "").split(" ")[0];
  const ready = subject.trim().length > 0 && body.text.length > 0;
  const edited = subject !== applied.subject || body.text !== applied.text;
  const suggested = useMemo(() => EMAIL_TEMPLATES.filter((t) => t.suggest?.(row)), [row]);
  const current = EMAIL_TEMPLATES.find((t) => t.id === templateId) ?? null;

  const apply = (id: string) => {
    setPending(null);
    setTemplateId(id);
    const filled = fill(row, id);
    setSubject(filled.subject);
    setBody({ html: "", text: "" }); // a blank template loads nothing, so clear it here
    setEditor((e) => ({ key: e.key + 1, html: filled.html }));
    // body/applied.text are set by the editor's first onChange after it remounts
    setApplied({ subject: filled.subject, text: "" });
  };

  const choose = (id: string) => {
    if (id === templateId) return;
    if (edited && (subject.trim() || body.text)) setPending(id);
    else apply(id);
  };

  const onBody = (value: RichTextValue) => {
    setBody(value);
    // The first change after a (re)mount is the template itself loading: that's the baseline.
    setApplied((a) => (a.text === "" && editor.html ? { ...a, text: value.text } : a));
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCustomerEmail(row.id, subject.trim(), body.html);
      setSent(true);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The email couldn’t be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Send email"
      subtitle={<>To {row.full_name ? `${row.full_name} <${row.email}>` : row.email}</>}
      onClose={onClose}
      footer={
        sent ? (
          <button type="button" className="btn dark" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <span className="modal__hint">Sent from the Zinwe team with your logo and signature.</span>
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn dark" disabled={busy || !ready} onClick={() => void send()}>
              {busy ? "Sending…" : "Send email"}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <p className="note good" role="status">
          Email sent to {row.email}. It’s listed under Emails on this customer.
        </p>
      ) : (
        <div className="sb-composer">
          <div className="sb-fl">
            <label htmlFor="mail-template">Template</label>
            <select id="mail-template" className="inp" value={pending ?? templateId} onChange={(e) => choose(e.target.value)}>
              <option value="">Blank email</option>
              {suggested.length ? (
                <optgroup label="Suggested for this customer">
                  {suggested.map((t) => (
                    <option key={`s-${t.id}`} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {TEMPLATE_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {EMAIL_TEMPLATES.filter((t) => t.group === group && !suggested.includes(t)).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {pending ? (
              <div className="sb-replace" role="alert">
                <span>Replace your message with “{EMAIL_TEMPLATES.find((t) => t.id === pending)?.label ?? "Blank email"}”?</span>
                <button type="button" className="btn sm" onClick={() => setPending(null)}>
                  Keep mine
                </button>
                <button type="button" className="btn sm dark" onClick={() => apply(pending)}>
                  Replace
                </button>
              </div>
            ) : (
              <span className="k" style={{ fontWeight: 400 }}>
                {current ? current.when : "Start from scratch, or pick a template: it fills in this customer’s details."}
              </span>
            )}
          </div>

          <label className="sb-fl">
            Subject
            <input
              className="inp"
              type="text"
              maxLength={200}
              placeholder="e.g. Your Zinwe plan is ready"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <div className="sb-fl">
            <span>Message</span>
            <RichTextEditor
              key={editor.key}
              label="Message"
              placeholder={first ? `Hi ${first},` : "Hi,"}
              initialHtml={editor.html}
              onChange={onBody}
            />
            {current && /\[[^\]]+\]/.test(body.text) ? (
              <span className="sb-msg sb-msg--warn">Replace the [bracketed] parts before sending.</span>
            ) : null}
          </div>
          {error ? (
            <p className="err-box" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
