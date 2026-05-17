/**
 * Hashing de PIN con argon2id para firma electrónica.
 * Elección @AS: argon2id sobre bcrypt/scrypt — resistencia a ataques GPU + side-channel.
 *
 * DEPENDENCIA REQUERIDA — agregar a packages/infrastructure/package.json:
 *   "argon2": "^0.41.1"
 *   "@types/node": ya presente (usa crypto.randomBytes)
 */
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 4096,  // KiB
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Hashea un PIN con argon2id.
 * Si se omite `salt`, genera uno aleatorio de 16 bytes (128 bits).
 * El hash resultante incluye internamente el salt (formato PHC string de argon2),
 * pero también lo retornamos explícitamente para almacenamiento / auditoría.
 */
export async function hashPin(
  pin: string,
  salt?: string,
): Promise<{ hash: string; salt: string }> {
  const saltBuffer = salt
    ? Buffer.from(salt, "hex")
    : randomBytes(16);

  const hash = await argon2.hash(pin, {
    ...ARGON2_OPTIONS,
    salt: saltBuffer,
  });

  return { hash, salt: saltBuffer.toString("hex") };
}

/**
 * Verifica un PIN contra el hash almacenado (formato PHC string de argon2).
 * argon2.verify extrae el salt y parámetros del propio hash — no necesita salt externo.
 */
export async function verifyPin(
  pin: string,
  storedHash: string,
): Promise<boolean> {
  return argon2.verify(storedHash, pin);
}

/**
 * Genera un token de recuperación de 32 bytes (256 bits) en hex.
 * Uso: one-time recovery link; almacenar solo el hash en BD.
 */
export function generateRecoveryToken(): string {
  return randomBytes(32).toString("hex");
}
