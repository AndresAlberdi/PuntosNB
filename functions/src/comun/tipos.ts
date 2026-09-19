/** Tipos compartidos por las funciones. Reflejan `src/types/index.ts` del cliente. */
export const ROLES = ['cliente', 'vendedor', 'admin_comercio', 'superadmin', 'influencer', 'contador'] as const;
export type Rol = (typeof ROLES)[number];

/** Roles que el backend refleja en los custom claims del token. */
export interface ClaimsHipatia {
  rol: Rol;
  comercioId?: string;
}
