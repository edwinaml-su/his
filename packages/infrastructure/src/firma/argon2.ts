/**
 * Shim de compatibilidad — emula la API del paquete `argon2` (node-gyp-build)
 * usando `@node-rs/argon2` (Rust + N-API stable, prebuilts para Node 18-24+).
 *
 * Razón: el paquete `argon2` original usa native bindings via node-gyp-build
 * que NO tiene prebuilts para Node 24 (abi=137) en Vercel runtime. Migrando
 * a @node-rs/argon2 los hashes PHC siguen siendo válidos (mismo algoritmo
 * argon2id, mismo formato), pero el runtime ya no falla.
 *
 * Uso: reemplazar `import argon2 from "argon2"` por
 * `import argon2 from "@his/infrastructure/firma/argon2"`.
 *
 * API soportada (subset del original):
 *   - argon2.hash(password, options?) → Promise<string>
 *   - argon2.verify(storedHash, password) → Promise<boolean>
 *   - argon2.argon2id (constante de tipo)
 *   - default export con las 3
 */
import { hash as rsHash, verify as rsVerify } from "@node-rs/argon2";

// `Algorithm` en @node-rs/argon2 es un const enum, incompatible con
// isolatedModules:true. Usamos literales numéricos (mismo valor) para evitar
// el TS2748 "Cannot access ambient const enums".
//   Argon2d  = 0
//   Argon2i  = 1
//   Argon2id = 2
export const argon2id = 2;
export const argon2i = 1;
export const argon2d = 0;

interface ArgonHashOptions {
  type?: number;
  salt?: Buffer | Uint8Array;
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
  hashLength?: number;
  raw?: boolean;
}

/**
 * Hashea con argon2id (default). Mapea los nombres de opciones del paquete
 * `argon2` original a los del `@node-rs/argon2`.
 */
export async function hash(
  password: string,
  options?: ArgonHashOptions,
): Promise<string> {
  return rsHash(password, {
    // cast literal -> Algorithm — el runtime acepta el número directamente.
    algorithm: (options?.type ?? 2) as never,
    salt: options?.salt as Buffer | undefined,
    memoryCost: options?.memoryCost,
    timeCost: options?.timeCost,
    parallelism: options?.parallelism,
    outputLen: options?.hashLength,
  });
}

/**
 * Verifica un PIN contra un hash PHC string. El salt y parámetros se extraen
 * del hash mismo — mismo comportamiento que el paquete `argon2` original.
 */
export async function verify(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await rsVerify(storedHash, password);
  } catch {
    // @node-rs/argon2 lanza si el hash es inválido — el paquete original retorna false.
    return false;
  }
}

const argon2Default = {
  hash,
  verify,
  argon2id,
  argon2i,
  argon2d,
};

export default argon2Default;
