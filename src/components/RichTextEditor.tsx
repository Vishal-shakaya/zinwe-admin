import { useEffect, useRef, type ReactElement } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";

export interface RichTextValue {
  /** Semantic HTML (real <ul>/<ol>, no Quill classes) — what the email uses. */
  html: string;
  /** Plain text, to tell whether anything was written. */
  text: string;
}

/** Only what an email can carry well (the server allow-list matches this). */
const TOOLBAR = [
  [{ header: [2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ list: "ordered" }, { list: "bullet" }, "blockquote"],
  ["link", "clean"],
];

/**
 * Quill 2 rich-text editor, mounted directly (react-quill doesn't support React 19).
 * Uncontrolled: `onChange` reports the content; remount with a new `key` (and `initialHtml`) to
 * load different content, e.g. a template.
 */
export function RichTextEditor({
  onChange,
  placeholder,
  label,
  initialHtml,
}: {
  onChange: (value: RichTextValue) => void;
  placeholder?: string;
  /** Accessible name for the editing area. */
  label: string;
  /** Content to start with (read once, on mount). */
  initialHtml?: string;
}): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const editorDiv = document.createElement("div");
    el.appendChild(editorDiv);
    const quill = new Quill(editorDiv, { theme: "snow", placeholder, modules: { toolbar: TOOLBAR } });
    quill.root.setAttribute("aria-label", label);
    quill.root.setAttribute("aria-multiline", "true");
    quill.root.setAttribute("role", "textbox");
    // getSemanticHTML() writes every space as &nbsp;, which stops email text from wrapping.
    const emit = () =>
      onChangeRef.current({ html: quill.getSemanticHTML().replace(/&nbsp;/g, " "), text: quill.getText().trim() });
    quill.on("text-change", emit);
    if (initialHtml) {
      quill.clipboard.dangerouslyPasteHTML(initialHtml, "silent");
      emit();
    }
    return () => {
      // StrictMode mounts twice: remove this instance's toolbar + editor so only one remains.
      quill.off("text-change", emit);
      el.innerHTML = "";
    };
    // initialHtml is read once on purpose: callers remount (new key) to load other content.
  }, [placeholder, label]);

  return <div className="rte" ref={host} />;
}
