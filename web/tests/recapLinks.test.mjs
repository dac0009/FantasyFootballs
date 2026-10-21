import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeIssue, encodeIssue, encodeRemoval, linksFor, mergeIssues, parseGoogleLink, parseWeeks, slugFor } from '../src/lib/recapLinks.mjs';

const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing';

test('recognises Docs share links, published links and Drive files, and nothing else', () => {
  assert.deepEqual(parseGoogleLink(DOC), { kind: 'gdoc', id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', published: false });
  assert.deepEqual(parseGoogleLink('https://docs.google.com/document/d/e/2PACX-1vQabcdefghijk/pub'), { kind: 'gdoc', id: '2PACX-1vQabcdefghijk', published: true });
  assert.deepEqual(parseGoogleLink('https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa/view?usp=drive_link'), { kind: 'drive', id: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa', published: false });
  assert.deepEqual(parseGoogleLink('https://drive.google.com/open?id=1ZyXwVuTsRqPoNmLkJiHgFeDcBa'), { kind: 'drive', id: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa', published: false });
  for (const bad of ['', null, 'https://example.com/doc', 'docs.google.com/spreadsheets/d/1abcdefghijklmnop/edit', 'javascript:alert(1)']) {
    assert.equal(parseGoogleLink(bad), null, String(bad));
  }
});

test('a share link yields preview, open, live PDF export, edit and thumbnail URLs on the same Doc ID', () => {
  const links = linksFor(parseGoogleLink(DOC));
  assert.equal(links.embed, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/preview');
  assert.equal(links.download, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=pdf');
  assert.equal(links.edit, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit');
  assert.match(links.thumb, /drive\.google\.com\/thumbnail\?id=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/);
});

test('a published link embeds but cannot export or edit', () => {
  const links = linksFor({ kind: 'gdoc', id: '2PACX-1vQabc', published: true });
  assert.equal(links.embed, 'https://docs.google.com/document/d/e/2PACX-1vQabc/pub?embedded=true');
  assert.equal(links.download, null);
  assert.equal(links.edit, null);
});

test('weeks parse loosely and slugs match the PDF manifest scheme', () => {
  assert.deepEqual(parseWeeks('7'), [7]);
  assert.deepEqual(parseWeeks('5, 6'), [5, 6]);
  assert.deepEqual(parseWeeks('Weeks 8 and 9'), [8, 9]);
  assert.deepEqual(parseWeeks('week 12 (again 12)'), [12]);
  assert.deepEqual(parseWeeks(''), []);
  assert.equal(slugFor(2026, [7]), 'ffbffl-2026-week-7');
  assert.equal(slugFor(2026, [5, 6]), 'ffbffl-2026-weeks-5-6');
  assert.equal(slugFor(2026, [], 'The 2026 Preview!'), 'ffbffl-2026-the-2026-preview');
});

test('encode then decode round-trips, defaults a title, and keys by season and slug', () => {
  const { key, text } = encodeIssue({ url: DOC, season: '2026', weeks: '7', title: '', dek: '  Short summary.  ' });
  assert.equal(key, 'recap.2026.ffbffl-2026-week-7');
  const issue = decodeIssue(key, text);
  assert.equal(issue.slug, 'ffbffl-2026-week-7');
  assert.equal(issue.title, 'Week 7 recap');
  assert.equal(issue.dek, 'Short summary.');
  assert.deepEqual(issue.weeks, [7]);
  assert.equal(issue.link.kind, 'gdoc');
  assert.equal(issue.stored, true);
  assert.equal(issue.pdf, null);
});

test('encode refuses what the site could not use, with a sentence a person can act on', () => {
  assert.throws(() => encodeIssue({ url: 'https://example.com/x', season: 2026, weeks: '1' }), /Google Docs or Drive link/);
  assert.throws(() => encodeIssue({ url: DOC, season: 'last year', weeks: '1' }), /season as a year/);
  assert.throws(() => encodeIssue({ url: DOC, season: 2026, weeks: '', label: '' }), /week number, or a label/);
  assert.throws(() => encodeIssue({ url: DOC, season: 2026, weeks: '1', dek: 'x'.repeat(1300) }), /too long/);
  assert.ok(encodeIssue({ url: DOC, season: 2026, weeks: '', label: 'Preseason preview' }).key.endsWith('ffbffl-2026-issue'));
});

test('a new recap needs a link, but editing an existing one can change details with no link', () => {
  assert.throws(() => encodeIssue({ url: '', season: 2026, weeks: '5, 6', title: 'New' }), /Paste a Google Docs link/);
  const { key, text } = encodeIssue({ url: '', season: 2026, weeks: '5, 6', title: 'The Real Final Cut', slug: 'ffbffl-2026-weeks-5-6' });
  assert.equal(key, 'recap.2026.ffbffl-2026-weeks-5-6');
  const patch = decodeIssue(key, text);
  assert.equal(patch.override, true);
  assert.equal(patch.title, 'The Real Final Cut');
  assert.equal(patch.link, undefined);
});

test('editing pins the slug even when the week text changes, so it updates in place', () => {
  const { key } = encodeIssue({ url: DOC, season: 2026, weeks: '9', title: 'Oops', slug: 'ffbffl-2026-week-7' });
  assert.equal(key, 'recap.2026.ffbffl-2026-week-7');
});

const pdf = (slug, weeks, title) => ({ slug, season: 2026, weeks, title, dek: '', dateLabel: null, label: null, pdf: `${slug}.pdf`, cover: null, docx: null, pages: 2 });
const stored = (key, text) => decodeIssue(key, text);

test('removing a built-in PDF hides it; a new link for that week brings it back', () => {
  const manifest = [pdf('ffbffl-2026-week-3', [3], 'Week 3 PDF'), pdf('ffbffl-2026-week-4', [4], 'Week 4 PDF')];
  const removal = encodeRemoval({ season: 2026, weeks: [3], slug: 'ffbffl-2026-week-3' });
  assert.equal(removal.key, 'recap.2026.ffbffl-2026-week-3');
  const tomb = stored(removal.key, removal.text);
  assert.equal(tomb.removed, true);

  const after = mergeIssues(manifest, [tomb]);
  assert.deepEqual(after.map((i) => i.slug), ['ffbffl-2026-week-4'], 'week 3 is gone, week 4 untouched');

  const readd = encodeIssue({ url: DOC, season: 2026, weeks: '3', title: 'Week 3, new cut', slug: 'ffbffl-2026-week-3' });
  assert.equal(readd.key, removal.key, 'same key, so the link simply replaces the removal');
  const back = mergeIssues(manifest, [stored(readd.key, readd.text)]);
  assert.deepEqual(back.map((i) => i.title).sort(), ['Week 3, new cut', 'Week 4 PDF']);
  assert.equal(back.find((i) => i.slug === 'ffbffl-2026-week-3').link.kind, 'gdoc');
});

test('a link replaces the PDF of the same week, and an override edits a PDF in place', () => {
  const manifest = [pdf('ffbffl-2026-week-4', [4], 'Old title')];
  const link = encodeIssue({ url: DOC, season: 2026, weeks: '4', title: 'From Drive', slug: 'ffbffl-2026-week-4' });
  const viaLink = mergeIssues(manifest, [stored(link.key, link.text)]);
  assert.equal(viaLink.length, 1);
  assert.equal(viaLink[0].title, 'From Drive');
  assert.equal(viaLink[0].pdf, null, 'the committed PDF is no longer what shows');

  const patch = encodeIssue({ url: '', season: 2026, weeks: '4', title: 'Fixed title', slug: 'ffbffl-2026-week-4' });
  const viaPatch = mergeIssues(manifest, [stored(patch.key, patch.text)]);
  assert.equal(viaPatch[0].title, 'Fixed title');
  assert.equal(viaPatch[0].pdf, 'ffbffl-2026-week-4.pdf', 'the PDF stays; only the details changed');
});

test('decode ignores removed, malformed or foreign documents', () => {
  assert.equal(decodeIssue('recap.2026.ffbffl-2026-week-3', ''), null);
  assert.equal(decodeIssue('recap.2026.ffbffl-2026-week-3', '{not json'), null);
  assert.equal(decodeIssue('home.headline', JSON.stringify({ url: DOC, season: 2026, weeks: [3] })), null);
  // No link + no season is unusable; no link + season is a metadata override.
  assert.equal(decodeIssue('recap.2026.x', JSON.stringify({ weeks: [3] })), null);
  assert.equal(decodeIssue('recap.2026.ffbffl-2026-week-3', JSON.stringify({ season: 2026, weeks: [3], title: 'T' })).override, true);
});
