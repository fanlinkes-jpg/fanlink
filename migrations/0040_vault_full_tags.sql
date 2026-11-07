-- URL del archivo y tags jsonb si la columna antigua era texto.
-- Idempotente. No borra filas.

alter table of_vault_item add column if not exists full_url text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'of_vault_item'
      and column_name = 'tags'
      and udt_name <> 'jsonb'
  ) then
    alter table of_vault_item
      alter column tags type jsonb
      using (
        case
          when tags is null or btrim(tags::text) = '' then '[]'::jsonb
          when left(btrim(tags::text), 1) in ('[', '{') then tags::text::jsonb
          else to_jsonb(string_to_array(tags::text, ','))
        end
      );
  end if;
end $$;
