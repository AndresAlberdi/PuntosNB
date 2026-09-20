/**
 * Contexto de la ruedita global de espera y su hook de acceso.
 *
 * Viven en este archivo, separados de `LoadingContext.tsx`, para que aquel exporte únicamente el
 * componente `LoadingProvider`: React Fast Refresh solo conserva el estado de un módulo cuando
 * todo lo que este exporta son componentes.
 */
import { createContext, useContext } from 'react';

export interface LoadingContextType {
  isGlobalLoading: boolean;
  startAsyncAction: <T>(actionPromiseOrFn: Promise<T> | (() => Promise<T>)) => Promise<T>;
}

export const LoadingContext = createContext<LoadingContextType>({
  isGlobalLoading: false,
  startAsyncAction: async (action) => (typeof action === 'function' ? action() : action),
});

export const useGlobalLoading = () => useContext(LoadingContext);
