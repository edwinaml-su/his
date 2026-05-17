# ADR 0010 — Firma Electronica Simple (Fase 2 — ECE)

- **Estado:** Propuesto → Aceptado al merge
- **Fecha:** 2026-05-16
- **Decisores:** @AS (proponente), @AE, @Dev, Legal Avante
- **Fase:** Fase 2 — Enfermeria y Continuidad de Expediente (ECE)
- **Dependencias:**
  - `docs/02_arquitectura_software.md` — blueprint hexagonal
  - TDR §4.17 + §4.23 — requisito legal firma electronica simple
  - ADR 0004 (Inmutabilidad post-firma de notas clinicas) — contexto de uso
- **Wave:** Beta / Stream 28 — F2-S1 Firma Electronica

---

## Contexto

La Norma Tecnica de Expediente Clinico (NTEC) Arts. 4.17 y 4.23 establece que todo
acto clinico con valor juridico requiere la **firma electronica simple** del profesional
responsable. Esto aplica a: notas de evolucion, ordenes medicas, resultados de
laboratorio firmados, consentimientos informados digitales, y cualquier documento que
el TDR clasifique como acto clinico.

HIS Multipaís corre en un contexto hospitalario salvadoreno donde:

- **No existe una PKI institucional desplegada.** El Ministerio de Hacienda SV opera
  una para DTE (ADR 0006), pero no para actos clinicos internos.
- **La NTEC no exige firma electronica avanzada (FEA) ni certificados X.509** para
  expediente interno. Solo exige firma electronica simple con identificacion del
  firmante y vinculacion criptografica al documento.
- **El perfil de usuario es personal clinico** (medicos, enfermeras, farmaceuticos)
  que ya autentican por SSO (Supabase Auth). Un segundo factor debe tener friccion
  minima para no interrumpir flujos criticos como triage o emergencias.
- **Multiples dispositivos compartidos** en sala clinica: terminales en nurses station,
  tablets de visita medica. Un factor biometrico requerira lector de huella por
  dispositivo — inviable sin inversion de hardware.

---

## Decision

**PIN de 6 a 12 digitos + argon2id + salt + cache de sesion de 15 min server-side.
Sin PKI, sin certificados X.509.**

El profesional configura su PIN de firma una unica vez (flujo de enrollment). Cuando
el sistema requiere la firma de un acto clinico, el usuario ingresa su PIN; el backend
verifica contra el hash almacenado y emite un **token de sesion de firma** valido
15 minutos. Dentro de esa ventana, el usuario puede firmar actos adicionales sin
re-ingresar el PIN (UX clinica). Al expirar, se requiere re-autenticacion con PIN.

La firma del acto clinico se materializa como un registro en `ece.firma_electronica`
con:

- `signer_user_id` — identificacion del profesional.
- `document_type` + `document_id` — referencia al acto firmado.
- `signed_at` — timestamp con zona (America/El_Salvador).
- `ip_address` — contexto de red del firmante.
- `signature_hash` — SHA-256(signer_user_id || document_type || document_id || signed_at || server_secret).
- Registro inmutable (el trigger de audit hash chain del TDR §6.3 aplica).

---

## Alternativas consideradas

### A1. Huella biometrica (descartada)

**Idea:** lector de huella en cada terminal; el hash de la huella actua como
autenticador de firma.

**Razon de rechazo:**

- Requiere hardware dedicado en cada punto de atencion (estimado: 40-80 terminales
  en el Complejo Hospitalario). Costo capex no presupuestado en Fase 2.
- Friccion de enrollment biologico (usuarios con condiciones dermatologicas, guantes
  de latex en UCI, trauma en manos).
- APIs biometricas de navegador (Web Authentication API con biometrics) aun no estan
  estandarizadas de forma consistente en los navegadores usados en sala clinica.
- La NTEC no la exige; sobreingenieria regulatoria.

### A2. Certificado X.509 / firma electronica avanzada (descartada)

**Idea:** emitir certificados X.509 por usuario; la firma clinica es una operacion
RSA/ECDSA sobre el hash del documento.

**Razon de rechazo:**

- Requiere una CA interna o contratar una CA reconocida por el MINSAL SV — no
  existe en el roadmap de Fase 2.
- Ciclo de vida de certificados (emision, renovacion, revocacion) agrega carga
  operacional a IT que no esta dimensionada.
- La NTEC Art. 4.17 no exige nivel de firma avanzada para expediente clinico interno.
  La firma avanzada aplica solo a documentos de intercambio externo (ej. referencia
  MINSAL), fuera del scope de esta ADR.
- Overkill arquitectonico para el problema actual (referencia: Newman, *Building
  Microservices* 2a ed., cap. 11 — "security should match threat model").

### A3. TOTP (Time-based One-Time Password) (descartada)

**Idea:** el profesional usa Google Authenticator / Authy; el TOTP de 6 digitos
actua como firma.

**Razon de rechazo:**

- Doble factor: el usuario ya se autenticó por SSO (Supabase Auth). Exigir TOTP
  en cada firma es un tercer factor de hecho.
- En escenarios de urgencia clinica (emergencias, codigo rojo), buscar el telefono
  para obtener el TOTP es un riesgo para el paciente.
- El PIN pre-configurado con cache de 15 min ofrece nivel de seguridad suficiente
  para la firma simple sin romper el flujo de atencion.

---

## Consecuencias

### Positivas

- **Cumplimiento NTEC Art. 4.17 + 4.23:** PIN firmante + registro inmutable
  satisfacen los requisitos de identificacion y vinculacion criptografica al acto.
