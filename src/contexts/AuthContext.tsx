import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Usuario } from '../types';

const VENDEDOR_STORAGE_KEY = 'hipatia_vendedor_session';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: Usuario | null;
  loading: boolean;
  loginVendedor: (vendedor: Usuario) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userData: null,
  loading: true,
  loginVendedor: () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  // Cargar sesión interna de vendedor si existe al inicio
  useEffect(() => {
    try {
      const storedVendedor = localStorage.getItem(VENDEDOR_STORAGE_KEY);
      if (storedVendedor) {
        const parsed = JSON.parse(storedVendedor) as Usuario;
        if (parsed && parsed.rol === 'vendedor') {
          setUserData(parsed);
          setLoading(false);
        }
      }
    } catch (e) {
      console.warn("Error leyendo sesión de vendedor:", e);
    }
  }, []);

  useEffect(() => {
    let unsubUserDoc: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        // Limpiar sesión local de vendedor si entra un usuario de Firebase Auth
        localStorage.removeItem(VENDEDOR_STORAGE_KEY);

        unsubUserDoc = onSnapshot(doc(db, 'users', user.uid), (userDoc) => {
          if (userDoc.exists()) {
            setUserData(userDoc.data() as Usuario);
          } else {
            // Sin documento de perfil no hay rol. El perfil de cliente se crea al aceptar los
            // términos en el inicio de sesión; los roles administrativos los asigna el servidor.
            // Se eliminaron la auto-recuperación por correo (H-02), el autoaprovisionamiento por
            // dominio (H-03) y la asignación de superadmin desde el cliente (H-09).
            setUserData(null);
          }
          setLoading(false);
        }, (error) => {
          console.error("Error fetching user data:", error);
          setUserData(null);
          setLoading(false);
        });
      } else {
        // Si no hay usuario de Firebase Auth, verificar si hay sesión de vendedor
        const storedVendedor = localStorage.getItem(VENDEDOR_STORAGE_KEY);
        if (storedVendedor) {
          try {
            setUserData(JSON.parse(storedVendedor) as Usuario);
          } catch {
            setUserData(null);
          }
        } else {
          setUserData(null);
        }
        setLoading(false);
        if (unsubUserDoc) unsubUserDoc();
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, []);

  const loginVendedor = (vendedor: Usuario) => {
    localStorage.setItem(VENDEDOR_STORAGE_KEY, JSON.stringify(vendedor));
    setUserData(vendedor);
    setCurrentUser(null);
    setLoading(false);
  };

  const logout = async () => {
    localStorage.removeItem(VENDEDOR_STORAGE_KEY);
    setUserData(null);
    setCurrentUser(null);
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Error during signOut:", e);
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, userData, loading, loginVendedor, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
