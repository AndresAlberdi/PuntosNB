# Manual del Super Administrador - Hipatia (Puntos NB)

Este manual está dirigido al personal técnico y de operaciones centrales de la plataforma Hipatia. El rol de Super Administrador (`superadmin`) tiene acceso global y sin restricciones a todos los recursos del sistema.

## 1. Acceso al Panel Central

El rol de Super Administrador no puede ser obtenido mediante el registro público. Debe ser asignado manualmente en la base de datos (Firestore) modificando el claim de rol a `superadmin` en el documento del usuario correspondiente en la colección `users`.

## 2. Gestión de Comercios (Onboarding)

Una de las tareas principales del SuperAdmin es dar de alta a nuevos comercios en la plataforma.

1. En el panel principal, dirígete a **Gestión de Comercios**.
2. Selecciona **Crear Nuevo Comercio**.
3. Completa los datos institucionales:
   - Nombre Comercial.
   - NIT / RUT (Documento de identidad fiscal).
   - Logotipo por defecto.
4. Al crear el comercio, el sistema generará un `comercioId` único.

## 3. Asignación de Roles de Administración

Una vez creado el comercio, debes asignarle un Administrador de Comercio para que el cliente pueda empezar a operar.
1. El usuario cliente debe registrarse previamente en la aplicación de forma normal.
2. Como SuperAdmin, busca al usuario por su correo electrónico.
3. Modifica su rol de `cliente` a `admin_comercio`.
4. Asígnale el `comercioId` del comercio recién creado.
A partir de este momento, ese usuario podrá gestionar su propio catálogo y sus vendedores.

## 4. Soporte y Auditoría Global

Como SuperAdmin, tienes visibilidad completa sobre las operaciones de toda la plataforma:
- **Auditoría Transversal**: Puedes ver los movimientos, saldos y escaneos de todos los comercios y clientes. Esto es útil para resolver disputas, rastrear posibles fraudes (ej. un vendedor emitiendo puntos anómalos) o solucionar problemas técnicos.
- **Gestión de Usuarios**: Capacidad de suspender cuentas o restablecer accesos en caso de violaciones a los términos de servicio.

## 5. Monitoreo del Sistema

Dado que la arquitectura se basa en Firebase, el SuperAdmin también debe trabajar en conjunto con la consola de Google Cloud/Firebase para:
- Monitorear el consumo de lecturas y escrituras en Firestore.
- Revisar los logs de errores en caso de fallos en el Frontend.
- Asegurar que las Reglas de Seguridad (Security Rules) se mantengan estrictas y no permitan fugas de información entre comercios.
