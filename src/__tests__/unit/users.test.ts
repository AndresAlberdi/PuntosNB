import { describe, it, expect } from 'vitest';

describe('Políticas de Usuarios y Dominios', () => {
  const RESERVED_DOMAINS = ['influencer', 'hiinfluencer', 'hiinfluencer.io', 'admin', 'superadmin', 'hipatia', 'puntosnb'];

  const validateDominioComercio = (dominio: string): { valid: boolean; error?: string } => {
    const clean = dominio.trim().toLowerCase().replace(/^@+/, '');
    if (!clean || !clean.includes('.')) {
      return { valid: false, error: 'Debe tener una extensión válida (ej: mitienda.io)' };
    }
    const isReserved = RESERVED_DOMAINS.some(res => clean === res || clean.startsWith(res + '.'));
    if (isReserved) {
      return { valid: false, error: 'Dominio reservado por el sistema' };
    }
    return { valid: true };
  };

  const validatePinVendedor = (pin: string): boolean => {
    return /^\d{6}$/.test(pin.trim());
  };

  const computeUsuarioSintetico = (usuario: string, rol: string, dominioComercio?: string): string => {
    const clean = usuario.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (rol === 'influencer') {
      return `${clean}@hiinfluencer.io`;
    }
    if (dominioComercio) {
      return `${clean}@${dominioComercio}`;
    }
    return clean;
  };

  it('Debe rechazar dominios de comercio reservados', () => {
    expect(validateDominioComercio('influencer.io').valid).toBe(false);
    expect(validateDominioComercio('hiinfluencer.io').valid).toBe(false);
    expect(validateDominioComercio('superadmin.com').valid).toBe(false);
    expect(validateDominioComercio('admin.io').valid).toBe(false);
  });

  it('Debe aceptar dominios de comercio válidos', () => {
    expect(validateDominioComercio('mimercado.io').valid).toBe(true);
    expect(validateDominioComercio('zapatosxyz.com.bo').valid).toBe(true);
    expect(validateDominioComercio('tienda-nordica.io').valid).toBe(true);
  });

  it('Debe generar el formato sintético correcto para Admins e Influencers', () => {
    expect(computeUsuarioSintetico('carlos', 'influencer')).toBe('carlos@hiinfluencer.io');
    expect(computeUsuarioSintetico('admin', 'admin_comercio', 'tienda.io')).toBe('admin@tienda.io');
    expect(computeUsuarioSintetico('caja1', 'vendedor', 'tienda.io')).toBe('caja1@tienda.io');
  });

  it('Debe validar que el PIN de vendedor tenga exactamente 6 dígitos numéricos', () => {
    expect(validatePinVendedor('123456')).toBe(true);
    expect(validatePinVendedor('000000')).toBe(true);
    expect(validatePinVendedor('12345')).toBe(false); // 5 dígitos
    expect(validatePinVendedor('1234567')).toBe(false); // 7 dígitos
    expect(validatePinVendedor('12345a')).toBe(false); // Caracter no numérico
  });
});
