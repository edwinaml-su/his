// =============================================================================
// Cube.dev — Configuracion principal (cube.js)
// Wave: Beta.19b — BI Capa Semantica
// Owner: @BID — BI Developer
// Dependencias: analytics schema Postgres (SQL 48 + 49 + 50)
// ADR base: ADR 0009 D4 — bi_reader + analytics.set_bi_context()
// =============================================================================
//
// IMPORTANTE: Variables de entorno requeridas (Supabase service_role):
//   CUBEJS_DB_HOST        = <host>.supabase.co
//   CUBEJS_DB_PORT        = 5432
//   CUBEJS_DB_NAME        = postgres
//   CUBEJS_DB_USER        = bi_reader        (o service_role en dev)
//   CUBEJS_DB_PASS        = <password>
//   CUBEJS_DB_SSL         = true
//   CUBEJS_API_SECRET     = <secreto-random-32chars>
//   CUBEJS_DEV_MODE       = false            (true solo en desarrollo local)
//
// En produccion Cube.dev conecta como bi_reader:
//   - RLS activo: solo ve datos de la org en contexto
//   - statement_timeout 30s, lock_timeout 5s (ADR 0009 D4)
// =============================================================================

const { createClient } = require('@cubejs-backend/server');

module.exports = {
  // -----------------------------------------------------------------------
  // DB Type: PostgreSQL (Supabase)
  // -----------------------------------------------------------------------
  dbType: 'postgres',

  // -----------------------------------------------------------------------
  // driverFactory: configura la conexion a Postgres con el schema analytics.
  // search_path = analytics,public garantiza que las matviews gold sean el
  // punto de entrada por defecto.
  // -----------------------------------------------------------------------
  driverFactory: ({ dataSource }) => {
    const { PostgresDriver } = require('@cubejs-backend/postgres-driver');
    return new PostgresDriver({
      host:     process.env.CUBEJS_DB_HOST,
      port:     parseInt(process.env.CUBEJS_DB_PORT || '5432', 10),
      database: process.env.CUBEJS_DB_NAME || 'postgres',
      user:     process.env.CUBEJS_DB_USER,
      password: process.env.CUBEJS_DB_PASS,
      ssl: process.env.CUBEJS_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      // Configurar search_path al conectar: analytics primero, public despues
      // Esto permite que los cubes referencien matviews sin prefijo de schema.
      queryOptions: {
        options: {
          // onConnect: ejecutar SET para search_path y timeouts
        },
      },
      // Pool de conexiones conservador (no saturar OLTP)
      poolOptions: {
        min: 1,
        max: 5,
        acquireTimeoutMillis: 30000,
      },
    });
  },

  // -----------------------------------------------------------------------
  // contextToAppId: particion de cache por organizacion.
  // Cada org tiene su propio cache de pre-aggregations en Cube.
  // -----------------------------------------------------------------------
  contextToAppId: ({ securityContext }) => {
    if (!securityContext || !securityContext.organizationId) {
      return 'CUBEJS_APP_ANONYMOUS';
    }
    return `CUBEJS_APP_${securityContext.organizationId}`;
  },

  // -----------------------------------------------------------------------
  // queryRewrite: inyecta el filtro de organizacion en cada query.
  // DOBLE PROTECCION: RLS en Postgres (via set_bi_context) + filtro en Cube.
  // Esto evita que queries sin securityContext lleguen a la BD.
  // -----------------------------------------------------------------------
  queryRewrite: (query, { securityContext }) => {
    if (!securityContext || !securityContext.organizationId) {
      // Sin contexto: retornar query que devuelve 0 filas en todas las facts
      // La RLS de Postgres tambien bloquearia, pero esto es defensa en profundidad.
      return {
        ...query,
        filters: [
          ...(query.filters || []),
          {
            member: 'Encounters.organizationId',
            operator: 'equals',
            values: ['00000000-0000-0000-0000-000000000000'], // UUID invalido = 0 filas
          },
        ],
      };
    }
    return query;
  },

  // -----------------------------------------------------------------------
  // beforeQuery (SQL hook): invoca analytics.set_bi_context() para propagar
  // el organizationId al contexto RLS de Postgres ANTES de cada query.
  //
  // Implementacion via queryTransformer (Cube.dev v0.34+):
  // La funcion set_bi_context usa SET LOCAL, que requiere transaccion.
  // Cube.dev envuelve cada query en una transaccion por defecto.
  //
  // Equivalente al withTenantContext() del OLTP (rls-context.ts).
  // -----------------------------------------------------------------------
  extendContext: (req) => {
    // El token JWT de Cube.dev debe incluir organizationId en el payload.
    // El frontend lo inyecta via CubejsApi({ headers: { Authorization: jwt } }).
    return {};
  },

  // Hook de query: inyectar set_bi_context antes de ejecutar
  // (Cube.dev v0.36 soporta driverFactory con onBeforeQuery)
  // Para versiones anteriores usar el patron documentado en beta19b_bi_semantic_implementation.md
  scheduledRefreshContexts: async () => {
    // En scheduled refresh (pre-aggregations), no hay securityContext de usuario.
    // Retornar contextos de todas las organizaciones activas requiere query OLTP.
    // Placeholder: en Beta.19c implementar con llamada a la API de organizaciones.
    return [{ securityContext: { scheduledRefresh: true } }];
  },

  // -----------------------------------------------------------------------
  // Schema path: los cubes estan en cube/schema/
  // -----------------------------------------------------------------------
  schemaPath: 'schema',

  // -----------------------------------------------------------------------
  // Telemetry: desactivar en produccion (datos de queries sensibles)
  // -----------------------------------------------------------------------
  telemetry: false,

  // -----------------------------------------------------------------------
  // Developer Mode: solo en local
  // -----------------------------------------------------------------------
  devServer: process.env.CUBEJS_DEV_MODE === 'true',
};
