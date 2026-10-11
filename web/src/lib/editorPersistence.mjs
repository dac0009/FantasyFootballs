// Keep the acknowledged write even when the independent read-back fails.
// Otherwise retrying an already-saved version produces a misleading conflict.
export async function publishAndVerify(client, kind, key, body, version) {
  const result = await client.rpc('publish_editor_document', {
    p_kind: kind, p_key: key, p_body: body, p_expected_version: version,
  });
  if (result.error) throw result.error;
  const document = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!document?.version || document.kind !== kind || document.key !== key)
    throw new Error('The server did not confirm publication. Refresh saved content before retrying.');
  let verified = false;
  try {
    const read = await client.from('editor_documents').select('*').eq('kind', kind).eq('key', key).single();
    verified = !read.error && read.data?.version === document.version &&
      JSON.stringify(Object.entries(read.data.body).sort()) === JSON.stringify(Object.entries(document.body).sort());
  } catch { /* The write succeeded; a temporary read failure must not erase it. */ }
  return { document, verified };
}
