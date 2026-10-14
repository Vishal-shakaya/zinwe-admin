import { useEffect, useRef, type ReactElement } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";

export interface RichTextValue {
  /** Semantic HTML (real <ul>/<ol>, no Quill classes) — what the email / article uses. */
  html: string;
  /** Plain text, to tell whether anything was written. */
  text: string;
}

/** Email: only what an email carries well (the server allow-list matches this). */
const EMAIL_TOOLBAR = [
  [{ header: [2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ list: "ordered" }, { list: "bullet" }, "blockquote"],
  ["link", "clean"],
];

/** Article: headings, code and images too (z_blog's allow-list matches this). */
const ARTICLE_TOOLBAR = [
  [{ header: [2, 3, 4, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ list: "ordered" }, { list: "bullet" }, "blockquote", "code-block"],
  ["link", "image"],
  ["clean"],
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
  variant = "email",
  onImageUpload,
}: {
  onChange: (value: RichTextValue) => void;
  placeholder?: string;
  /** Accessible name for the editing area. */
  label: string;
  /** Content to start with (read once, on mount). */
  initialHtml?: string;
  /** "email" (default) or "article" (headings, code, images). */
  variant?: "email" | "article";
  /** Article images: upload the picked file and return its URL (inserted at the cursor). */
  onImageUpload?: (file: File) => Promise<string>;
}): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const uploadRef = useRef(onImageUpload);
  uploadRef.current = onImageUpload;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const editorDiv = document.createElement("div");
    el.appendChild(editorDiv);
    const toolbar = variant === "article" ? ARTICLE_TOOLBAR : EMAIL_TOOLBAR;
    const quill = new Quill(editorDiv, {
      theme: "snow",
      placeholder,
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {
            // Upload instead of Quill's default base64 data URL (huge, and bad for SEO).
            image: () => {
              const upload = uploadRef.current;
              if (!upload) return;
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/png,image/jpeg,image/webp,image/gif";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                const at = quill.getSelection(true)?.index ?? quill.getLength();
                try {
                  const url = await upload(file);
                  quill.insertEmbed(at, "image", url, "user");
                  quill.setSelection(at + 1, 0);
                } catch {
                  /* the caller shows its own error */
                }
              };
              input.click();
            },
          },
        },
      },
    });
    quill.root.setAttribute("aria-label", label);
    quill.root.setAttribute("aria-multiline", "true");
    quill.root.setAttribute("role", "textbox");
    // getSemanticHTML() writes every space as &nbsp;, which stops text wrapping.
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
  }, [placeholder, label, variant]);

  return <div className={"rte" + (variant === "article" ? " rte--article" : "")} ref={host} />;
}
