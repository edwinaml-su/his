/**
 * US-2.3 — router de administración de usuarios.
 *
 * Endpoints:
 *   - listAll          : paginado, filtros (active, roleCode, search por email/nombre).
 *                         Incluye `authStatus` por usuario (ver abajo).
 *   - get              : detalle + roles vigentes/históricos + authStatus.
 *   - create           : FUNCIONAL (CC-0019) — crea la cuenta en Supabase Auth
 *                         + el User local + envía invitación por email.
 *   - update           : edita fullName / active.
 *   - deactivate       : soft-disable (active=false). No borra.
 *   - assignRole       : crea UserOrganizationRole con validFrom=now (idempotente).
 *   - revokeRole       : setea validTo=now en la membresía vigente.
 *   - resendInvitation : reenvía el enlace de acceso; provisiona la cuenta
 *                         Auth si faltaba (cubre huérfanos de listSinCuentaAuth).
 *   - listSinCuentaAuth: usuarios locales activos SIN fila en `auth.users`.
 *
 * Invitation flow (CC-0019, funcional — reemplaza el stub Sprint 1):
 *   `create` (1) crea la cuenta en Supabase Auth (`auth.users`, SIN password,
 *   vía Admin API REST — ver `../lib/supabase-admin.ts`), (2) crea el `User`
 *   local, (3) genera un enlace de tipo `recovery` (GoTrue `generate_link`,
 *   que NO envía email) y (4) lo entrega por el SMTP M365 propio del
 *   proyecto (`sendMail` de `@his/infrastructure`). El usuario abre el
 *   enlace en `/recover/reset` (mecanismo YA probado — evento
 *   `PASSWORD_RECOVERY` de supabase-js) y fija su contraseña.
 *
 *   Si el paso (2) falla, se compensa borrando la cuenta Auth recién creada
 *   (best-effort, solo si la creamos nosotros — no si reutilizamos una
 *   huérfana preexistente). Si el paso (4) falla, el usuario queda creado
 *   pero sin invitar — `resendInvitation` lo resuelve.
 *
 *   Mapeo `User` (local) ↔ `auth.users`: por EMAIL, no por id (mismo patrón
 *   que `resetPassword` y el callback SSO — los ids son independientes;
 *   `User.id` sigue siendo `@default(uuid())` de Prisma).
 *
 * El schema Prisma NO se modifica (sin columnas nuevas — `authStatus` se
 * deriva en cada query, no se persiste).
 *
 * R02 (auditoría RLS externa) — decisión (c) para TODO el router, NO usa
 * `withTenantContext`. Verificado en prod (2026-08-22, psql read-only vía
 * DIRECT_URL) antes de decidir:
 *   1) `auth.users` / `auth.identities` NO tienen NINGÚN grant para el rol
 *      `authenticated` (ni SELECT). `listAll`, `get`, `create`,
 *      `resetPassword`, `resendInvitation` y `listSinCuentaAuth` leen o
 *      escriben esas tablas por SQL crudo — demotar el rol haría fallar esas
 *      queries con "permission denied", tumbando la administración de
 *      usuarios completa (incluida la única vía de recuperación de acceso).
 *   2) La policy RLS `user_self_modify` de `public."User"` es
 *      `id = current_user_id()` para TODOS los comandos (`*`) — diseñada
 *      para autoservicio de perfil, no para administración. Bajo rol
 *      demotado, `update`/`deactivate`/`create` (INSERT de un usuario nuevo,
 *      distinto de `current_user_id()`) fallarían el `WITH CHECK` siempre
 *      que el admin edite a OTRO usuario, que es el caso de uso normal de
 *      este router.
 *   3) La policy `tenant_isolation_select` de `public."Role"` es
 *      `organizationId = current_org_id()` sin cláusula para roles globales
 *      (`organizationId IS NULL`) — `assignRole` soporta explícitamente
 *      roles globales (línea ~625), y quedarían invisibles bajo RLS.
 *   Conclusión: este router es estructuralmente incompatible con la
 *   democión de rol tal como están diseñadas hoy las policies de `User` y
 *   `Role`. Cerrar esto requiere una policy nueva tipo "ADMIN con
 *   user.manage puede tocar cualquier fila de su org" (@DBA/@AS), no un
 *   cambio unilateral de @Dev — se documenta como pendiente en el reporte
 *   de este lote, no se fuerza aquí.
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import type { PrismaClient } from "@prisma/client";
import {
  userAdminListAllInput,
  userAdminGetInput,
  userAdminCreateInput,
  userAdminUpdateInput,
  userAdminDeactivateInput,
  userAdminAssignRoleInput,
  userAdminRevokeRoleInput,
  userAdminResetPasswordInput,
  userAdminResendInvitationInput,
  type UserAuthStatus,
} from "@his/contracts";
import { hashPin, logger, sendMail } from "@his/infrastructure";
import { router, tenantProcedure, requirePermission } from "../trpc";
import {
  createAuthUser,
  deleteAuthUser,
  generateAuthActionLink,
} from "../lib/supabase-admin";

/** Base pública de la app — usada para construir el `redirectTo` del enlace. */
function resolveAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function buildInvitationEmailHtml(opts: { fullName: string; actionLink: string }): string {
  return `<!doctype html>
<html lang="es">
  <body style="font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #111;">
    <div style="max-width: 560px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px;">
      <h1 style="margin: 0 0 12px; font-size: 22px;">Bienvenido(a) a HIS Avante</h1>
      <p>Hola ${escapeHtml(opts.fullName)},</p>
      <p>Se creó una cuenta para vos en el sistema HIS Avante. Para activarla, define tu contraseña
        en el siguiente enlace (válido por tiempo limitado):</p>
      <p style="margin: 20px 0;">
        <a href="${opts.actionLink}" style="display:inline-block;background:#111827;color:#fff;
          padding:10px 18px;border-radius:6px;text-decoration:none;">Definir mi contraseña</a>
      </p>
      <p style="font-size: 12px; color: #888;">
        Si no reconoces esta solicitud, ignora este correo — la cuenta no se activará sin
        completar este paso.
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Asegura que exista una cuenta Supabase Auth para `email`: reutiliza una
 * existente (huérfano de un intento previo, o pre-provisionada por otro
 * flujo) o crea una nueva. GoTrue no permite dos cuentas con el mismo email,
 * así que "reutilizar" es la única opción segura cuando ya existe.
 */
async function provisionAuthAccount(
  prisma: Pick<PrismaClient, "$queryRaw">,
  email: string,
): Promise<{ authUserId: string; createdAuthAccount: boolean }> {
  const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM auth.users
    WHERE lower(email) = lower(${email}) AND deleted_at IS NULL
    LIMIT 1
  `;
  const existing = existingRows[0];
  if (existing) {
    logger.warn(
      { event: "user.create.auth_reused", email, authUserId: existing.id },
      "Reutilizando cuenta Supabase Auth existente (huérfano previo o pre-provisionada).",
    );
    return { authUserId: existing.id, createdAuthAccount: false };
  }

  try {
    const created = await createAuthUser(email);
    return { authUserId: created.id, createdAuthAccount: true };
  } catch (err) {
    logger.error(
      {
        event: "user.create.auth_failed",
        email,
        error: err instanceof Error ? err.message : String(err),
      },
      "No se pudo crear la cuenta en Supabase Auth.",
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "No se pudo crear la cuenta de autenticación (Supabase Auth). No se creó ningún registro. Intenta de nuevo.",
    });
  }
}

