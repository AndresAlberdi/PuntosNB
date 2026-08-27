import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

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

    // Si es la primera operación activa, programamos el temporizador de 1 segundo
    if (!timerRef.current && activeOperationsRef.current === 1) {
      timerRef.current = setTimeout(() => {
        if (activeOperationsRef.current > 0) {
          setShowSpinner(true);
        }
      }, 1000);
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

  // Interceptor global inteligente: cualquier clic en botones / submits
  // iniciará una guardia visual de espera si la operación demora más de 1000ms.
  useEffect(() => {
    let clickTimer: any = null;
    let isProcessingClick = false;

    const handleFormSubmit = () => {
      // Iniciar guardia de 1 segundo para envíos de formularios
      activeOperationsRef.current += 1;
      if (!timerRef.current && activeOperationsRef.current === 1) {
        timerRef.current = setTimeout(() => {
          if (activeOperationsRef.current > 0) {
            setShowSpinner(true);
          }
        }, 1000);
      }
      
      // Auto-limpieza tras 15 segundos si no hay recarga o error no capturado
      setTimeout(() => {
        if (activeOperationsRef.current > 0) {
          activeOperationsRef.current = Math.max(0, activeOperationsRef.current - 1);
          if (activeOperationsRef.current === 0) {
            if (timerRef.current) {
              clearTimeout(timerRef.current);
              timerRef.current = null;
            }
            setShowSpinner(false);
          }
        }
      }, 15000);
    };

    const handleButtonClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const button = target?.closest('button, input[type="submit"], [role="button"]');
      
      if (!button) return;

      // Si el botón está deshabilitado o ya estamos esperando, no hacer nada
      if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
        return;
      }

      // Si no hay temporizador activo y no es un simple botón de cierre modal sin red
      if (!isProcessingClick && activeOperationsRef.current === 0) {
        isProcessingClick = true;
        clickTimer = setTimeout(() => {
          // Si tras 1 segundo hay procesos activos o fetch pendientes
          if (activeOperationsRef.current > 0) {
            setShowSpinner(true);
          }
          isProcessingClick = false;
        }, 1000);
      }
    };

    window.addEventListener('click', handleButtonClick, true);
    window.addEventListener('submit', handleFormSubmit, true);

    return () => {
      window.removeEventListener('click', handleButtonClick, true);
      window.removeEventListener('submit', handleFormSubmit, true);
      if (clickTimer) clearTimeout(clickTimer);
    };
  }, []);

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
              <div className="w-14 h-14 border-4 border-purple-200 dark:border-purple-900/40 border-t-purple-600 dark:border-t-purple-400 rounded-full animate-spin"></div>
              {/* Isotipo central */}
              <div className="absolute w-6 h-6 flex items-center justify-center font-black text-xs text-purple-700 dark:text-purple-300">
                H
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
