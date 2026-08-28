import type { CanjeCodigo, CodigoInfluencer, AsignacionInfluencer } from '../types';

export function validateCodeRedemption(
  codigoData: CodigoInfluencer,
  asigData: AsignacionInfluencer,
  canjesUsuario: CanjeCodigo[]
): {
  success: boolean;
  puntosAEntregarCliente: number;
  puntosRestantesCampaña: number;
  errorMsg?: string;
} {
  const canjeReciente = canjesUsuario.find(c => c.fechaCanje > codigoData.fechaUltimaRenovacion);
  
  if (canjeReciente) {
    return { 
      success: false, 
      errorMsg: "Ya has utilizado este código en su campaña actual. Debes esperar a que el influencer lo renueve (máximo 30 días).", 
      puntosAEntregarCliente: 0, 
      puntosRestantesCampaña: asigData.puntosParaClientes 
    };
  }
  
  if (asigData.estado !== 'ACEPTADO') {
    return { 
      success: false, 
      errorMsg: "La campaña del influencer no está activa.", 
      puntosAEntregarCliente: 0, 
      puntosRestantesCampaña: asigData.puntosParaClientes 
    };
  }
  
  const puntosAEntregarCliente = (codigoData.puntosPorCanje && codigoData.puntosPorCanje > 0) 
    ? codigoData.puntosPorCanje 
    : (asigData.ratio?.cliente || 10);
  
  if (asigData.puntosParaClientes < puntosAEntregarCliente) {
    return { 
      success: false, 
      errorMsg: "El código ha superado su límite de puntos disponibles en esta campaña.", 
      puntosAEntregarCliente: 0, 
      puntosRestantesCampaña: asigData.puntosParaClientes 
    };
  }
  
  return {
    success: true,
    puntosAEntregarCliente,
    puntosRestantesCampaña: asigData.puntosParaClientes - puntosAEntregarCliente
  };
}
