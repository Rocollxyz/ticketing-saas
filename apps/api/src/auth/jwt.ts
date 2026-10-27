import jwt from "jsonwebtoken";

/**
 * Utilidades JWT. El secreto sale de la env (JWT_SECRET); en producción va al
 * secret manager (§7). El payload lleva el tenant_id que alimenta RLS.
 */
export interface JwtPayload {
  sub: string; // userId
  tenant_id: string;
  role: string;
}

const DEV_SECRET = "dev-insecure-secret-change-me";
// En producción no se arranca sin secreto propio: el de dev es público en el repo y
// con él cualquiera firmaría sesiones de cualquier promotor.
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_SECRET)) {
  throw new Error("Falta JWT_SECRET en producción: genera uno con `openssl rand -base64 48`");
}
const SECRET = process.env.JWT_SECRET ?? DEV_SECRET;
const EXPIRES_IN = "1h";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}
