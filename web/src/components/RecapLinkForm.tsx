import { useState } from "react";
import { useEditorial } from "./Editorial";
import { editorClient } from "../lib/editor";
import { publishAndVerify } from "../lib/editorPersistence.mjs";
import { encodeIssue, parseGoogleLink, recapKey } from "../lib/recapLinks.mjs";
import { weekLabel, type Issue } from "../lib/recaps";

/**
 * The commissioner's way in: paste a Google Doc link, say which week, save.
 * The Doc stays the source of truth; editing it edits the site.
 */
export function RecapLinkForm({ issues }: { issues: Issue[] }) {
  const { member, documents, replace } = useEditorial();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Issue | null>(null);
  const [form, setForm] = useState(blank());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (member?.role !== "commissioner") return null;

  const set = (key: keyof ReturnType<typeof blank>) => (value: string) => {
    setForm((old) => ({ ...old, [key]: value }));
    setStatus(null);
  };
  const ref = parseGoogleLink(form.url);
  const saved = issues.filter((i) => i.stored);

  function startEdit(issue: Issue) {
    setForm({
      url: issue.link?.url ?? "",
      season: String(issue.season),
      weeks: issue.weeks.join(", "),
      title: issue.title,
      dek: issue.dek,
      dateLabel: issue.dateLabel ?? "",
      label: issue.label ?? "",
    });
    setEditing(issue);
    setOpen(true);
    setStatus(null);
  }

  function reset() {
    setForm(blank());
    setEditing(null);
    setStatus(null);
  }

  async function save() {
    if (!editorClient) return setStatus({ ok: false, text: "Saving is not configured on this build." });
    let encoded: { key: string; text: string };
    try {
      encoded = encodeIssue(form);
    } catch (error) {
      return setStatus({ ok: false, text: (error as Error).message });
    }
    // Editing keeps the original key even if the week changed, so the old entry
    // is replaced rather than duplicated.
    const key = editing ? recapKey(editing.season, editing.slug) : encoded.key;
    const existing = documents.find((d) => d.kind === "copy" && d.key === key);
    setBusy(true);
    try {
      const { document } = await publishAndVerify(editorClient, "copy", key, { text: encoded.text, display: "custom" }, existing?.version ?? 0);
      replace(document);
      setStatus({ ok: true, text: editing ? "Updated. The archive shows the change now." : "Added. It is in the archive now." });
      setForm(blank());
      setEditing(null);
    } catch (error) {
      setStatus({ ok: false, text: (error as { message?: string }).message ?? "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(issue: Issue) {
    if (!editorClient) return;
    const key = recapKey(issue.season, issue.slug);
    const existing = documents.find((d) => d.kind === "copy" && d.key === key);
    if (!existing) return setStatus({ ok: false, text: "That issue is not one saved here." });
    setBusy(true);
    try {
      const { document } = await publishAndVerify(editorClient, "copy", key, { text: "", display: "hidden" }, existing.version);
      replace(document);
      setStatus({ ok: true, text: `Removed ${issue.title} from the archive. The Doc itself is untouched.` });
      if (editing?.slug === issue.slug) reset();
    } catch (error) {
      setStatus({ ok: false, text: (error as { message?: string }).message ?? "Could not remove it." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="recap-admin" aria-label="Commissioner tools">
      <div className="recap-admin-head">
        <span className="section-kicker" style={{ margin: 0 }}>Commissioner</span>
        <button type="button" className="pill" onClick={() => (open ? (setOpen(false), reset()) : setOpen(true))}>
          {open ? "Close" : "Add a recap from Google Docs"}
        </button>
      </div>

      {open ? (
        <form className="recap-admin-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <p className="recap-admin-help">
            In Google Docs: <b>Share → General access → Anyone with the link</b>, copy the link, paste it here.
            From then on, editing the Doc edits the site. A Drive link to a PDF works too.
          </p>
          <label>
            Google Docs link
            <input value={form.url} onChange={(e) => set("url")(e.target.value)} placeholder="https://docs.google.com/document/d/…" inputMode="url" autoComplete="off" />
            <small>
              {form.url.trim()
                ? ref
                  ? ref.kind === "gdoc"
                    ? ref.published ? "A published link. It will show, but the normal share link also gives a PDF download." : "Google Doc recognised."
                    : "Drive file recognised."
                  : "That doesn't look like a Google Docs or Drive link yet."
                : "Required."}
            </small>
          </label>
          <div className="recap-admin-grid">
            <label>Week or weeks<input value={form.weeks} onChange={(e) => set("weeks")(e.target.value)} placeholder="7   or   5, 6" inputMode="numeric" /></label>
            <label>Season<input value={form.season} onChange={(e) => set("season")(e.target.value)} inputMode="numeric" /></label>
            <label>Date shown (optional)<input value={form.dateLabel} onChange={(e) => set("dateLabel")(e.target.value)} placeholder="October 28, 2026" /></label>
          </div>
          <label>Headline (optional, otherwise “Week 7 recap”)<input value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="Nobody Is Undefeated" /></label>
          <label>One-line summary (optional)<textarea value={form.dek} onChange={(e) => set("dek")(e.target.value)} rows={2} /></label>
          <label>Kicker instead of a week (optional)<input value={form.label} onChange={(e) => set("label")(e.target.value)} placeholder="Preseason preview" /></label>
          <div className="editor-actions">
            <button className="pill publish-primary" type="submit" disabled={busy || !ref}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add to the archive"}
            </button>
            {editing ? <button className="pill" type="button" onClick={reset}>Cancel</button> : null}
          </div>
        </form>
      ) : null}

      {open && saved.length ? (
        <div className="recap-admin-list">
          <span className="section-kicker" style={{ margin: "0 0 .35rem" }}>From Google Docs</span>
          {saved.map((issue) => (
            <div key={issue.slug} className="recap-admin-row">
              <span>
                {issue.title}
                <small>{issue.season} · {weekLabel(issue)}</small>
              </span>
              <span className="pill-row" style={{ margin: 0 }}>
                {issue.link?.edit ? <a className="pill" href={issue.link.edit} target="_blank" rel="noreferrer">Edit the Doc</a> : null}
                <button className="pill" type="button" onClick={() => startEdit(issue)}>Details</button>
                <button className="pill" type="button" disabled={busy} onClick={() => void remove(issue)}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {status ? <p role="status" className={`recap-admin-status ${status.ok ? "num-pos" : "num-neg"}`}>{status.text}</p> : null}

      <style>{`
        .recap-admin { border-top: 1px solid var(--color-line-soft); border-bottom: 1px solid var(--color-line-soft); padding: 0.8rem 0; margin-top: 1.4rem; }
        .recap-admin-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .recap-admin-form { margin-top: 1rem; max-width: 44rem; }
        .recap-admin-help { font-size: 0.85rem; color: var(--color-mid); margin: 0 0 1rem; line-height: 1.5; }
        .recap-admin-grid { display: grid; gap: 0 1rem; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
        .recap-admin label { display: block; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.9rem; }
        .recap-admin input, .recap-admin textarea {
          display: block; width: 100%; margin-top: 0.3rem; padding: 0.55rem;
          background: #f7f1e6; color: #202c30; border: 1px solid var(--color-line);
          font: 400 0.95rem var(--font-body); border-radius: 0;
        }
        .recap-admin small { display: block; font-weight: 400; color: var(--color-low); margin-top: 0.3rem; }
        .recap-admin-list { margin-top: 0.8rem; max-width: 44rem; }
        .recap-admin-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid var(--color-line-soft); font-size: 0.9rem; }
        .recap-admin-row small { display: block; font-size: 0.74rem; color: var(--color-low); }
        .recap-admin-status { margin: 0.7rem 0 0; font-size: 0.86rem; }
      `}</style>
    </section>
  );
}

function blank() {
  return { url: "", season: String(new Date().getFullYear()), weeks: "", title: "", dek: "", dateLabel: "", label: "" };
}
