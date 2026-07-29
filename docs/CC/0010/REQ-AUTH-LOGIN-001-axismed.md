# REQ-AUTH-LOGIN-001 — Login AxisMed con animación de arranque

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0010** |
| Fecha | 2026-07-28 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Mockup (fuente de verdad) | `docs/CC/0010/axismedlogin.html` |
| Pantalla | `/login` |
| Rama | `feat/cc-0010-login-axismed` |

## 1. Requerimiento
Adaptar al sistema la versión AxisMed del login **con todas sus animaciones**: secuencia de arranque (~12.6s: circuito → pulsos → cruz de bloques → wordmark «AxisMed BY AVANTE» → HUD de progreso → dock del logo → tarjeta), tarjeta bilingüe ES/EN, mostrar/ocultar contraseña, «Recordarme» con modal de dispositivo seguro, ingreso biométrico, y paso 2 de selección de sede.

## 2. Diseño
- Animación como componentes React client + CSS module (cero scripts inline — lección CSP #440); datos TRACES/BLOCKS/timeline portados literales del mockup. Tarjeta montada en DOM desde el primer render (smoke de producción). Skip por `prefers-reduced-motion` y `?skipIntro=1` (E2E).
- **Autenticación real conservada**: lockout 5/15min, `signInWithPassword` (Supabase), registro de intentos, errores del callback SSO, `?redirect=`.
- **Paso 2 sede = establecimientos reales** (`organization.listMine`) + Server Action nueva `setEstablishment` (valida membresía vigente; setea `his.org`/`his.estab`). Con 1 sola sede se auto-selecciona y entra directo.
- Fuente Sora vía `next/font` self-hosted, solo en /login. i18n con diccionario local ES/EN (patrón del mockup; no se introdujo librería).

## 3. Desviaciones documentadas
1. **SSO Microsoft se conserva** (no está en el mockup; es login dual productivo).
2. **Biométrico = stub honesto**: banner «disponible próximamente» — WebAuthn no existe en el sistema; no se simula autenticación.
3. Las **4 sedes demo** del mockup (Masferrer/Beethoven/Surf City/Colonia Médica) no se siembran: el select se llena de BD; al crear esas sedes en admin aparecerán solas.
4. Usuario es `type="email"` con label «Usuario (correo)» (el login real es por correo; compat E2E).
5. «Volver» en paso 2 hace `signOut()` real (el mockup era demo sin backend).
6. «Recordarme» es cosmético+auditable (flag localStorage); la sesión Supabase ya persiste por defecto.

## 4. Validación
- Typecheck 9/9, lint, web 554/554, contracts 1,698, trpc 2,677/2,678 (1 flake preexistente de argon2 verificado en aislado 33/33).
- E2E actualizados en el mismo CC: helper de auth (`?skipIntro=1` + paso sede tolerante), auth.spec, a11y specs, 4 specs con login inline, pharmacy-cart.
- UAT técnico en browser real: timeline completa (HUD «LISTO · READY»), wordmark renderizado, inputs presentes desde domcontentloaded, **cero errores de consola / cero violaciones CSP**. Confirmación visual pixel-perfect pendiente de Edwin.
