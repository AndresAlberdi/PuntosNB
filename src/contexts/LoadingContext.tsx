import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface LoadingContextType {
  isGlobalLoading: boolean;
  startAsyncAction: <T>(actionPromiseOrFn: Promise<T> | (() => Promise<T>)) => Promise<T>;
}

const LoadingContext = createContext<LoadingContextType>({
  isGlobalLoading: false,
  startAsyncAction: async (action) => (typeof action === 'function' ? action() : action),
});

export const useGlobalLoading = () => useContext(LoadingContext);

export const LoadingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showSpinner, setShowSpinner] = useState(false);
  const activeOperationsRef = useRef(0);
  const timerRef = useRef<any>(null);

  const startAsyncAction = useCallback(async <T,>(action: Promise<T> | (() => Promise<T>)): Promise<T> => {
    activeOperationsRef.current += 1;

    // Si es la primera operación activa, programamos el temporizador de 250ms
    if (!timerRef.current && activeOperationsRef.current === 1) {
      timerRef.current = setTimeout(() => {
        if (activeOperationsRef.current > 0) {
          setShowSpinner(true);
        }
      }, 250);
    }

    try {
      if (typeof action === 'function') {
        return await action();
      }
      return await action;
    } finally {
      activeOperationsRef.current = Math.max(0, activeOperationsRef.current - 1);
      if (activeOperationsRef.current === 0) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setShowSpinner(false);
      }
    }
  }, []);

  // Monitoreo seguro de acciones asíncronas
  return (
    <LoadingContext.Provider value={{ isGlobalLoading: showSpinner, startAsyncAction }}>
      {children}
      {showSpinner && (
        <div 
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm transition-all duration-300 pointer-events-auto select-none"
          role="status"
          aria-live="polite"
        >
          <div className="bg-white/95 dark:bg-gray-900/95 border border-purple-200 dark:border-purple-800/50 shadow-2xl rounded-3xl p-6 flex flex-col items-center gap-4 max-w-[280px] w-full text-center transform scale-100 animate-scale-up">
            <div className="relative flex items-center justify-center">
              {/* Ruedita móvil animada con la paleta de Hipatia */}
              <div className="w-16 h-16 border-4 border-purple-200 dark:border-purple-900/40 border-t-purple-600 dark:border-t-purple-400 rounded-full animate-spin"></div>
              {/* Logo animado de Hipatia en el centro */}
              <div className="absolute w-8 h-8 flex items-center justify-center">
                <img 
                  src="/logo-hipatia.png" 
                  alt="Hipatia Logo" 
                  className="w-7 h-7 object-contain animate-pulse"
                />
              </div>
            </div>
            
            <div className="space-y-1">
              <p className="text-sm font-black text-gray-800 dark:text-gray-100 tracking-tight">
                Procesando solicitud...
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                Por favor espera un momento
              </p>
            </div>
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  );
};
