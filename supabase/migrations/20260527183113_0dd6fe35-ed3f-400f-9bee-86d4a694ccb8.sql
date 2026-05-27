-- O bucket 'glorex-generated-images' é público: arquivos continuam acessíveis
-- pela URL pública /storage/v1/object/public/... sem precisar de policy de SELECT.
-- Remover o SELECT amplo evita listagem do bucket inteiro por anon/authenticated.
-- O servidor (service_role) continua listando normalmente porque bypassa RLS.

DROP POLICY IF EXISTS "Glorex images are publicly readable" ON storage.objects;