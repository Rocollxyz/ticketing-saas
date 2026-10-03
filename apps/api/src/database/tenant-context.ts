import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de la petición autenticada. El middleware de auth lo rellena tras
 * verificar el JWT, y el acceso a datos lo lee para fijar app.current_tenant_id
 * dentro de la transacción → RLS (§7 ARCHITECTURE.md).
 */
export interface TenantStore {
  tenantId: string;
  userId: string;
  role: string;
}

export const tenantContext = new AsyncLocalStorage<TenantStore>();

export function getStore(): TenantStore | undefined {
  return tenantContext.getStore();
}

export function getTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}
