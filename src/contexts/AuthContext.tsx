import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, getDocs, collection, query, where, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Usuario, Comercio, RolUsuario } from '../types';
import { isSuperAdminEmail } from '../utils/env';

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

        unsubUserDoc = onSnapshot(doc(db, 'users', user.uid), async (userDoc) => {
          if (userDoc.exists()) {
            setUserData(userDoc.data() as Usuario);
            setLoading(false);
          } else {
            // Auto-recuperación: Si el documento por UID no existe, buscar por email o aprovisionar por comercio
            const userEmail = user.email ? user.email.toLowerCase().trim() : '';
            if (userEmail) {
              try {
                // 1. Buscar en users por campo email
                const qEmail = query(collection(db, 'users'), where('email', '==', userEmail));
                const snapEmail = await getDocs(qEmail);
                if (!snapEmail.empty) {
                  const existingDoc = snapEmail.docs[0];
                  const existingData = existingDoc.data() as Usuario;
                  const syncedData: Usuario = {
                    ...existingData,
                    uid: user.uid,
                    email: userEmail
                  };
                  await setDoc(doc(db, 'users', user.uid), syncedData, { merge: true });
                  setUserData(syncedData);
                  setLoading(false);
                  return;
                }

                // 2. Si no existe, verificar si es SuperAdmin por variable de entorno
                if (isSuperAdminEmail(userEmail)) {
                  const superAdminData: Usuario = {
                    uid: user.uid,
                    email: userEmail,
                    usuario: userEmail,
                    nombre: 'Super Administrador',
                    rol: 'superadmin',
                    createdAt: Date.now()
                  };
                  await setDoc(doc(db, 'users', user.uid), superAdminData, { merge: true });
                  setUserData(superAdminData);
                  setLoading(false);
                  return;
                }

                // 3. Auto-aprovisionar basándose en el dominio o nombre del comercio registrado
                const domain = userEmail.split('@')[1];
                if (domain) {
                  const cleanDomainName = domain.split('.')[0].toLowerCase();
                  const allComerciosSnap = await getDocs(collection(db, 'comercios'));
                  const match = allComerciosSnap.docs.find(c => {
                    const comData = c.data() as Comercio;
                    return (
                      (comData.dominio && comData.dominio.toLowerCase().trim() === domain) ||
                      (comData.nombre && comData.nombre.toLowerCase().trim() === cleanDomainName) ||
                      (comData.nombre && cleanDomainName.includes(comData.nombre.toLowerCase().trim()))
                    );
                  });

                  if (match) {
                    const prefix = userEmail.split('@')[0].toLowerCase();
                    const rol: RolUsuario = prefix.startsWith('admin') ? 'admin_comercio' : 'vendedor';
                    const autoUserData: Usuario = {
                      uid: user.uid,
                      email: userEmail,
                      usuario: userEmail,
                      nombre: prefix.charAt(0).toUpperCase() + prefix.slice(1),
                      rol,
                      comercioId: match.id,
                      createdAt: Date.now()
                    };
                    await setDoc(doc(db, 'users', user.uid), autoUserData, { merge: true });
                    setUserData(autoUserData);
                    setLoading(false);
                    return;
                  }
                }
              } catch (recovErr) {
                console.error("Error en auto-recuperación de usuario:", recovErr);
              }
            }

            setUserData(null);
            setLoading(false);
          }
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
