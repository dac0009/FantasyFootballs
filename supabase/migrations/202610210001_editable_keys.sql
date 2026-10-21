-- Replaces the hardcoded editable-key list with a format check.
--
-- The previous version enumerated every editable copy key. Any text whose key
-- was missing showed an Edit button (the UI only checks the commissioner role)
-- and then failed at publish with "This text is not editable", and every new
-- page needed a migration before its text could be edited at all.
--
-- Only commissioners reach the copy branch, so the list guarded against typos,
-- not against abuse. Everything else here is unchanged: the same roles, field
-- allow-lists, length limits, version check and revision history.
begin;
create or replace function public.publish_editor_document(p_kind text,p_key text,p_body jsonb,p_expected_version integer)
returns public.editor_documents language plpgsql security definer set search_path = '' as $$
declare
  membership public.editor_memberships;
  result public.editor_documents;
  item record;
  allowed_keys text[];
  max_length integer;
begin
  select * into membership from public.editor_memberships where user_id=auth.uid();
  if auth.uid() is null or membership.user_id is null then
    raise exception 'Your account does not have editing access.' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('profile','copy') or p_key is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid document.' using errcode='22023';
  end if;
  if membership.role <> 'commissioner' and not (p_kind='profile' and p_key=membership.owner_id) then
    raise exception 'You can edit only your own profile.' using errcode='42501';
  end if;
  if p_kind='copy' then
    if p_key !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
      raise exception 'Invalid text key.' using errcode='22023';
    end if;
    allowed_keys := array['text','display'];
    if coalesce(p_body->>'display','custom') not in ('custom','hidden','default') then
      raise exception 'Invalid display mode.' using errcode='22023';
    end if;
  else
    if p_key !~ '^[a-z0-9][a-z0-9-]{0,99}$' then raise exception 'Invalid owner ID.' using errcode='22023'; end if;
    allowed_keys := array['display_name','bio','message','ink','photo'];
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' or octet_length(p_body::text)>310000 then
    raise exception 'Invalid content or photo too large.' using errcode='22023';
  end if;
  for item in select * from jsonb_each(p_body) loop
    if not (item.key = any(allowed_keys)) or jsonb_typeof(item.value)<>'string' then
      raise exception 'Unsupported field.' using errcode='22023';
    end if;
    max_length := case item.key when 'display_name' then 60 when 'bio' then 600 when 'message' then 180
      when 'photo' then 300000 when 'ink' then 7 else case when p_key='home.headline' then 160 else 1200 end end;
    if length(item.value #>> '{}')>max_length then raise exception 'Text exceeds the field limit.' using errcode='22023'; end if;
  end loop;
  if p_kind='profile' then
    if coalesce(p_body->>'ink','') not in ('','#193b48','#324c42','#603d46','#3d4059','#624830') then
      raise exception 'Choose a supported card ink.' using errcode='22023';
    end if;
    if coalesce(p_body->>'photo','')<>'' and (p_body->>'photo') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then
      raise exception 'Upload a supported photo.' using errcode='22023';
    end if;
  end if;
  if p_expected_version=0 then
    insert into public.editor_documents(kind,key,body,version) values(p_kind,p_key,p_body,1)
      on conflict do nothing returning * into result;
  else
    update public.editor_documents set body=p_body, version=version+1,updated_at=clock_timestamp()
      where kind=p_kind and key=p_key and version=p_expected_version returning * into result;
  end if;
  if result.version is null then
    raise exception 'A newer version exists. Save your draft, close the editor, refresh the page, and review the latest version before publishing.' using errcode='40001';
  end if;
  insert into public.editor_revisions(kind,key,body,version,updated_at,edited_by)
    values(result.kind,result.key,result.body,result.version,result.updated_at,auth.uid());
  return result;
end;
$$;
revoke all on function public.publish_editor_document(text,text,jsonb,integer) from public, anon;
grant execute on function public.publish_editor_document(text,text,jsonb,integer) to authenticated;
commit;
