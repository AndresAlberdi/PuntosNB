# Plan de migración de imágenes a Cloud Storage

## Por qué

Hoy las imágenes viven como *data URL* dentro de los documentos de Firestore. La medición del
19-sep-2026 en `puntosnb` lo muestra con claridad: de 0,21 MB de base, **0,13 MB son imágenes**, y
los datos de negocio ocupan 0,04 MB —36 transacciones pesan 11,6 KB entre todas—.

El costo no está en guardarlas, sino en leerlas:

- `ClienteDashboard` lee **todos los comercios** para armar su lista. Cada lectura arrastra el
  catálogo completo de cada comercio, con las fotos de sus productos y premios adentro.
- Con 4 comercios y un catálogo de 45 KB, cada cliente que abre la aplicación descarga ~64 KB de
  comercios. Con 50 comercios y catálogos parecidos serían ~800 KB **por apertura**, y se pagan
  como lectura de Firestore, no como transferencia de archivos estáticos.
- Un documento de Firestore no puede pasar de 1 MiB: un catálogo con veinte fotos se acerca al
  límite y rompe la escritura del comercio entera.

La Fase 3 ya redujo el problema en origen: el navegador transforma las imágenes antes de enviarlas
(WebP, con presupuestos de 25 a 90 KB según el uso) y el servidor rechaza lo que exceda. Eso acota
el daño, pero no cambia el modelo.

## Qué se propone

Mover las imágenes a Cloud Storage y guardar en Firestore solo la ruta.

| Imagen | Ruta propuesta | Quién la escribe | Quién la lee |
|---|---|---|---|
| Logotipo del comercio | `comercios/{comercioId}/logo.webp` | administrador del comercio | cualquier autenticado |
| Foto de producto | `comercios/{comercioId}/productos/{productoId}.webp` | administrador del comercio | cualquier autenticado |
| Foto de premio | `comercios/{comercioId}/premios/{premioId}.webp` | administrador del comercio | cualquier autenticado |
| Comprobante de depósito | `cobros/{comercioId}/{cobroId}.webp` | contador | contador, superadministrador y el comercio dueño |
| Avatar del cliente | ya se elige de una lista fija; no se sube nada | — | — |

Reglas de Storage, en la misma línea que las de Firestore: denegar por defecto, escritura solo del
rol dueño de esa ruta, tamaño máximo por tipo de imagen (`request.resource.size`) y tipo de
contenido restringido a `image/webp` e `image/jpeg`. El comprobante **no** es público: se lee con
URL firmada de vida corta que emite una función, porque contiene datos bancarios.

## Cómo migrar sin cortar el servicio

1. **Escritura doble.** El cliente sube la imagen a Storage y guarda `logoStoragePath` junto al
   `logoUrl` existente. Nada se rompe: quien lea el documento viejo sigue viendo la imagen.
2. **Lectura preferente.** La interfaz usa `logoStoragePath` cuando existe y cae al `logoUrl`
   cuando no.
3. **Migración de lo existente.** Un script administrativo recorre los documentos, sube cada
   *data URL* a Storage, escribe la ruta y borra el campo base64. Idempotente y con `--dry-run`,
   como los demás scripts de `scripts/admin/`.
4. **Retiro del campo viejo.** Cuando ningún documento tenga `logoUrl`, se quita el respaldo de la
   interfaz y el campo de las reglas.

## Costo y beneficio

- Storage cobra por almacenamiento y transferencia, bastante más barato que leer documentos de
  Firestore, y el navegador cachea las imágenes por URL: la segunda visita no las vuelve a bajar.
- El documento del comercio pasa de decenas de KB a menos de 2 KB, con lo que la lista de comercios
  deja de crecer con el tamaño de los catálogos.
- Aparece una dependencia nueva —reglas de Storage— que hay que mantener con el mismo criterio.

## Cuándo

Después de la Fase 4 (cadena de suministro y CI/CD), para que la migración viaje por un canal ya
verificado. No es urgente desde el punto de vista de seguridad: hoy el riesgo es de costo y de
límites, no de acceso indebido.
