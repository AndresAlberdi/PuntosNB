# Política de seguridad — Hipatia Puntos

## Cómo reportar una vulnerabilidad

Si encontraste un problema de seguridad en Hipatia Puntos, escribinos a
**seguridad@hipatia.bo** con el asunto «Reporte de seguridad». Pedimos que **no** se publique ni se
comparta en foros, redes o repositorios públicos hasta que esté corregido.

En el reporte ayuda mucho incluir:

- qué encontraste y qué impacto tendría;
- los pasos para reproducirlo, con el entorno (`puntosnb` es el de pruebas, `hipatia-puntos` el de
  producción) y la fecha y hora aproximadas;
- capturas o registros, con los datos personales tapados.

Respondemos con acuse de recibo en un plazo de **3 días hábiles** y con un diagnóstico inicial en
un plazo de **10 días hábiles**. Si el reporte es válido, informamos cuándo quedará corregido y
avisamos al publicar la corrección.

## Qué está dentro del alcance

- Las aplicaciones web `https://hipatia-puntos.web.app` y `https://puntosnb.web.app`.
- Las Cloud Functions del proyecto y las reglas de Firestore de este repositorio.

Queda fuera de alcance, y pedimos que no se intente:

- cualquier prueba que degrade el servicio (denegación de servicio, envío masivo de solicitudes);
- ingeniería social a personas del equipo o a comercios;
- acceso, modificación o descarga de datos de clientes reales. Si al investigar accediste a datos
  de terceros sin querer, decilo en el reporte y borralos.

## Pruebas responsables

Hay un entorno de pruebas, `puntosnb`, pensado para esto. Pedimos usar cuentas propias y no tocar
los datos de los comercios que están operando. No ofrecemos recompensas económicas, pero sí
reconocimiento público a quien lo desee, una vez corregido el problema.

## Cómo está construida la seguridad de esta aplicación

Para orientar el reporte, este es el modelo vigente:

- **La lógica de negocio corre en el servidor.** Puntos, saldos, canjes, códigos y cobros solo se
  escriben desde Cloud Functions con el Admin SDK. Las reglas de Firestore niegan por defecto: el
  comodín final está en `false`.
- **El rol viaja firmado.** `rol` y `comercioId` son *custom claims* del token, asignados solo por
  el backend. Un documento de Firestore nunca decide un permiso.
- **El vendedor tiene identidad verificable.** Su PIN se compara contra un hash scrypt con sal por
  usuario, guardado en una colección que el cliente no puede leer, con bloqueo progresivo por
  cuenta y por dirección IP.
- **Datos separados por sensibilidad.** Los datos fiscales y económicos de cada comercio viven en
  una colección aparte, legible solo por los roles que la necesitan.
- **Toda operación sensible queda auditada** en una colección que el cliente no puede leer.
- **App Check** (reCAPTCHA Enterprise) acredita que las llamadas vienen de la aplicación.

El detalle del trabajo de seguridad está en `docs/security/`.

## Versiones con soporte

Se da soporte de seguridad a la versión desplegada en producción. No hay versiones anteriores con
soporte: la aplicación es un servicio, no un producto que se instale.
