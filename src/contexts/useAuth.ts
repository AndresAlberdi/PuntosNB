/**
 * Contexto de autenticación y su hook de acceso.
 *
 * Viven en este archivo, separados de `AuthContext.tsx`, para que aquel exporte únicamente el
 * componente `AuthProvider`: React Fast Refresh solo conserva el estado de un módulo cuando todo
 * lo que este exporta son componentes.
 */
import { createContext, useContext } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Usuario } from '../types';

export interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: Usuario | null;
  loading: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userData: null,
  loading: true,
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);
