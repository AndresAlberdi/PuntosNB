# Documentación Profesional - Hipatia (Puntos NB)

## 1. Visión General del Proyecto
**Hipatia** (también conocido como Sistema de Puntos NB) es una aplicación de fidelización multi-marca que permite a los comercios otorgar puntos acumulables a sus clientes por sus compras. Los clientes pueden posteriormente canjear estos puntos por productos o servicios (premios) predefinidos por el comercio.

El sistema está orientado a ser operado desde dispositivos móviles (escaneo de códigos QR para acumular y canjear puntos) y administrado a través de la interfaz web.

## 2. Arquitectura del Sistema
La aplicación sigue una arquitectura *Serverless* hospedada íntegramente en el ecosistema de **Google Cloud Platform (GCP)** y **Firebase**.

### 2.1 Stack Tecnológico
*   **Frontend**: Single Page Application (SPA) desarrollada con **React 19** y **TypeScript**.
*   **Empaquetador (Bundler)**: **Vite**, optimizado para tiempos rápidos de desarrollo y construcción.
*   **Estilos**: **TailwindCSS (v4)**, proporcionando un sistema de diseño basado en utilidades.
*   **Enrutamiento**: **React Router (v7)**.
*   **Lectura QR**: `@yudiel/react-qr-scanner` y generación con `qrcode.react`.

### 2.2 Backend as a Service (BaaS) - Firebase
*   **Base de Datos**: **Firestore** (Base de datos NoSQL documental).
*   **Autenticación**: **Firebase Authentication** (soporta Email/Contraseña y autenticación OAuth de Google).
*   **Almacenamiento**: **Firebase Storage** (para almacenamiento de avatares, logotipos de comercios y premios).
*   **Hosting**: **Firebase Hosting** (entrega rápida y segura de los estáticos generados por el build de React a través de CDN).

### 2.3 Seguridad y Autorización
La seguridad se maneja a dos niveles:
1.  **Frontend (React)**: Protección de rutas mediante el componente `ProtectedRoute`, basándose en el rol del usuario autenticado.
2.  **Backend (Firestore Security Rules)**: Control de acceso estricto a las colecciones de la base de datos validando los `claims` del token de autenticación (el rol del usuario y su `uid`).

## 3. Modelo de Roles
El sistema opera bajo un modelo de control de acceso basado en roles (RBAC).

*   **`cliente`**: Rol por defecto. Solo puede ver sus propios puntos, escanear códigos QR generados por comercios y visualizar el catálogo de premios.
*   **`vendedor`**: Pertenece a un `comercioId` específico. Su función es generar los códigos QR para la acumulación de puntos (asignación) y validar los canjes. No tiene permisos de administración.
*   **`admin_comercio`**: Pertenece a un `comercioId` específico. Puede gestionar su catálogo de premios, configurar las reglas de acumulación y acceder a reportes de transacciones de su comercio.
*   **`superadmin`**: Rol de administración global del sistema.

## 4. Estructura de Datos (Esquema Firestore)
Las entidades principales del sistema están fuertemente tipadas en TypeScript y se mapean directamente a colecciones en Firestore.

### 4.1 `users` (Usuarios)
Almacena todos los usuarios del sistema (independientemente del rol).
*   `uid`: ID de Firebase Auth.
*   `email`, `nombre`, `telefono`, `avatarUrl`.
*   `rol`: `RolUsuario` (`cliente`, `vendedor`, `admin_comercio`, `superadmin`).
*   `comercioId`: Referencia al comercio (solo si aplica).

### 4.2 `comercios` (Comercios/Negocios)
Entidades de negocio que ofrecen fidelización.
*   `id`, `nombre`, `nit_rut`, `logoUrl`.
*   `reglas`: Array de reglas de acumulación de puntos (Tipo: `POR_COMPRA`, `POR_PRODUCTO`, `POR_RANGO`, `POR_REGISTRO`).
*   `premios`: Array de premios configurables con costo en puntos.
*   `productos`: Array del catálogo de productos que otorgan puntos específicos.

### 4.3 `saldos` (Saldos de Puntos)
Mantiene el registro del saldo actual de un cliente en un comercio específico.
*   `id`: Clave compuesta (`clienteId_comercioId`).
*   `clienteId`, `comercioId`.
*   `saldoTotal`: Cantidad de puntos disponibles para canje.

### 4.4 `transacciones` (Histórico de Movimientos)
Registro inmutable (Audit log) de todo movimiento de puntos.
*   `id`, `fechaHora`, `montoFactura`, `nroFactura`, `puntos`.
*   `clienteId`, `vendedorId`, `comercioId`.
*   `tipo`: `ACUMULACION` (Suma de puntos) o `CANJE` (Resta de puntos).
*   `premioId` / `reglaAplicadaId` (Dependiendo del tipo).

### 4.5 `sesionesQR` (Transacciones en Progreso)
Registros efímeros para el flujo de escaneo.
*   `id`: Token único.
*   `tipo`: `ACUMULACION` (Generado por vendedor) o `CANJE` (Generado por cliente).
*   `estado`: `PENDIENTE`, `USADO`, `EXPIRADO`.
*   Datos del creador y metadatos de la factura o premio según el tipo.

## 5. Flujos de Trabajo Principales

### 5.1 Acumulación de Puntos
1.  **Vendedor**: En la app, ingresa monto de compra, nro. de factura y selecciona la regla de acumulación aplicable (o producto).
2.  **Sistema**: Genera un documento en `sesionesQR` con estado `PENDIENTE` y muestra el QR en la pantalla del vendedor.
3.  **Cliente**: Abre la app y escanea el QR.
4.  **Sistema**: 
    *   Verifica que la sesiónQR esté `PENDIENTE`.
    *   Registra una nueva `transaccion` de `ACUMULACION`.
    *   Suma los puntos en el documento correspondiente en `saldos`.
    *   Marca la `sesionQR` como `USADA`.

### 5.2 Canje de Puntos por Premios
1.  **Cliente**: Desde su catálogo, selecciona un premio y decide canjearlo.
2.  **Sistema**: Verifica que el saldo del cliente sea mayor o igual a los puntos requeridos. Si es así, crea una `sesionQR` de `CANJE` (PENDIENTE) y muestra el QR al cliente.
3.  **Vendedor**: Escanea el QR del cliente.
4.  **Sistema**:
    *   Registra una `transaccion` de `CANJE`.
    *   Resta los puntos en `saldos`.
    *   Marca la `sesionQR` como `USADA`.
    *   El vendedor entrega físicamente el premio.

## 6. Despliegue y Scripts
El proyecto contiene scripts configurados en `package.json` para facilitar su construcción y despliegue.

*   `npm run build`: Compila el código para producción.
*   `npm run test`: Ejecuta la batería de pruebas (con `vitest`).
*   `npm run lint`: Analiza el código buscando errores de sintaxis y anti-patrones.
*   **Despliegue a Producción**: El script principal de despliegue se encarga de ejecutar pruebas, escanear vulnerabilidades (Snyk), construir la aplicación y finalmente hacer deploy a Firebase Hosting usando `firebase deploy --only hosting`.

## 7. Prácticas de Desarrollo
*   **Control de Calidad**: Se utilizan validaciones con ESLint para un código limpio en TypeScript y React, y `vitest` para pruebas unitarias.
*   **Testing Seguro**: Las reglas de Firestore deben probarse con los emuladores locales usando `@firebase/rules-unit-testing`.
*   **Variables de Entorno**: Diferentes archivos `.env`, `.env.staging` y `.env.production` gestionan claves de la API, App IDs de Firebase, etc.
