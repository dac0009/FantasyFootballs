import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeIssue, encodeIssue, linksFor, parseGoogleLink, parseWeeks, slugFor } from '../src/lib/recapLinks.mjs';

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

test('decode ignores removed, malformed or foreign documents', () => {
  assert.equal(decodeIssue('recap.2026.ffbffl-2026-week-3', ''), null);
  assert.equal(decodeIssue('recap.2026.ffbffl-2026-week-3', '{not json'), null);
  assert.equal(decodeIssue('recap.2026.ffbffl-2026-week-3', JSON.stringify({ url: 'https://example.com', season: 2026, weeks: [3] })), null);
  assert.equal(decodeIssue('home.headline', JSON.stringify({ url: DOC, season: 2026, weeks: [3] })), null);
});
