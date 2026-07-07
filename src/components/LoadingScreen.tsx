
export const LoadingScreen = ({ isSplash = false }: { isSplash?: boolean }) => {
  return (
    <div className="flex flex-col justify-center items-center min-h-screen bg-brand-bg-light text-brand-primary">
      <img 
        src="/logo-hipatia.png" 
        alt="Hipatia" 
        className={`w-32 h-auto object-contain ${isSplash ? 'animate-pulse' : 'animate-bounce'}`} 
      />
      {!isSplash && <p className="mt-4 font-medium opacity-70">Cargando...</p>}
    </div>
  );
};