/** Genera el enlace de "fijar contraseña" y lo envía por el SMTP M365 del proyecto. */
async function sendAccountInvitation(email: string, fullName: string): Promise<void> {
  const actionLink = await generateAuthActionLink({
    type: "recovery",
    email,
    redirectTo: `${resolveAppOrigin()}/recover/reset`,
  });
  await sendMail({
    to: email,
    subject: "Tu cuenta en HIS Avante — define tu contraseña",
    html: buildInvitationEmailHtml({ fullName, actionLink }),
    tags: { source: "user-admin-invite" },
  });
}

/** Deriva el estado de la cuenta Auth a partir de `last_sign_in_at`. */
function deriveAuthStatus(authRow: { lastSignInAt: Date | null } | undefined): UserAuthStatus {
  if (!authRow) return "SIN_CUENTA";
  return authRow.lastSignInAt ? "ACTIVO" : "INVITADO";
}

function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un usuario con ese email.",
      });
    }
    if (err.code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Recurso no encontrado." });
    }
  }
  throw err;
}

export const userAdminRouter = router({
  /**
   * Listado paginado de usuarios. El alcance es global por simplicidad MVP
   * (TODO Sprint 2: filtrar por usuarios visibles a la org del tenant).
   */
  listAll: tenantProcedure.input(userAdminListAllInput).query(async ({ ctx, input }) => {
    const where: Prisma.UserWhereInput = {};
    if (input.active !== undefined) where.active = input.active;
    if (input.search) {
      where.OR = [
        { email: { contains: input.search, mode: "insensitive" } },
        { fullName: { contains: input.search, mode: "insensitive" } },
      ];
    }
    if (input.roleCode) {
      where.roles = {
        some: {
          role: { code: input.roleCode },
          validFrom: { lte: new Date() },
          OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
        },
      };
    }

    const total = await ctx.prisma.user.count({ where });
    const skip = (input.page - 1) * input.pageSize;

    const users = await ctx.prisma.user.findMany({
      where,
      orderBy: [{ active: "desc" }, { fullName: "asc" }],
      skip,
      take: input.pageSize,
      select: {
        id: true,
        email: true,
        fullName: true,
        active: true,
        mfaEnabled: true,
        lastLoginAt: true,
        _count: { select: { roles: true } },
      },
    });

    // Conteo de roles VIGENTES por usuario (más fiel que _count.roles total).
    const now = new Date();
    const liveRoles = await ctx.prisma.userOrganizationRole.groupBy({
      by: ["userId"],
      where: {
        userId: { in: users.map((u) => u.id) },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      _count: { _all: true },
    });
    const liveByUser = new Map<string, number>(
      liveRoles.map((r) => [r.userId, r._count._all]),
    );

    // CC-0019 — estado de la cuenta Supabase Auth por email (batch, 1 query
    // extra por página; no persistido — ver `deriveAuthStatus`).
    const lowerEmails = users.map((u) => u.email.toLowerCase());
    const authRows = lowerEmails.length
      ? await ctx.prisma.$queryRaw<Array<{ email: string; lastSignInAt: Date | null }>>`
          SELECT lower(email) AS email, last_sign_in_at AS "lastSignInAt"
          FROM auth.users
          WHERE lower(email) = ANY(${lowerEmails}::text[]) AND deleted_at IS NULL
        `
      : [];
    const authByEmail = new Map(authRows.map((r) => [r.email, r]));

    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        active: u.active,
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt,
        activeRoleCount: liveByUser.get(u.id) ?? 0,
        totalRoleCount: u._count.roles,
        authStatus: deriveAuthStatus(authByEmail.get(u.email.toLowerCase())),
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /** Detalle de un usuario con todas sus membresías (vigentes e históricas). */
  get: tenantProcedure.input(userAdminGetInput).query(async ({ ctx, input }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: input.id },
      include: {
        roles: {
          orderBy: [{ validTo: "asc" }, { validFrom: "desc" }],
          include: {
            role: { select: { id: true, code: true, name: true, organizationId: true } },
            organization: { select: { id: true, tradeName: true, legalName: true } },
          },
        },
      },
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });

    // CC-0019 — estado de la cuenta Supabase Auth (por email).
    const authRows = await ctx.prisma.$queryRaw<Array<{ lastSignInAt: Date | null }>>`
      SELECT last_sign_in_at AS "lastSignInAt" FROM auth.users
      WHERE lower(email) = lower(${user.email}) AND deleted_at IS NULL
      LIMIT 1
    `;
    const authStatus = deriveAuthStatus(authRows[0]);

    const now = new Date();
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      active: user.active,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      authStatus,
      roles: user.roles.map((m) => ({
        id: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        roleId: m.roleId,
        validFrom: m.validFrom,
        validTo: m.validTo,
        active: m.validFrom <= now && (m.validTo === null || m.validTo >= now),
        role: m.role,
        organization: m.organization,
      })),
    };
  }),

  /**
   * Alta de usuario end-to-end (CC-0019): crea la cuenta en Supabase Auth
   * (sin password), crea el `User` local y envía la invitación por email
   * (enlace de "fijar contraseña"). Ver cabecera del archivo.
   *
   * Gate: `user.manage` (antes `tenantProcedure` sin rol — CC-0019 lo cierra
   * porque `create` ahora crea cuentas de autenticación reales, mismo nivel
   * de sensibilidad que `resetPassword`).
   *
   * Si el email ya existe en `public.User`, CONFLICT (chequeo explícito
   * ANTES de tocar Supabase Auth — evita crear una cuenta Auth huérfana).
   */
  create: requirePermission("user.manage")
    .input(userAdminCreateInput)
    .mutation(async ({ ctx, input }) => {
      const dupeLocal = await ctx.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (dupeLocal) {
        throw new TRPCError({ code: "CONFLICT", message: "Ya existe un usuario con ese email." });
      }

      const { authUserId, createdAuthAccount } = await provisionAuthAccount(
        ctx.prisma,
        input.email,
      );

      try {
        const user = await ctx.prisma.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            active: true,
            mfaEnabled: false,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        });

        const invitationSent = await sendAccountInvitation(input.email, input.fullName)
          .then(() => true)
          .catch((err) => {
            logger.error(
              {
                event: "user.create.invite_failed",
                userId: user.id,
                email: input.email,
                error: err instanceof Error ? err.message : String(err),
              },
              "Usuario creado pero la invitación por email falló. Usa 'Reenviar invitación'.",
            );
            return false;
          });

        return { ...user, authCreated: true as const, invitationSent };
      } catch (err) {
        // Compensación: solo si la cuenta Auth la creamos en este request
        // (no si reutilizamos una huérfana preexistente — esa no es nuestra).
        if (createdAuthAccount) {
          await deleteAuthUser(authUserId);
        }
        rethrowPrisma(err);
      }
    }),

  update: tenantProcedure.input(userAdminUpdateInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.prisma.user.update({
        where: { id: input.id },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedBy: ctx.user.id,
        },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /**
   * Reset de password por ADMIN.
   *
   * FUNCIONAL: escribe la contraseña en **Supabase Auth** (`auth.users`), que es
   * lo que el login (`supabase.auth.signInWithPassword`) realmente verifica. Para
   * usuarios SSO (provider azure/oidc sin password local) crea además la
   * identidad `email`, habilitando login dual (email/password + SSO).
   *
   * (El write a `UserCredential` PASSWORD se mantiene como rastro de auditoría
   * local — NO es lo que valida el login. Lección Beta.22: el reset previo solo
   * tocaba UserCredential y el "éxito" no afectaba el login real.)
   *
   * Seguridad:
   *   - No puedes resetear tu propio password con esta mutation (usa el flujo
   *     de cambio propio que valida el password anterior).
   *   - El usuario destino debe existir, estar activo y tener cuenta en
   *     Supabase Auth (invitación/SSO completada al menos una vez).
   *   - Hash Supabase Auth: bcrypt vía `extensions.crypt`/`gen_salt('bf',10)`
   *     (mismo algoritmo que GoTrue verifica).
   *   - Auditoría: emite evento `user.password_reset` con razón.
   *
   * CC-0017 — prueba de concepto #3 de `requirePermission`: resuelve el TODO
   * histórico ("gate por requireRole(['ADMIN']) cuando el helper esté
   * disponible") reemplazando el chequeo manual de `UserOrganizationRole` por
   * el permiso `user.manage` (ya existía en el catálogo MVP). El seed
   * `194_cc0017_rbac_parametrizable.sql` otorga `user.manage` a ADMIN
   * (espejo exacto del chequeo `role.code === "ADMIN"` que reemplaza) — sin
   * seed aplicado, este procedure deniega a todos (fail-safe de
   * `requirePermission` hacia "denegar").
   */
  resetPassword: requirePermission("user.manage")
    .input(userAdminResetPasswordInput)
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No puedes resetear tu propio password aquí. Usa el flujo de cambio propio.",
        });
      }

      const target = await ctx.prisma.user.findUnique({
        where: { id: input.id },
        select: { id: true, email: true, active: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
      }
      if (!target.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede resetear password de un usuario inactivo. Reactívelo primero.",
        });
      }

      // ── FUNCIONAL: actualizar la contraseña en Supabase Auth ──────────────
      // El login va por supabase.auth.signInWithPassword → auth.users. Resolvemos
      // la cuenta auth por email (User.id de HIS ≠ auth.users.id).
      const authRows = await ctx.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM auth.users
        WHERE lower(email) = lower(${target.email}) AND deleted_at IS NULL
        LIMIT 1
      `;
      if (authRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El usuario no tiene cuenta en el proveedor de autenticación (Supabase Auth). " +
            "Debe completar la invitación o iniciar sesión por SSO al menos una vez antes de asignarle un password local.",
        });
      }
      const authUserId = authRows[0]!.id;

      // bcrypt vía pgcrypto (schema `extensions` en Supabase). Calificado porque
      // el search_path del rol de la app puede no incluir `extensions`.
      await ctx.prisma.$executeRaw`
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(${input.newPassword}, extensions.gen_salt('bf', 10)),
            updated_at = now()
        WHERE id = ${authUserId}::uuid
      `;
      // Asegurar identidad 'email' — requerida por signInWithPassword. Para
      // usuarios SSO (solo identidad azure) esto habilita el login dual.
      await ctx.prisma.$executeRaw`
        INSERT INTO auth.identities
          (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
        SELECT ${authUserId}, ${authUserId}::uuid,
               jsonb_build_object('sub', ${authUserId}, 'email', ${target.email},
                                  'email_verified', true, 'phone_verified', false),
               'email', now(), now(), now(), gen_random_uuid()
        WHERE NOT EXISTS (
          SELECT 1 FROM auth.identities WHERE user_id = ${authUserId}::uuid AND provider = 'email'
        )
      `;

      // ── Rastro de auditoría local (NO valida el login) ────────────────────
      const { hash } = await hashPin(input.newPassword);
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.userCredential.updateMany({
          where: {
            userId: input.id,
            method: "PASSWORD",
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
          data: { validTo: now },
        }),
        ctx.prisma.userCredential.create({
          data: {
            userId: input.id,
            method: "PASSWORD",
            secretHash: hash,
            validFrom: now,
          },
        }),
      ]);

      // Audit hash chain ya captura el INSERT en UserCredential (trigger BD).
      // Adicionalmente registramos el motivo y caller — útil para investigación.
      logger.info(
        {
          event: "user.password_reset",
          targetUserId: input.id,
          targetEmail: target.email,
          resetBy: ctx.user.id,
          reason: input.reason,
        },
        "Password reseteado por ADMIN",
      );

      return { ok: true as const, userId: target.id, resetAt: now };
    }),

  /**
   * Soft-disable. NO revoca membresías vigentes (auditable). El login
   * verificará `active=false` y bloqueará.
   */
  deactivate: tenantProcedure
    .input(userAdminDeactivateInput)
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes desactivar tu propio usuario.",
        });
      }
      return ctx.prisma.user.update({
        where: { id: input.id },
        data: { active: false, updatedBy: ctx.user.id },
      });
    }),

  /**
   * Reenvía el enlace de "fijar contraseña". También cubre la reconciliación
   * de huérfanos (`listSinCuentaAuth`): si el usuario aún no tiene cuenta en
   * Supabase Auth, la provisiona en este mismo paso antes de invitar.
   */
  resendInvitation: requirePermission("user.manage")
    .input(userAdminResendInvitationInput)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, fullName: true, active: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
      }
      if (!target.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede invitar a un usuario inactivo. Reactívelo primero.",
        });
      }

      await provisionAuthAccount(ctx.prisma, target.email);

      try {
        await sendAccountInvitation(target.email, target.fullName);
      } catch (err) {
        logger.error(
          {
            event: "user.resend_invitation.failed",
            userId: target.id,
            email: target.email,
            error: err instanceof Error ? err.message : String(err),
          },
          "Reenvío de invitación falló.",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "No se pudo enviar el correo de invitación. Verifica la configuración SMTP (/email-test) e intenta de nuevo.",
        });
      }

      return { ok: true as const, userId: target.id, email: target.email };
    }),

  /**
   * Usuarios locales activos SIN fila en `auth.users` (por email) — huérfanos
   * que un `create` fallido (pre-CC-0019, o una carrera) pudo dejar sin
   * cuenta de autenticación. La UI ofrece "crear cuenta + invitar" por fila,
   * que reusa `resendInvitation` (provisiona si falta, luego invita).
   */
  listSinCuentaAuth: requirePermission("user.manage").query(async ({ ctx }) => {
    return ctx.prisma.$queryRaw<Array<{ id: string; email: string; fullName: string }>>`
      SELECT u.id::text AS id, u.email::text AS email, u."fullName" AS "fullName"
      FROM public."User" u
      WHERE u.active = true
        AND NOT EXISTS (
          SELECT 1 FROM auth.users au
          WHERE lower(au.email) = lower(u.email) AND au.deleted_at IS NULL
        )
      ORDER BY u."fullName" ASC
    `;
  }),

  /**
   * Asigna un rol al usuario en una organización. Idempotente: si ya hay una
   * UserOrganizationRole vigente con el mismo (user, org, role) → no-op.
   * Si existe una expirada (validTo < now) o la combinación @@unique ya
   * existe pero está cerrada, reactivamos extendiendo validTo a NULL.
   */
  assignRole: tenantProcedure
    .input(userAdminAssignRoleInput)
    .mutation(async ({ ctx, input }) => {
      // Validar pertenencia del rol: rol global o de esa misma org.
      const role = await ctx.prisma.role.findUnique({ where: { id: input.roleId } });
      if (!role || !role.active) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rol no encontrado o inactivo." });
      }
      if (role.organizationId !== null && role.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El rol no pertenece a la organización indicada.",
        });
      }

      const now = new Date();
      // Hay una @@unique([userId, organizationId, roleId]) → como mucho una fila.
      const existing = await ctx.prisma.userOrganizationRole.findUnique({
        where: {
          userId_organizationId_roleId: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId: input.roleId,
          },
        },
      });

      if (existing) {
        const isLive =
          existing.validFrom <= now && (existing.validTo === null || existing.validTo >= now);
        if (isLive) return existing; // no-op idempotente
        // Reabrir: extender ventana.
        return ctx.prisma.userOrganizationRole.update({
          where: { id: existing.id },
          data: { validFrom: now, validTo: null },
        });
      }

      try {
        return await ctx.prisma.userOrganizationRole.create({
          data: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId: input.roleId,
            validFrom: now,
          },
        });
      } catch (err) {
        rethrowPrisma(err);
      }
    }),

  /**
   * Revoca el rol vigente: setea validTo=now en la membresía.
   * Si no hay vigente, no-op (devolvemos null).
   */
  revokeRole: tenantProcedure
    .input(userAdminRevokeRoleInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const existing = await ctx.prisma.userOrganizationRole.findUnique({
        where: {
          userId_organizationId_roleId: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId: input.roleId,
          },
        },
      });
      if (!existing) return null;
      const isLive =
        existing.validFrom <= now && (existing.validTo === null || existing.validTo >= now);
      if (!isLive) return existing; // ya estaba revocado
      return ctx.prisma.userOrganizationRole.update({
        where: { id: existing.id },
        data: { validTo: now },
      });
    }),
});
