/**
 * Cliente Odoo XML-RPC.
 *
 * Lee credenciales de env vars (NUNCA hardcoded):
 *   - ODOO_URL      → base URL del servidor Odoo (ej. https://odoo.complejoavante.com)
 *   - ODOO_DB       → nombre de la base de datos (ej. AvanteProd)
 *   - ODOO_USER     → email/login del usuario
 *   - ODOO_PASSWORD → password (rotar regularmente)
 *
 * Usage:
 *   const odoo = await getOdooClient();
 *   const partners = await odoo.searchRead("res.partner", [], ["id","name","email"], 0, 10);
 */
import { xmlrpcCall } from "./xmlrpc";

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}

export interface OdooClient {
  config: Omit<OdooConfig, "password">;
  uid: number;
  /** Llamado raw a execute_kw. */
  call<T = unknown>(model: string, method: string, args: unknown[], kwargs?: Record<string, unknown>): Promise<T>;
  /** Atajo común: search + read en un solo call. */
  searchRead<T = Record<string, unknown>>(
    model: string,
    domain: unknown[],
    fields: string[],
    offset?: number,
    limit?: number,
    order?: string,
  ): Promise<T[]>;
  /** Crear registro. */
  create(model: string, values: Record<string, unknown>): Promise<number>;
  /** Actualizar registros. */
  write(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean>;
  /** Eliminar registros (soft o hard según modelo Odoo). */
  unlink(model: string, ids: number[]): Promise<boolean>;
}

function readConfigFromEnv(): OdooConfig | null {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USER;
  const password = process.env.ODOO_PASSWORD;
  if (!url || !db || !username || !password) return null;
  return { url: url.replace(/\/$/, ""), db, username, password };
}

let cachedClient: { client: OdooClient; expiresAt: number } | null = null;
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 min

export async function getOdooClient(): Promise<OdooClient> {
  if (cachedClient && cachedClient.expiresAt > Date.now()) {
    return cachedClient.client;
  }
  const cfg = readConfigFromEnv();
  if (!cfg) {
    throw new Error(
      "Odoo no configurado. Setea ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD en env vars (Vercel Settings → Environment Variables).",
    );
  }

  // 1. Autenticar para obtener uid
  const commonEndpoint = `${cfg.url}/xmlrpc/2/common`;
  const uid = await xmlrpcCall(commonEndpoint, "authenticate", [
    cfg.db,
    cfg.username,
    cfg.password,
    {},
  ]);
  if (typeof uid !== "number" || uid <= 0) {
    throw new Error(`Odoo authenticate falló: ${JSON.stringify(uid)}`);
  }

  const objectEndpoint = `${cfg.url}/xmlrpc/2/object`;

  const client: OdooClient = {
    config: { url: cfg.url, db: cfg.db, username: cfg.username },
    uid,

    async call<T>(
      model: string,
      method: string,
      args: unknown[],
      kwargs: Record<string, unknown> = {},
    ): Promise<T> {
      const result = await xmlrpcCall(objectEndpoint, "execute_kw", [
        cfg.db,
        uid,
        cfg.password,
        model,
        method,
        args,
        kwargs,
      ]);
      return result as T;
    },

    async searchRead<T = Record<string, unknown>>(
      model: string,
      domain: unknown[],
      fields: string[],
      offset = 0,
      limit = 80,
      order?: string,
    ): Promise<T[]> {
      const kwargs: Record<string, unknown> = { fields, offset, limit };
      if (order) kwargs.order = order;
      return this.call<T[]>(model, "search_read", [domain], kwargs);
    },

    async create(model, values) {
      return this.call<number>(model, "create", [values]);
    },

    async write(model, ids, values) {
      return this.call<boolean>(model, "write", [ids, values]);
    },

    async unlink(model, ids) {
      return this.call<boolean>(model, "unlink", [ids]);
    },
  };

  cachedClient = { client, expiresAt: Date.now() + SESSION_TTL_MS };
  return client;
}

/**
 * Versión sin auth — útil para chequear que el servidor responde + leer
 * versión Odoo antes de intentar autenticarse.
 */
export async function getOdooVersion(): Promise<{ server_version: string; protocol_version: number }> {
  const cfg = readConfigFromEnv();
  if (!cfg) throw new Error("ODOO_URL no configurada");
  const commonEndpoint = `${cfg.url}/xmlrpc/2/common`;
  return xmlrpcCall(commonEndpoint, "version", []) as Promise<{ server_version: string; protocol_version: number }>;
}
