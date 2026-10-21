import { useState } from "react";
import { useEditorial } from "./Editorial";
import { editorClient } from "../lib/editor";
import { publishAndVerify } from "../lib/editorPersistence.mjs";
import { recapKey, type Issue } from "../lib/recaps";

/**
 * Adding a recap from the site: paste a link to the PDF, give it a title, save.
 * The issue is stored as one editor document, so nothing is committed and no
 * deploy is needed. Commissioner only, same as every other edit.
 */
export function AddIssueForm({ issues }: { issues: Issue[] }) {
  const { member, documents, replace } = useEditorial();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    season: String(new Date().getFullYear()),
    weeks: "",
    label: "",
    title: "",
    dek: "",
    url: "",
    cover: "",
    dateLabel: "",
  });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (member?.role !== "commissioner") return null;

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((old) => ({ ...old, [key]: value }));
    setStatus("");
  };

  function loadForEdit(issue: Issue) {
    setForm({
      season: String(issue.season),
      weeks: issue.weeks.join(", "),
      label: issue.label ?? "",
      title: issue.title,
      dek: issue.dek,
      url: issue.url ?? "",
      cover: issue.cover ?? "",
      dateLabel: issue.dateLabel ?? "",
    });
    setEditing(issue.slug);
    setOpen(true);
    setStatus("");
  }

  function reset() {
    setForm({ season: String(new Date().getFullYear()), weeks: "", label: "", title: "",
      dek: "", url: "", cover: "", dateLabel: "" });
    setEditing(null);
  }

  async function save() {
    if (!editorClient) return setStatus("Supabase is not configured.");
    const season = Number(form.season);
    if (!Number.isFinite(season)) return setStatus("Enter a season year, like 2026.");
    if (!form.title.trim()) return setStatus("Give the issue a title.");
    if (!/^https?:\/\//i.test(form.url.trim())) return setStatus("Paste a link starting with https://");

    const weeks = form.weeks.split(/[,\s]+/).map(Number).filter(Number.isFinite);
    const slug = editing ?? (weeks.length
      ? `week-${weeks.join("-")}`
      : form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
    const key = recapKey(season, slug);

    const payload: Record<string, unknown> = {
      season, weeks, title: form.title.trim(), dek: form.dek.trim(), url: form.url.trim(),
    };
    if (form.cover.trim()) payload.cover = form.cover.trim();
    if (form.label.trim()) payload.label = form.label.trim();
    if (form.dateLabel.trim()) payload.dateLabel = form.dateLabel.trim();

    const text = JSON.stringify(payload);
    if (text.length > 1200) return setStatus("That is too long. Shorten the summary.");

    const existing = documents.find((d) => d.kind === "copy" && d.key === key);
    setBusy(true);
    try {
      const { document: saved } = await publishAndVerify(
        editorClient, "copy", key, { text, display: "custom" }, existing?.version ?? 0,
      );
      replace(saved);
      setStatus(editing ? "Issue updated." : "Issue added.");
      reset();
    } catch (error) {
      const message = (error as { message?: string }).message ?? "Could not save the issue.";
      setStatus(
        message.includes("not editable") || message.includes("Invalid text key")
          ? "The database has not been updated yet. Run the editable-keys migration, then try again."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(issue: Issue) {
    if (!editorClient) return;
    const key = recapKey(issue.season, issue.slug);
    const existing = documents.find((d) => d.kind === "copy" && d.key === key);
    if (!existing) return setStatus("That issue is not stored here.");
    setBusy(true);
    try {
      const { document: saved } = await publishAndVerify(
        editorClient, "copy", key, { text: "", display: "hidden" }, existing.version,
      );
      replace(saved);
      setStatus("Issue removed from the archive.");
    } catch (error) {
      setStatus((error as { message?: string }).message ?? "Could not remove that issue.");
    } finally {
      setBusy(false);
    }
  }

  const stored = issues.filter((i) => i.stored);

  return (
    <section className="add-issue">
      <div className="add-issue-head">
        <span className="section-kicker" style={{ margin: 0 }}>Commissioner</span>
        <button className="pill" type="button" onClick={() => { setOpen(!open); if (open) reset(); }}>
          {open ? "Close" : "Add an issue"}
        </button>
      </div>

      {open ? (
        <form
          className="add-issue-form"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
        >
          <p className="add-issue-help">
            Paste a link to the PDF. A Google Drive link works as long as it is shared with
            “anyone with the link”. The issue appears here as soon as you save, with no deploy.
          </p>
          <div className="add-issue-grid">
            <label>Season<input value={form.season} onChange={(e) => set("season")(e.target.value)} inputMode="numeric" /></label>
            <label>Week or weeks<input value={form.weeks} onChange={(e) => set("weeks")(e.target.value)} placeholder="7  or  5, 6" /></label>
            <label>Date shown<input value={form.dateLabel} onChange={(e) => set("dateLabel")(e.target.value)} placeholder="October 28, 2026" /></label>
          </div>
          <label>Title<input value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="Nobody Is Undefeated" /></label>
          <label>One-line summary<textarea value={form.dek} onChange={(e) => set("dek")(e.target.value)} rows={2} /></label>
          <label>Link to the PDF<input value={form.url} onChange={(e) => set("url")(e.target.value)} placeholder="https://drive.google.com/file/d/..." /></label>
          <div className="add-issue-grid">
            <label>Thumbnail link (optional)<input value={form.cover} onChange={(e) => set("cover")(e.target.value)} placeholder="https://..." /></label>
            <label>Kicker instead of a week (optional)<input value={form.label} onChange={(e) => set("label")(e.target.value)} placeholder="Preseason preview" /></label>
          </div>
          <div className="editor-actions">
            <button className="pill publish-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add to the archive"}
            </button>
            {editing ? <button className="pill" type="button" onClick={reset}>Start a new issue</button> : null}
          </div>
        </form>
      ) : null}

      {open && stored.length ? (
        <div className="add-issue-stored">
          <span className="section-kicker" style={{ margin: "0 0 .4rem" }}>Issues added here</span>
          {stored.map((issue) => (
            <div key={issue.slug} className="add-issue-row">
              <span>{issue.title}</span>
              <span className="pill-row" style={{ margin: 0 }}>
                <button className="pill" type="button" onClick={() => loadForEdit(issue)}>Edit</button>
                <button className="pill" type="button" disabled={busy} onClick={() => void remove(issue)}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {status ? <p role="status" className="add-issue-status">{status}</p> : null}

      <style>{`
        .add-issue {
          border-top: 1px solid var(--color-line-soft);
          border-bottom: 1px solid var(--color-line-soft);
          padding: 0.8rem 0; margin: 1.4rem 0 0;
        }
        .add-issue-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .add-issue-form { margin-top: 1rem; max-width: 44rem; }
        .add-issue-help { font-size: 0.83rem; color: var(--color-mid); margin: 0 0 1rem; line-height: 1.5; }
        .add-issue-grid { display: grid; gap: 0 1rem; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
        .add-issue label { display: block; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.9rem; }
        .add-issue input, .add-issue textarea {
          display: block; width: 100%; margin-top: 0.3rem; padding: 0.55rem;
          background: #f7f1e6; color: #202c30; border: 1px solid var(--color-line);
          font: 400 0.95rem var(--font-body); border-radius: 0;
        }
        .add-issue-stored { margin-top: 0.6rem; max-width: 44rem; }
        .add-issue-row {
          display: flex; justify-content: space-between; align-items: center; gap: 1rem;
          padding: 0.45rem 0; border-bottom: 1px solid var(--color-line-soft); font-size: 0.88rem;
        }
        .add-issue-status { margin: 0.7rem 0 0; font-size: 0.85rem; color: var(--color-mid); }
      `}</style>
    </section>
  );
}
