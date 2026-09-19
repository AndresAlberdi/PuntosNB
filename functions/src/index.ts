/**
 * Backend de confianza de Hipatia Puntos.
 *
 * Todo lo que el cliente no puede decidir por sí mismo vive aquí: la identidad del vendedor, la
 * asignación de roles, la emisión y el consumo de puntos, los canjes y la cobranza del prepago.
 */

// Identidad del vendedor
export { loginVendedor } from './vendedores/loginVendedor';
export { crearVendedor, rotarPinVendedor, bloquearVendedor } from './vendedores/gestionarVendedor';

// Libro mayor
export { crearSesionAcumulacion, reclamarAcumulacion } from './libro/acumulacion';
export { crearSesionCanje, confirmarCanje } from './libro/canje';
export { canjearCodigo } from './libro/codigos';

// Cobranza
export { registrarCobroPrepago } from './cobros/registrarCobroPrepago';

// Administración de cuentas y comercios
export { asignarRol, cambiarEstadoUsuario, guardarComercio, sincronizarClaimsUsuario } from './usuarios/gestionar';
