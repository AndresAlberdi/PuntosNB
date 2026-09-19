/**
 * Backend de confianza de Hipatia Puntos.
 *
 * Todo lo que el cliente no puede decidir por sí mismo vive aquí: identidad del vendedor,
 * asignación de roles y, a partir de las funciones del libro mayor, la emisión y el consumo de
 * puntos y de saldo prepagado.
 */
export { loginVendedor } from './vendedores/loginVendedor';
export { crearVendedor, rotarPinVendedor, bloquearVendedor } from './vendedores/gestionarVendedor';
