-- Restringir acesso ao bucket público 'glorex-generated-images':
-- leitura pública (o bucket é público e serve imagens),
-- mas NENHUM cliente (anon/authenticated) pode inserir, alterar ou deletar.
-- Toda escrita acontece via service_role no servidor (createServerFn / rota),
-- que bypassa RLS.

CREATE POLICY "Glorex images are publicly readable"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'glorex-generated-images');

CREATE POLICY "Only service role can upload Glorex images"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Only service role can update Glorex images"
ON storage.objects
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "Only service role can delete Glorex images"
ON storage.objects
FOR DELETE
TO anon, authenticated
USING (false);