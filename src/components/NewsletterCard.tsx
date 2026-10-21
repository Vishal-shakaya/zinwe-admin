import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  getNewsletter,
  retryNewsletter,
  sendNewsletter,
  sendNewsletterTest,
  type Article,
  type NewsletterState,
} from "../lib/blogApi";
import { dateTime } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toast";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Blog editor sidebar: email the article to the confirmed newsletter subscribers (once per
 * article), with a test send to yourself first. Shows live progress while it's going out.
 */
export function NewsletterCard({ article, dirty }: { article: Article; dirty: boolean }): ReactElement {
  const toast = useToast();
  const [state, setState] = useState<NewsletterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState<null | "test" | "retry">(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getNewsletter(article.id);
      setState(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the newsletter status.");
      return null;
    }
  }, [article.id]);

  // Reload when the article changes state (published / scheduled / unpublished) or is renamed.
  useEffect(() => {
    void load();
  }, [load, article.state, article.title]);

  useEffect(() => {
    if (state && !subject) setSubject(state.default_subject);
  }, [state, subject]);

  // Poll while emails are going out.
  const issue = state?.issue ?? null;
  const inFlight = !!issue && issue.status !== "sent" && !issue.waiting_for_publish;
  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

  const test = async () => {
    setBusy("test");
    try {
      const { sent_to } = await sendNewsletterTest(article.id);
      toast(`Test sent to ${sent_to}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send the test.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy("retry");
    try {
      setState(await retryNewsletter(article.id));
      toast("Sending the failed ones again.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't retry.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const draft = article.state === "draft";
  const scheduled = article.state === "scheduled";
  const audience = state?.audience ?? 0;

  return (
    <section className="side-card">
      <h3>
        Newsletter
        <Link to="/blog/subscribers" className="nl-audience" title="Confirmed subscribers">
          {state ? plural(audience, "subscriber") : "…"}
        </Link>
      </h3>

      {error ? <p className="side-card__note is-bad">{error}</p> : null}

      {issue ? (
        <div className="nl-status">
          {issue.waiting_for_publish ? (
            <p className="side-card__note">
              <b>Queued.</b> “{issue.subject}” goes to the subscribers when the article goes live
              {article.published_at ? ` (${dateTime(article.published_at)})` : ""}.
            </p>
          ) : issue.status === "sent" ? (
            <p className="side-card__note">
              <b className="nl-done">✓ Sent</b> to {plural(issue.sent, "subscriber")}
              {issue.finished_at ? ` on ${dateTime(issue.finished_at)}` : ""}.
              {issue.skipped ? ` ${issue.skipped} unsubscribed before their turn.` : ""}
            </p>
          ) : (
            <>
              <p className="side-card__note">
                <b>Sending…</b> {issue.sent} of {issue.total}
              </p>
              <div className="nl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={issue.total} aria-valuenow={issue.sent}>
                <span style={{ width: `${issue.total ? Math.round(((issue.sent + issue.failed + issue.skipped) / issue.total) * 100) : 0}%` }} />
              </div>
            </>
          )}
          {issue.failed ? (
            <p className="side-card__note is-bad">
              {plural(issue.failed, "email")} failed.{" "}
              <button type="button" className="link-btn" disabled={!!busy} onClick={() => void retry()}>
                {busy === "retry" ? "Retrying…" : "Send them again"}
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <label className="editor__field">
            <span>Email subject</span>
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} disabled={draft} />
          </label>
          <p className="side-card__note">
            {article.series
              ? "A series episode goes out as its public opening with a “Read the full case file” button. Each subscriber's link unlocks the episode for them."
              : state?.full_article
                ? "Newsletter articles go out in full, with a link to the website."
                : "Goes out as the title, summary and cover with a “Read” button to the website."}{" "}
            Every email has an unsubscribe link.
          </p>
          {dirty ? <p className="side-card__note is-warn">Save first: emails use the saved version.</p> : null}
          <div className="side-card__actions">
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || dirty} onClick={() => void test()}>
              {busy === "test" ? "Sending…" : "Send test to me"}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!!busy || dirty || draft || audience === 0 || !subject.trim()}
              onClick={() => setConfirming(true)}
            >
              {scheduled ? "Email when live" : "Email subscribers"}
            </button>
          </div>
          {draft ? (
            <p className="side-card__note">Publish or schedule the article to email it.</p>
          ) : state && audience === 0 ? (
            <p className="side-card__note">No confirmed subscribers yet. People sign up on the website's blog.</p>
          ) : null}
        </>
      )}

      {confirming ? (
        <ConfirmDialog
          title={scheduled ? "Email this article when it goes live?" : "Email this article now?"}
          confirmLabel={scheduled ? "Queue the email" : `Email ${plural(audience, "subscriber")}`}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            setState(await sendNewsletter(article.id, subject.trim()));
            toast(scheduled ? "Queued. It goes out when the article is live." : "Sending to the subscribers now.");
          }}
        >
          <p>
            “<b>{subject.trim()}</b>” goes to {scheduled ? "everyone subscribed at that time" : plural(audience, "confirmed subscriber")}.
            Each article can be emailed once, so send yourself a test first if you haven't.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
