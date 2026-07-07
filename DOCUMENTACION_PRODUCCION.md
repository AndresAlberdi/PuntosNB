# Documentación de Producción - Hipatia

## Arquitectura General
La plataforma **Hipatia** es una aplicación de fidelización multi-marca, diseñada con una arquitectura serverless en Google Cloud.

- **Frontend**: Single Page Application (SPA) desarrollada en React con TypeScript, empaquetada mediante Vite y estilizada con TailwindCSS (v4).
- **Backend / BaaS**: Firebase.
  - **Autenticación**: Firebase Authentication (Email/Password, Google).
  - **Base de Datos**: Firestore (NoSQL).
  - **Almacenamiento**: Firebase Storage (para avatares o logotipos de comercios).
  - **Hosting**: Firebase Hosting para entregar la aplicación de forma rápida y segura a través de CDN.

## Protocolos de Seguridad

### 1. Autenticación y Autorización
- Todas las rutas y acciones están protegidas por `ProtectedRoute` en el Frontend.
- El sistema utiliza Roles basados en claims/documentos en la colección `users`: `cliente`, `vendedor`, `admin_comercio`, `superadmin`.
- Es imperativo que las Reglas de Seguridad de Firestore (Security Rules) restrinjan el acceso de escritura/lectura en base al `uid` y `rol` de cada usuario. Nunca debe existir una regla `allow read, write: if true;` en producción.

### 2. Gestión de Dependencias
- Se requiere auditar y actualizar regularmente las dependencias (`npm audit`) para evitar vulnerabilidades como *Prototype Pollution* o fugas de información.

### 3. Privacidad de Datos
- Las contraseñas no se manejan directamente, sino a través de Firebase Auth, cumpliendo con los estándares de cifrado y salting de la industria.

## Guía de Despliegue

Para desplegar una nueva versión en producción, asegúrate de estar autenticado en Firebase CLI y ejecutar:

```bash
# 1. Instalar dependencias limpias
npm ci

# 2. Compilar la aplicación para producción
npm run build

# 3. Desplegar en Firebase Hosting
firebase deploy --only hosting
```

## Gestión de Usuarios y Roles

La plataforma divide la funcionalidad dependiendo del nivel de acceso:
- **Cliente**: Solo puede ver sus propios puntos, escanear códigos o visualizar catálogos. (Rol asignado por defecto en el registro).
- **Vendedor**: Asignado a un `comercioId` específico. Puede asignar puntos a clientes. No puede editar premios ni reglas.
- **Admin Comercio**: Asignado a un `comercioId`. Puede editar premios, reglas de acumulación y revisar reportes de su propio comercio.
- **SuperAdmin**: Control total sobre el sistema. (Requiere asignación manual en la Base de Datos para seguridad).
