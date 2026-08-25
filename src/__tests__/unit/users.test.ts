import { describe, it, expect } from 'vitest';

describe('Políticas de Usuarios, Dominios y Prefijos', () => {
  const RESERVED_DOMAINS = ['influencer', 'hiinfluencer', 'hiinfluencer.io', 'admin', 'superadmin', 'hipatia', 'hipatia.io', 'puntosnb'];

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
    if (rol === 'contador') {
      return `${clean}@hipatia.io`;
    }
    if (dominioComercio) {
      return `${clean}@${dominioComercio}`;
    }
    return clean;
  };

  const validatePrefijoInfluencer = (prefijo: string, prefijosExistentes: string[]): { valid: boolean; error?: string } => {
    const clean = prefijo.trim().toUpperCase();
    if (!clean || clean.length < 2 || clean.length > 10) {
      return { valid: false, error: 'El prefijo debe tener entre 2 y 10 caracteres' };
    }
    if (!/^[A-Z0-9]+$/.test(clean)) {
      return { valid: false, error: 'El prefijo solo puede contener letras y números' };
    }
    if (prefijosExistentes.map(p => p.toUpperCase()).includes(clean)) {
      return { valid: false, error: 'El prefijo ya está en uso por otro influencer' };
    }
    return { valid: true };
  };

  const validateCodigoCampaña = (codigo: string, prefijoInfluencer: string): { valid: boolean; error?: string } => {
    const clean = codigo.trim().toUpperCase();
    const cleanPrefijo = prefijoInfluencer.trim().toUpperCase();
    if (!clean.startsWith(cleanPrefijo)) {
      return { valid: false, error: `El código debe iniciar con el prefijo "${cleanPrefijo}"` };
    }
    return { valid: true };
  };

  it('Debe rechazar dominios de comercio reservados', () => {
    expect(validateDominioComercio('influencer.io').valid).toBe(false);
    expect(validateDominioComercio('hiinfluencer.io').valid).toBe(false);
    expect(validateDominioComercio('hipatia.io').valid).toBe(false);
    expect(validateDominioComercio('superadmin.com').valid).toBe(false);
    expect(validateDominioComercio('admin.io').valid).toBe(false);
  });

  it('Debe aceptar dominios de comercio válidos', () => {
    expect(validateDominioComercio('mimercado.io').valid).toBe(true);
    expect(validateDominioComercio('zapatosxyz.com.bo').valid).toBe(true);
    expect(validateDominioComercio('tienda-nordica.io').valid).toBe(true);
  });

  it('Debe generar el formato sintético correcto para Admins, Influencers y Contadores', () => {
    expect(computeUsuarioSintetico('carlos', 'influencer')).toBe('carlos@hiinfluencer.io');
    expect(computeUsuarioSintetico('contabilidad', 'contador')).toBe('contabilidad@hipatia.io');
    expect(computeUsuarioSintetico('admin', 'admin_comercio', 'tienda.io')).toBe('admin@tienda.io');
    expect(computeUsuarioSintetico('caja1', 'vendedor', 'tienda.io')).toBe('caja1@tienda.io');
  });

  it('Debe validar que el PIN de vendedor tenga exactamente 6 dígitos numéricos', () => {
    expect(validatePinVendedor('123456')).toBe(true);
    expect(validatePinVendedor('000000')).toBe(true);
    expect(validatePinVendedor('12345')).toBe(false);
    expect(validatePinVendedor('1234567')).toBe(false);
    expect(validatePinVendedor('12345a')).toBe(false);
  });

  it('Debe validar que el prefijo de influencer sea único y respete formato', () => {
    const existentes = ['NAT', 'CARLOS', 'FIT'];
    expect(validatePrefijoInfluencer('NAT', existentes).valid).toBe(false);
    expect(validatePrefijoInfluencer('LUCIA', existentes).valid).toBe(true);
    expect(validatePrefijoInfluencer('A', existentes).valid).toBe(false); // muy corto
    expect(validatePrefijoInfluencer('NAT-BO', existentes).valid).toBe(false); // caracter especial
  });

  it('Debe obligar a que el código de campaña inicie con el prefijo del influencer', () => {
    expect(validateCodigoCampaña('NATGOLD', 'NAT').valid).toBe(true);
    expect(validateCodigoCampaña('NATVERANO26', 'NAT').valid).toBe(true);
    expect(validateCodigoCampaña('PROMO26', 'NAT').valid).toBe(false);
  });
});
