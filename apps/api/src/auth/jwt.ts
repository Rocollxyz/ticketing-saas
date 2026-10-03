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

const SECRET = process.env.JWT_SECRET ?? "dev-insecure-secret-change-me";
const EXPIRES_IN = "1h";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}
