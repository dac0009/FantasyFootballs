-- Run after 202610110001_editor.sql. Preserves all accounts, content, and history.
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
    if p_key not in ('home.headline','home.intro','home.announcement','owners.intro','masthead.motto','owner.overview','owner.collection','masthead.title','masthead.folio','section.home.playoffs','section.home.previews','section.home.results','section.home.milestones','section.owner.atlas','section.owner.reel','site.owners.4eaec4bc0f','site.owners.7da7376534','site.owners.03ca718219','site.owners.7ca6b600f7','site.owners.8ca4462842','site.owner.50740e12dd','site.owner.8d737a28b2','site.owner.fc6be537ce','site.owner.71f65d02ce','site.owner.c610923178','site.owner.0fb6b65380','site.owner.97bc4fce44','site.owner.d5c387bd16','site.owner.21786adbbf','site.owner.87ba229d10','site.owner.d31ade071b','site.owner.ac650dd364','site.home.66d5b26fa7','site.home.6a2e3939ab','site.home.bca763cdb7','site.current-season.309540999a','site.current-season.72d75f378e','site.current-season.4f5e312460','site.current-season.6000f5f95e','site.current-season.7231f925cb','site.current-season.248ce2b699','site.current-season.4ead4c84c6','site.current-season.0bc30f84f8','site.current-season.ead0f2d10e','site.current-season.b5ec543fe5','site.current-season.985d56387d','site.current-season.bc54c90b38','site.current-season.c170d8a1b4','site.records.25bf322f41','site.season-index.3f4b988f74','site.season-index.bcc04d7949','site.season-index.27d882d46a','site.season.3f4b988f74','site.season.d5c387bd16','site.season.7d75266a53','site.season.db7921b694','site.season.191f4bfb21','site.season.a8dc4be9da','site.week.b5b2a49247','site.week.c53b879f49','site.week.f2790e6031','site.week.566b262117','site.week.89afda9c44','site.week.64b4f3c729','site.head-to-head.c3d4740257','site.head-to-head.8e28804df6','site.head-to-head.883f9c8353','site.head-to-head.b7196d1f5a','site.head-to-head.d6f5973c87','site.head-to-head.6aac22fb7c','site.playoffs.fd90ffab10','site.playoffs.f8acd4ea8b','site.playoffs.6d121109b5','site.playoffs.d2add6608b','site.playoffs.0f94899f7b','site.playoffs.54e31d8091','site.playoffs.9c7763be1f','site.playoffs.e7033b9620','site.drafts.3b0ba980b2','site.drafts.84c064c9e6','site.drafts.42886d1f3d','site.owner-almanac.e2feb288df','site.owner-career-atlas.f088727463') then
      raise exception 'This text is not editable.' using errcode='22023';
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
