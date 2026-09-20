import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Usuario } from '../types';
import { AuthContext } from './useAuth';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);
  // Última marca de claims aplicada, para refrescar el token una sola vez por cambio.
  const ultimosClaims = useRef<number | null>(null);

  useEffect(() => {
    let unsubUserDoc: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);

      if (!user) {
        // Ya no existe la "sesión" de vendedor en localStorage: el vendedor entra con un
        // custom token emitido por el servidor tras validar su PIN (H-04).
        ultimosClaims.current = null;
        setUserData(null);
        setLoading(false);
        if (unsubUserDoc) unsubUserDoc();
        return;
      }

      unsubUserDoc = onSnapshot(
        doc(db, 'users', user.uid),
        async (userDoc) => {
          if (userDoc.exists()) {
            const datos = userDoc.data() as Usuario & { claimsUpdatedAt?: Timestamp };

            // El servidor avisa por este campo que cambió el rol o el comercio en el token.
            const marca = datos.claimsUpdatedAt?.toMillis?.() ?? null;
            if (marca && ultimosClaims.current !== marca) {
              ultimosClaims.current = marca;
              try {
                await user.getIdToken(true);
              } catch (e) {
                console.warn('No se pudo refrescar el token tras el cambio de rol:', e);
              }
            }

            setUserData(datos);
          } else {
            // Sin documento de perfil no hay rol. El perfil de cliente se crea al aceptar los
            // términos; los roles administrativos los asigna el servidor. Se eliminaron la
            // auto-recuperación por correo (H-02), el autoaprovisionamiento por dominio (H-03)
            // y la asignación de superadmin desde el cliente (H-09).
            setUserData(null);
          }
          setLoading(false);
        },
        (error) => {
          console.error('Error al leer el perfil del usuario:', error);
          setUserData(null);
          setLoading(false);
        },
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, []);

  const logout = async () => {
    ultimosClaims.current = null;
    setUserData(null);
    setCurrentUser(null);
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Error al cerrar sesión:', e);
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, userData, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
