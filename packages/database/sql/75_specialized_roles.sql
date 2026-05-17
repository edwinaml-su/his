-- ============================================================================
-- 75_specialized_roles.sql
-- Roles especializados para cirugía, anestesiología, obstetricia y enfermería NRP.
--
-- Motivación: el ABAC ECE requiere distinción granular entre especialidades
-- quirúrgicas (ANEST, GO, PEDIA, ENF_NRP) que el rol genérico ESP no provee.
-- Los permisos ece.cirugia.*, ece.anestesia.*, ece.partograma.*, ece.rn.*
-- y ece.reanimacion.* dependen de estos codes en public.Role.
--
-- Norma: NTEC Anexo B — cada acto médico especializado requiere firma del
-- profesional habilitado para esa competencia.
--
-- Idempotente: ON CONFLICT (organizationId, code) DO NOTHING.
-- ============================================================================

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
VALUES
  -- Anestesiólogo: administra anestesia y controla URPA
  (
    gen_random_uuid(),
    'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid,
    'ANEST',
    'Anestesiólogo',
    'Especialista en anestesiología — administra anestesia, controla URPA (NTEC Anexo B)',
    true,
    now(),
    now()
  ),
  -- Ginecólogo-Obstetra: programa cirugías obstétricas, registra partograma
  (
    gen_random_uuid(),
    'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid,
    'GO',
    'Ginecólogo-Obstetra',
    'Especialista GO — partograma, cesárea, atención del parto (NTEC Anexo B)',
    true,
    now(),
    now()
  ),
  -- Pediatra: firma actas de recién nacido, ejecuta reanimación neonatal
  (
    gen_random_uuid(),
    'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid,
    'PEDIA',
    'Pediatra',
    'Especialista en pediatría/neonatología — firma RN, reanimación (NTEC Anexo B)',
    true,
    now(),
    now()
  ),
  -- Enfermera NRP-certificada: ejecuta protocolo de reanimación neonatal
  (
    gen_random_uuid(),
    'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid,
    'ENF_NRP',
    'Enfermera NRP',
    'Enfermera con certificación NRP — reanimación neonatal (NTEC Anexo B)',
    true,
    now(),
    now()
  )
ON CONFLICT DO NOTHING;
