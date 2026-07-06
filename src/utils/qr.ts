import { doc, getDoc, Firestore } from 'firebase/firestore';

/**
 * Genera un código aleatorio de 6 dígitos único para sesiones QR.
 * Valida que no colisione con otra sesión PENDIENTE activa (menos de 15 minutos de antigüedad).
 */
export const generarCodigoUnicoQR = async (db: Firestore): Promise<string> => {
  let codigo = '';
  let found = false;
  
  while (!found) {
    // Generar un número aleatorio entre 100000 y 999999
    codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const docRef = doc(db, 'sesiones_qr', codigo);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      found = true;
    } else {
      const data = docSnap.data();
      const isPending = data?.estado === 'PENDIENTE';
      const ageMs = Date.now() - (data?.createdAt || 0);
      
      // Si la sesión existe pero no está PENDIENTE, o tiene más de 15 minutos (expirada),
      // podemos reutilizar/sobrescribir este código.
      if (!isPending || ageMs > 15 * 60 * 1000) {
        found = true;
      }
    }
  }
  
  return codigo;
};
