insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'glorex-generated-images',
  'glorex-generated-images',
  true,
  20971520,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura pública das artes
create policy "glorex_generated_images_public_read"
on storage.objects for select
to public
using (bucket_id = 'glorex-generated-images');
