import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, collection, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Comercio, ReglaPunto, Premio, Usuario } from "../types";

export const seedDatabase = async () => {
  try {
    const batch = writeBatch(db);
    
    // 1. Create a Commerce
    const comercioRef = doc(collection(db, "comercios"));
    const comercioId = comercioRef.id;

    const reglas: ReglaPunto[] = [
      { id: "r1", tipo: "POR_COMPRA", puntosAOtorgar: 10, activa: true },
      { id: "r2", tipo: "POR_MONTO", puntosAOtorgar: 1, montoMinimo: 10, activa: true },
      { id: "r3", tipo: "POR_PRODUCTO", puntosAOtorgar: 50, productoId: "p1", nombreProducto: "Hamburguesa Especial", activa: true }
    ];

    const premios: Premio[] = [
      { id: "pr1", nombre: "Bebida Gratis", descripcion: "Cualquier bebida mediana", puntosRequeridos: 100, activo: true },
      { id: "pr2", nombre: "Descuento 50%", descripcion: "Mitad de precio en tu próxima compra", puntosRequeridos: 500, activo: true }
    ];

    const nuevoComercio: Comercio = {
      id: comercioId,
      nombre: "Comercio de Prueba NB",
      nit_rut: "123456789",
      reglas,
      premios,
      createdAt: Date.now()
    };

    batch.set(comercioRef, nuevoComercio);

    // Prepare users to create
    const usersToCreate = [
      { email: "admin@puntosnb.com", pass: "123456", nombre: "Admin Prueba", rol: "admin_comercio" as const, comercioId },
      { email: "vendedor@puntosnb.com", pass: "123456", nombre: "Vendedor Prueba", rol: "vendedor" as const, comercioId },
      { email: "cliente@puntosnb.com", pass: "123456", nombre: "Cliente Prueba", rol: "cliente" as const, comercioId: undefined }
    ];

    for (const u of usersToCreate) {
      let uid = "";
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, u.email, u.pass);
        uid = userCredential.user.uid;
      } catch (err: any) {
        if (err.code === 'auth/email-already-in-use') {
          // If user exists, sign in to get their UID
          const { signInWithEmailAndPassword } = await import("firebase/auth");
          const userCredential = await signInWithEmailAndPassword(auth, u.email, u.pass);
          uid = userCredential.user.uid;
        } else {
          throw err;
        }
      }

      // Create user doc in Firestore
      const userDocRef = doc(db, "users", uid);
      const userData: Usuario = {
        uid,
        email: u.email,
        nombre: u.nombre,
        rol: u.rol,
        createdAt: Date.now(),
        ...(u.comercioId ? { comercioId: u.comercioId } : {})
      };
      
      batch.set(userDocRef, userData);
      
      // Sign out immediately so we can create the next one without issues
      await signOut(auth);
    }

    // Commit batch for Firestore docs
    await batch.commit();

    console.log("Base de datos poblada exitosamente!");
    return { success: true, message: "Datos de prueba creados correctamente." };
    
  } catch (error: any) {
    console.error("Error poblando base de datos:", error);
    return { success: false, message: error.message };
  }
};
