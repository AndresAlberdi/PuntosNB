/**
 * Backend de confianza de Hipatia Puntos.
 *
 * Todo lo que el cliente no puede decidir por sí mismo vive aquí: la identidad del vendedor, la
 * asignación de roles, la emisión y el consumo de puntos, los canjes, las campañas de influencer
 * y la cobranza del prepago.
 */

// Identidad del vendedor
export { loginVendedor } from './vendedores/loginVendedor';
export { crearVendedor, rotarPinVendedor, bloquearVendedor } from './vendedores/gestionarVendedor';

// Libro mayor
export { crearSesionAcumulacion, reclamarAcumulacion } from './libro/acumulacion';
export { crearSesionCanje, confirmarCanje } from './libro/canje';
export { canjearCodigo } from './libro/codigos';

// Códigos promocionales del comercio
export { crearCodigoComercio, cambiarEstadoCodigoComercio } from './comercios/codigosComercio';

// Campañas de influencer
export { gestionarAsignacionInfluencer, gestionarCodigoInfluencer } from './influencers/gestionar';

// Cobranza
export { registrarCobroPrepago } from './cobros/registrarCobroPrepago';
export { anularCobroPrepago, conciliarCobroPrepago } from './cobros/administrarCobros';

// Administración de cuentas y comercios
export {
  asignarRol, cambiarEstadoUsuario, guardarComercio, cambiarEstadoComercio,
  sincronizarClaimsUsuario, actualizarPerfilInfluencer,
} from './usuarios/gestionar';