- **Friccion aceptable:** el clinico ingresa el PIN una vez y opera durante 15 min.
  Flujos criticos (triage, emergencias) no se interrumpen.
- **Sin dependencias de infraestructura nueva:** argon2id disponible como libreria
  npm (`@node-rs/argon2`); el cache de sesion usa la tabla `ece.firma_session_cache`
  en Postgres (misma BD, sin Redis adicional en Fase 2).
- **Auditabilidad completa:** cada firma registrada en `ece.firma_electronica` con
  hash chain (TDR §6.3); la cadena es verificable por el auditIntegrityRouter.
- **Evolucion posible:** si en fases futuras el MINSAL exige FEA, el modulo
  `packages/infrastructure/src/firma/` puede reemplazar la implementacion interna
  sin cambiar el contrato de API del router.

### Negativas / trade-offs

- **PIN puede ser olvidado:** mitigado por flujo de recovery via email (OTP de un
  solo uso, 10 min TTL) + confirmacion por MFA del SSO existente.
- **PIN puede ser compartido entre colegas (shoulder-surfing o confianza):** riesgo
  operacional; mitigado por politica RH + audit log de IP por firma + alertas de
  firma desde IPs inusuales (Beta futura).
- **Cache de 15 min:** si un terminal queda desatendido con sesion de firma activa,
  un tercero podria firmar en nombre del profesional. Mitigado por bloqueo de
  pantalla del SO (politica IT) y por el registro de IP en cada firma individual.
- **argon2id en Node.js agrega ~80-150 ms por verificacion:** aceptable para una
  operacion de firma que no es hot path. El cache de 15 min elimina la verificacion
  en firmas subsecuentes.

---

## Diseno de implementacion

### Paquetes y modulos

```
packages/infrastructure/src/firma/
  pin-hasher.ts          # argon2id hash + verify (wrapper @node-rs/argon2)
  session-cache.ts       # leer/escribir ece.firma_session_cache + TTL 15 min
  signature-builder.ts   # construye signature_hash del acto clinico
  recovery.ts            # genera OTP recovery + invalida PIN existente
```

### Tablas Postgres

```sql
-- Configuracion de PIN por usuario
ece.firma_config (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id),
  pin_hash        TEXT NOT NULL,          -- argon2id output (~96 chars)
  salt            TEXT NOT NULL,          -- salt individual por usuario
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at TIMESTAMPTZ,
  organization_id UUID NOT NULL REFERENCES "Organization"(id)
)

-- Cache de sesion de firma (limpieza por TTL)
ece.firma_session_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  session_token   TEXT NOT NULL UNIQUE,   -- token opaco emitido al verificar PIN
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,   -- created_at + 15 min
  invalidated_at  TIMESTAMPTZ,            -- cierre explícito de sesion
  organization_id UUID NOT NULL REFERENCES "Organization"(id)
)

-- Registro inmutable de firmas de actos clinicos
ece.firma_electronica (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_user_id  UUID NOT NULL REFERENCES auth.users(id),
  document_type   TEXT NOT NULL,          -- 'clinical_note', 'medication_order', etc.
  document_id     UUID NOT NULL,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address      INET,
  signature_hash  TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES "Organization"(id)
  -- trigger audit hash chain aplica (TDR §6.3)
)
```

### Contrato de API (tRPC — router `firmaRouter`)

```ts
// Enrollment inicial
firma.enrollPin(input: { pin: string })       // solo una vez por usuario
firma.changePin(input: { currentPin: string; newPin: string })
firma.recoverPin(input: { recoveryOtp: string; newPin: string })

// Sesion de firma
firma.initSession(input: { pin: string })     // devuelve sessionToken (15 min)
firma.signDocument(input: {
  sessionToken: string;
  documentType: string;
  documentId: string;
})                                            // inserta en ece.firma_electronica

// Verificacion (uso interno por otros routers)
firma.verifySignature(input: {
  documentType: string;
  documentId: string;
})                                            // devuelve firma + firmante + timestamp
```

Todos los procedures usan `requireRole(["PHYSICIAN", "NURSE", "PHARMACIST", ...])`.
`signDocument` valida que `sessionToken` no haya expirado ni sido invalidado antes
de insertar el registro de firma.

### Parametros argon2id (configuracion)

| Parametro        | Valor          | Razon                                      |
|------------------|----------------|--------------------------------------------|
| `memoryCost`     | 65536 (64 MiB) | OWASP recomendacion minima para argon2id   |
| `timeCost`       | 3 iteraciones  | Balance seguridad / latencia en Node.js    |
| `parallelism`    | 1              | Single-threaded en funciones edge Vercel   |
| `hashLength`     | 32 bytes       | 256 bits suficiente para PIN               |
| `saltLength`     | 16 bytes       | 128 bits; generado con `crypto.randomBytes`|

---

## Referencias

- NTEC (Norma Tecnica de Expediente Clinico) Arts. 4.17, 4.23 — requisito firma electronica simple
- ADR 0004 — Inmutabilidad post-firma de notas clinicas (patron de uso de `ece.firma_electronica`)
- ADR 0006 — DTE Hacienda (ejemplo de FEA donde si se requiere X.509 — contraste deliberado)
- TDR §6.3 — Audit hash chain (aplica a tabla `ece.firma_electronica`)
- OWASP Password Storage Cheat Sheet — parametros argon2id
- Newman, *Building Microservices* (2a ed.), cap. 11 — "security should match threat model"
- Vernon, *Implementing Domain-Driven Design*, cap. 6 — Value Objects (PIN como VO inmutable)
- `packages/infrastructure/src/firma/` — implementacion (proxima wave)
- `packages/database/sql/` — migration ECE firma electronica (proxima wave)
