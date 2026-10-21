// Recaps written in Google Docs. The site stores one small JSON document per
// issue (in editor_documents, key "recap.<season>.<slug>") holding the Doc
// link and a little metadata; everything else is read live from Google.
// Plain JavaScript so node:test can exercise the parsing.

export const KEY_PREFIX = 'recap.';
export const MAX_TEXT = 1200; // publish_editor_document's limit for a copy document

const DOC_RE = /docs\.google\.com\/document\/d\/(e\/)?([A-Za-z0-9_-]{10,})/;
const DRIVE_RE = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/;

/** Recognise a Google Docs or Drive link. Returns null for anything else. */
export function parseGoogleLink(url) {
  const text = String(url ?? '').trim();
  let m = text.match(DOC_RE);
  if (m) return { kind: 'gdoc', id: m[2], published: !!m[1] };
  m = text.match(DRIVE_RE);
  if (m) return { kind: 'drive', id: m[1], published: false };
  return null;
}

/** Every URL the site needs for a linked issue. */
export function linksFor(ref) {
  if (ref.kind === 'gdoc' && ref.published) {
    // "Publish to the web" links use a separate token, so there is no export
    // or edit URL to derive. The normal share link is the better one to paste.
    const base = `https://docs.google.com/document/d/e/${ref.id}/pub`;
    return { embed: `${base}?embedded=true`, open: base, download: null, edit: null, thumb: null };
  }
  if (ref.kind === 'gdoc') {
    const base = `https://docs.google.com/document/d/${ref.id}`;
    return {
      embed: `${base}/preview`,
      open: `${base}/view`,
      download: `${base}/export?format=pdf`,
      edit: `${base}/edit`,
      thumb: `https://drive.google.com/thumbnail?id=${ref.id}&sz=w400`,
    };
  }
  return {
    embed: `https://drive.google.com/file/d/${ref.id}/preview`,
    open: `https://drive.google.com/file/d/${ref.id}/view`,
    download: `https://drive.google.com/uc?export=download&id=${ref.id}`,
    edit: null,
    thumb: `https://drive.google.com/thumbnail?id=${ref.id}&sz=w400`,
  };
}

/** "7", "5, 6", "5 and 6", "Weeks 8-9" → [7], [5, 6], [5, 6], [8, 9]. */
export function parseWeeks(text) {
  const found = String(text ?? '').match(/\d{1,2}/g) ?? [];
  return [...new Set(found.map(Number).filter((n) => n >= 1 && n <= 25))];
}

/** Same scheme as scripts/recaps_manifest.py, so a Doc can replace a PDF of the same week. */
export function slugFor(season, weeks, title) {
  if (weeks.length) {
    return `ffbffl-${season}-${weeks.length === 1 ? `week-${weeks[0]}` : `weeks-${weeks.join('-')}`}`;
  }
  const base = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `ffbffl-${season}-${base || 'issue'}`;
}

export function recapKey(season, slug) {
  return `${KEY_PREFIX}${season}.${slug}`;
}

/**
 * The JSON stored for an issue. Throws a readable message when it cannot be.
 *
 * A link (Google Doc / Drive) makes the issue read from there. With no link it
 * is a metadata override: pass `slug` to edit an issue already in the archive
 * (a committed PDF, say) — its title, summary, date or week — without replacing
 * the file. `slug` also pins the key when editing so the entry updates in place
 * rather than forking a new one.
 */
export function encodeIssue({ url, season, weeks, title, dek, dateLabel, label, slug }) {
  const year = Number(season);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Enter the season as a year, like 2026.');
  const wk = Array.isArray(weeks) ? weeks : parseWeeks(weeks);
  if (!wk.length && !String(label ?? '').trim()) throw new Error('Give it a week number, or a label like "Preseason preview".');

  const link = String(url ?? '').trim();
  const ref = link ? parseGoogleLink(link) : null;
  if (link && !ref) throw new Error('That is not a Google Docs or Drive link.');
  if (!link && !slug) throw new Error('Paste a Google Docs link, or edit an existing recap to change its details.');

  const payload = { season: year, weeks: wk };
  if (ref) payload.url = link;
  for (const [key, value] of Object.entries({ title, dek, dateLabel, label })) {
    const clean = String(value ?? '').trim();
    if (clean) payload[key] = clean;
  }
  const text = JSON.stringify(payload);
  if (text.length > MAX_TEXT) throw new Error('That is too long. Shorten the summary.');
  const finalSlug = slug || slugFor(year, wk, title);
  return { key: recapKey(year, finalSlug), text };
}

/**
 * Rebuild a stored entry, or null if unusable. A link entry is a full issue; a
 * link-less entry is a metadata override (`override: true`) that mergeIssues
 * lays over the matching archive issue.
 */
export function decodeIssue(key, text) {
  if (!key.startsWith(KEY_PREFIX) || !text) return null;
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  const season = Number(raw.season);
  if (!Number.isInteger(season)) return null;
  const weeks = Array.isArray(raw.weeks) ? raw.weeks.map(Number).filter(Number.isInteger) : [];
  const slug = key.slice(KEY_PREFIX.length).replace(/^\d{4}\./, '');
  const title = String(raw.title ?? '').trim();
  const dek = String(raw.dek ?? '');
  const dateLabel = raw.dateLabel ? String(raw.dateLabel) : null;
  const label = raw.label ? String(raw.label) : null;

  const ref = parseGoogleLink(raw?.url);
  if (!ref) {
    // Metadata override of an issue already in the archive.
    return { slug, season, weeks, title, dek, dateLabel, label, override: true, stored: true };
  }
  const links = linksFor(ref);
  return {
    slug, season, weeks,
    title: title || (weeks.length ? `Week ${weeks.join(' & ')} recap` : 'Recap'),
    dek, dateLabel, label,
    pdf: null, cover: links.thumb, docx: null, pages: 0,
    link: { kind: ref.kind, id: ref.id, url: String(raw.url), ...links },
    stored: true,
  };
}
