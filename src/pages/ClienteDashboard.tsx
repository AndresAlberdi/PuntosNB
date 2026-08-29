import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, runTransaction, setDoc, getDoc } from 'firebase/firestore';
import { Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGlobalLoading } from '../contexts/LoadingContext';
import { Scanner } from '@yudiel/react-qr-scanner';
import { QRCodeSVG } from 'qrcode.react';
import type { SaldoPunto, SesionQR, Transaccion, Premio, Comercio, AsignacionInfluencer, CanjeCodigo, Usuario } from '../types';
import { CLIENT_AVATARS, getPaletteStyle } from '../utils/theme';
import { generarCodigoUnicoQR } from '../utils/qr';
import { validateCodeRedemption } from '../utils/influencers';
import { checkComercioPrepagoStatus } from '../utils/reports';

// ==========================================
// SUB-VIEW: DASHBOARD INICIAL (BIENVENIDA)
// ==========================================
interface DashboardHomeProps {
  todosLosComercios: Comercio[];
  saldosMap: Record<string, number>;
  puntosUsados: number;
  transacciones: Transaccion[];
  onOpenScanner: () => void;
  onCanjearCodigoInfluencer: (codigo: string) => Promise<{ ok: boolean; msg: string }>;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({
  todosLosComercios,
  saldosMap,
  puntosUsados,
  transacciones,
  onOpenScanner,
  onCanjearCodigoInfluencer
}) => {
  const { userData } = useAuth();
  const [influencerCode, setInfluencerCode] = useState('');
  const [loadingCanje, setLoadingCanje] = useState(false);
  const [canjeFeedback, setCanjeFeedback] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);
  
  // Calcular puntos disponibles totales
  const puntosDisponibles = Object.values(saldosMap).reduce((a, b) => a + b, 0);

  // Filtrar comercios donde el cliente tiene saldo activo
  const comerciosActivos = todosLosComercios.filter(c => saldosMap[c.id] > 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Mensaje de Bienvenida */}
      <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm flex items-center gap-4">
        <img 
          src={userData?.avatarUrl || CLIENT_AVATARS[0]} 
          alt="Avatar" 
          className="w-16 h-16 rounded-full border-2 border-brand-primary bg-white object-contain" 
        />
        <div>
          <h2 className="text-2xl font-black text-gray-800">¡Hola, {userData?.nombre || 'Cliente'}!</h2>
          <p className="text-xs text-gray-500">Bienvenido a tu monedero de fidelidad multi-marca. Acumula y canjea premios en todos tus comercios favoritos.</p>
        </div>
      </div>

      {/* Tarjetas de Estadísticas */}
      <div className="grid grid-cols-2 gap-4">
        <Link to="/cliente/comercios" className="bg-gradient-to-br from-brand-primary to-brand-secondary text-white p-6 rounded-2xl shadow-sm border border-brand-border hover:shadow-md transition">
          <span className="block text-xs uppercase font-bold tracking-wider opacity-85">Puntos Disponibles</span>
          <span className="block text-4xl font-black mt-2">{puntosDisponibles}</span>
          <span className="block text-xs mt-1 opacity-75">En todos tus comercios</span>
        </Link>
        <Link to="/cliente/comercios" className="bg-white p-6 rounded-2xl shadow-sm border border-brand-border flex flex-col justify-between hover:shadow-md transition group">
          <div>
            <span className="block text-xs uppercase font-bold text-gray-400 tracking-wider group-hover:text-gray-600 transition">Puntos Canjeados</span>
            <span className="block text-4xl font-black text-gray-700 mt-2">{puntosUsados}</span>
          </div>
          <span className="block text-xs text-gray-500 mt-1">¡Sigue acumulando premios!</span>
        </Link>
      </div>

      {/* Accesos Rápidos */}
      <div className="grid sm:grid-cols-2 gap-4">
        <button
          onClick={onOpenScanner}
          className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white font-bold py-4 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
          Escanear Código para Acumular
        </button>
        <Link
          to="/cliente/comercios"
          className="w-full bg-brand-bg-light hover:bg-opacity-80 text-brand-primary border border-brand-border font-bold py-4 rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm text-center"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          Ver Todos los Comercios
        </Link>
      </div>

      {/* Código de Canje / Influencer */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-6 rounded-2xl border border-purple-100 shadow-sm space-y-3">
        <div>
          <h3 className="text-base font-black text-purple-900 mb-1">¿Tienes un código promocional o de influencer?</h3>
          <p className="text-xs text-purple-700">Ingresa el código para recibir puntos de regalo en tus comercios asociados.</p>
        </div>
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="Ej. NATGOLD" 
            className="flex-1 border border-purple-200 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 font-bold uppercase tracking-wider text-sm bg-white"
            value={influencerCode}
            onChange={e => {
              setInfluencerCode(e.target.value.toUpperCase());
              setCanjeFeedback(null);
            }}
          />
          <button 
            disabled={!influencerCode || loadingCanje}
            onClick={async () => {
              setLoadingCanje(true);
              setCanjeFeedback(null);
              const res = await onCanjearCodigoInfluencer(influencerCode);
              setLoadingCanje(false);
              setCanjeFeedback({ texto: res.msg, tipo: res.ok ? 'success' : 'error' });
              if (res.ok) {
                setInfluencerCode('');
              }
            }}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer ${!influencerCode || loadingCanje ? 'bg-purple-200 text-purple-400 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-700 shadow-md'}`}
          >
            {loadingCanje ? '...' : 'Canjear'}
          </button>
        </div>
        
        {/* Mensaje adyacente al botón de canje */}
        {canjeFeedback && (
          <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold animate-fade-in ${
            canjeFeedback.tipo === 'success' ? 'bg-green-100 text-green-800 border-green-300' :
            'bg-red-100 text-red-800 border-red-300'
          }`}>
            <span>{canjeFeedback.texto}</span>
            <button onClick={() => setCanjeFeedback(null)} className="font-black text-sm ml-2">✕</button>
          </div>
        )}
      </div>

      {/* Tus Comercios Activos */}
      <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm">
        <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4">Tus Comercios Activos</h3>
        {comerciosActivos.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-xs">
            Aún no tienes puntos en ningún comercio. ¡Explora los comercios y empieza a acumular!
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {comerciosActivos.map(c => {
              const status = checkComercioPrepagoStatus(c);
              return (
                <Link 
                  key={c.id} 
                  to={`/cliente/comercios/${c.id}`} 
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-brand-border hover:bg-brand-bg-light transition relative"
                >
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded-lg border bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center font-bold text-gray-400 text-xs flex-shrink-0">NB</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-gray-800 text-sm truncate">{c.nombre}</h4>
                      {!status.puedeOperar && (
                        <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">Deshabilitado</span>
                      )}
                    </div>
                    <span className="block text-xs font-black text-brand-primary">{saldosMap[c.id]} Puntos</span>
                  </div>
                  <span className="text-gray-400 text-xs font-bold">➔</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Historial Corto */}
      <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm">
        <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4">Movimientos Recientes</h3>
        {transacciones.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-xs">No hay transacciones registradas.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {transacciones.slice(0, 5).map(tx => {
              const comercio = todosLosComercios.find(c => c.id === tx.comercioId);
              return (
                <li key={tx.id} className="py-3 flex justify-between items-center text-xs">
                  <div className="min-w-0 flex-1 pr-4">
                    <span className="font-bold text-gray-800 block truncate">{comercio?.nombre || 'Comercio'}</span>
                    <span className="text-[10px] text-gray-400 block">{new Date(tx.fechaHora).toLocaleDateString()} | {tx.tipo}</span>
                  </div>
                  <span className={`font-black text-sm ${tx.tipo === 'ACUMULACION' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.tipo === 'ACUMULACION' ? '+' : ''}{tx.puntos} pts
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

// ==========================================
// SUB-VIEW: LISTA GLOBAL DE PREMIOS
// ==========================================
interface PremiosListProps {
  todosLosComercios: Comercio[];
  saldosMap: Record<string, number>;
  onGenerarCanje: (comercioId: string, premio: Premio) => void;
}

const PremiosList: React.FC<PremiosListProps> = ({ todosLosComercios, saldosMap, onGenerarCanje }) => {
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE'>('AVAILABLE');
  
  let premiosData: { comercio: Comercio, premio: Premio, saldo: number, canAfford: boolean, puedeOperar: boolean }[] = [];
  
  todosLosComercios.forEach(c => {
    const saldo = saldosMap[c.id] || 0;
    const status = checkComercioPrepagoStatus(c);
    (c.premios || []).filter(p => p.activo).forEach(p => {
      premiosData.push({
        comercio: c,
        premio: p,
        saldo: saldo,
        canAfford: saldo >= p.puntosRequeridos,
        puedeOperar: status.puedeOperar
      });
    });
  });

  if (filter === 'AVAILABLE') {
    premiosData = premiosData.filter(d => d.canAfford);
  }

  premiosData.sort((a, b) => {
    if (a.canAfford && !b.canAfford) return -1;
    if (!a.canAfford && b.canAfford) return 1;
    return a.premio.puntosRequeridos - b.premio.puntosRequeridos;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/cliente" className="text-xs font-bold text-brand-primary hover:underline">← Volver al Dashboard</Link>
          <h2 className="text-2xl font-black text-gray-800 mt-1">Catálogo de Premios</h2>
        </div>
        <div className="bg-gray-100 p-1 rounded-xl inline-flex text-xs font-bold">
          <button 
            onClick={() => setFilter('AVAILABLE')}
            className={`px-3 py-1.5 rounded-lg transition ${filter === 'AVAILABLE' ? 'bg-white shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Mis Alcanzables
          </button>
          <button 
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg transition ${filter === 'ALL' ? 'bg-white shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Todos
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {premiosData.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-400 bg-white rounded-2xl border text-xs">
            No hay premios disponibles en esta categoría.
          </div>
        ) : (
          premiosData.map((d, idx) => (
            <div key={`${d.comercio.id}_${d.premio.id}_${idx}`} className={`bg-white p-5 rounded-2xl border transition shadow-sm flex flex-col justify-between text-xs ${d.canAfford ? 'border-brand-border' : 'border-gray-100 opacity-75'}`}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  {d.comercio.logoUrl ? (
                    <img src={d.comercio.logoUrl} alt="Logo" className="w-7 h-7 object-contain rounded-md bg-white flex-shrink-0 border" />
                  ) : (
                    <div className="w-7 h-7 bg-brand-bg-light text-brand-primary rounded flex items-center justify-center font-bold text-[10px]">NB</div>
                  )}
                  <span className="font-bold text-gray-700 truncate">{d.comercio.nombre}</span>
                </div>
                <strong className="block text-gray-800 text-sm">{d.premio.nombre}</strong>
                <p className="text-gray-500 text-[11px] mt-1 line-clamp-2">{d.premio.descripcion}</p>
              </div>

              <div className="mt-4 pt-3 border-t flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase block">Puntos</span>
                  <span className="font-black text-brand-primary text-sm">{d.premio.puntosRequeridos} pts</span>
                </div>
                
                {!d.puedeOperar ? (
                  <span className="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded font-bold">
                    Comercio Deshabilitado
                  </span>
                ) : (
                  <button
                    disabled={!d.canAfford}
                    onClick={() => onGenerarCanje(d.comercio.id, d.premio)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${d.canAfford ? 'bg-brand-primary text-white hover:bg-brand-primary-hover shadow-sm cursor-pointer' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    Canjear
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ==========================================
// SUB-VIEW: LISTA DE COMERCIOS
// ==========================================
const ComerciosList: React.FC<{ todosLosComercios: Comercio[], saldosMap: Record<string, number> }> = ({ todosLosComercios, saldosMap }) => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/cliente" className="text-xs font-bold text-brand-primary hover:underline">← Volver al Dashboard</Link>
          <h2 className="text-2xl font-black text-gray-800 mt-1">Directorio de Comercios</h2>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {todosLosComercios.map(c => {
          const saldo = saldosMap[c.id] || 0;
          const status = checkComercioPrepagoStatus(c);
          return (
            <Link
              key={c.id}
              to={`/cliente/comercios/${c.id}`}
              className="bg-white p-5 rounded-2xl border border-gray-100 hover:border-brand-border shadow-sm hover:shadow-md transition flex flex-col justify-between text-xs"
            >
              <div className="flex items-center gap-3 mb-3">
                {c.logoUrl ? (
                  <img src={c.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded-xl border bg-white flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-brand-bg-light text-brand-primary rounded-xl flex items-center justify-center font-black text-base border">NB</div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-gray-800 text-sm truncate">{c.nombre}</h4>
                  <span className="text-[10px] text-gray-400">NIT: {c.nit_rut}</span>
                </div>
              </div>

              {!status.puedeOperar && (
                <div className="mb-2 p-1.5 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-bold text-center">
                  Comercio Deshabilitado Temporalmente
                </div>
              )}

              <div className="pt-3 border-t flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase block">Tu Saldo</span>
                  <span className="text-base font-black text-brand-primary">{saldo} pts</span>
                </div>
                <span className="text-xs font-bold text-brand-primary">Ver Catálogo ➔</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

// ==========================================
// SUB-VIEW: PERFIL DE UN COMERCIO
// ==========================================
const ComercioView: React.FC<{
  todosLosComercios: Comercio[];
  saldosMap: Record<string, number>;
  transacciones: Transaccion[];
  onOpenScanner: () => void;
  onGenerarCanje: (comercioId: string, premio: Premio) => void;
}> = ({ todosLosComercios, saldosMap, transacciones, onOpenScanner, onGenerarCanje }) => {
  const { comercioId } = useParams();
  const navigate = useNavigate();
  const comercio = todosLosComercios.find(c => c.id === comercioId);

  if (!comercio) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 font-bold mb-4">Comercio no encontrado.</p>
        <Link to="/cliente/comercios" className="text-brand-primary font-bold hover:underline">Volver a comercios</Link>
      </div>
    );
  }

  const saldo = saldosMap[comercio.id] || 0;
  const misTransacciones = transacciones.filter(tx => tx.comercioId === comercio.id);
  const premiosActivos = (comercio.premios || []).filter(p => p.activo);
  const productosCatalog = (comercio.productos || []).filter(p => p.activo);
  const status = checkComercioPrepagoStatus(comercio);

  return (
    <div style={getPaletteStyle(comercio.paletteId)} className="space-y-6 animate-fade-in text-xs">
      
      {!status.puedeOperar && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm text-red-800">
          <strong className="font-bold block">Comercio Deshabilitado Temporalmente</strong>
          Este comercio no se encuentra habilitado para entregar puntos ni validar canjes en este momento.
        </div>
      )}

      {/* Cabecera del Comercio */}
      <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {comercio.logoUrl ? (
            <img src={comercio.logoUrl} alt="Logo" className="w-16 h-16 object-contain rounded-xl border bg-white flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 bg-brand-bg-light text-brand-primary rounded-xl flex items-center justify-center font-black text-xl border">NB</div>
          )}
          <div>
            <h2 className="text-2xl font-black text-gray-800 leading-tight">{comercio.nombre}</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">NIT: {comercio.nit_rut}</p>
          </div>
        </div>
        
        <div className="text-right">
          <span className="block text-3xl font-black text-brand-primary">{saldo}</span>
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Mis Puntos</span>
        </div>
      </div>

      {/* Botones de acción */}
      <div className="grid sm:grid-cols-2 gap-4">
        <button
          onClick={onOpenScanner}
          disabled={!status.puedeOperar}
          className={`font-bold py-3.5 rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm ${
            status.puedeOperar ? 'bg-brand-primary hover:bg-brand-primary-hover text-white cursor-pointer' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
          Acumular Puntos Aquí
        </button>
        <button
          onClick={() => navigate('/cliente/comercios')}
          className="bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 font-bold py-3.5 rounded-xl transition text-sm text-center cursor-pointer"
        >
          ← Volver a Comercios
        </button>
      </div>

      {/* Catálogo de Productos Especiales con Fotos */}
      {productosCatalog.length > 0 && (
        <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm space-y-3">
          <h3 className="font-bold text-gray-800 uppercase tracking-wider text-xs border-b pb-2 text-brand-primary">
            Productos Especiales que Suman Puntos
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {productosCatalog.map(prod => (
              <div key={prod.id} className="p-2.5 bg-gray-50 rounded-xl border border-gray-100 flex flex-col items-center text-center">
                {prod.imagenUrl ? (
                  <img src={prod.imagenUrl} alt={prod.nombre} className="w-16 h-16 object-cover rounded-lg border mb-2 bg-white" />
                ) : (
                  <div className="w-16 h-16 bg-purple-100 text-purple-700 rounded-lg flex items-center justify-center font-bold text-xl mb-2">📦</div>
                )}
                <span className="font-bold text-gray-800 text-xs truncate w-full">{prod.nombre}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Catálogo y Movimientos */}
      <div className="grid md:grid-cols-2 gap-6">
        
        {/* Catálogo de Premios */}
        <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-gray-800 mb-4 uppercase tracking-wider text-xs border-b pb-2 text-brand-primary">Premios de {comercio.nombre}</h3>
            {premiosActivos.length === 0 ? (
              <p className="text-gray-400 py-4 text-center">Este comercio no tiene premios disponibles por ahora.</p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {premiosActivos.map(p => {
                  const canAfford = saldo >= p.puntosRequeridos;
                  return (
                    <div key={p.id} className={`flex justify-between items-center p-3 rounded-xl border transition ${canAfford ? 'border-brand-border bg-brand-bg-light' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                      <div className="min-w-0 flex-1 pr-2">
                        <strong className="block text-gray-800 truncate">{p.nombre}</strong>
                        <span className="block text-[11px] text-gray-500 truncate">{p.descripcion}</span>
                        <span className="block text-xs font-black text-brand-primary mt-0.5">{p.puntosRequeridos} pts</span>
                      </div>
                      <button
                        disabled={!canAfford || !status.puedeOperar}
                        onClick={() => onGenerarCanje(comercio.id, p)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${canAfford && status.puedeOperar ? 'bg-brand-primary text-white hover:bg-brand-primary-hover shadow-sm cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                      >
                        Canjear
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Historial de Movimientos de este Comercio */}
        <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 uppercase tracking-wider text-xs border-b pb-2 text-brand-primary">Tus Movimientos</h3>
          {misTransacciones.length === 0 ? (
            <p className="text-gray-400 py-4 text-center">No registras movimientos en este comercio.</p>
          ) : (
            <ul className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {misTransacciones.map(tx => (
                <li key={tx.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex justify-between items-start text-xs">
                  <div>
                    <span className="font-bold text-gray-800 block">{tx.tipo}</span>
                    <span className="text-gray-400 block mt-0.5">{new Date(tx.fechaHora).toLocaleString()}</span>
                  </div>
                  <span className={`font-black ${tx.tipo === 'ACUMULACION' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.tipo === 'ACUMULACION' ? '+' : ''}{tx.puntos} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
};

// ==========================================
// MAIN COMPONENT: CLIENTE DASHBOARD
// ==========================================
const ClienteDashboard: React.FC = () => {
  const { userData } = useAuth();
  const { startAsyncAction } = useGlobalLoading();
  const navigate = useNavigate();

  const [todosLosComercios, setTodosLosComercios] = useState<Comercio[]>([]);
  const [saldosMap, setSaldosMap] = useState<Record<string, number>>({});
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [puntosUsados, setPuntosUsados] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Escaneo y canje
  const [escaneando, setEscaneando] = useState(false);
  const [codigoManual, setCodigoManual] = useState('');
  const [scannerMsg, setScannerMsg] = useState<{ texto: string, tipo: 'success' | 'error' } | null>(null);

  // Modal QR de Canje
  const [qrCanje, setQrCanje] = useState<{ id: string, premio: string, puntos: number } | null>(null);

  const cargarDatos = async () => {
    if (!userData) return;
    try {
      const comerciosSnap = await getDocs(collection(db, 'comercios'));
      const listC: Comercio[] = [];
      comerciosSnap.forEach(d => listC.push(d.data() as Comercio));
      setTodosLosComercios(listC);

      const saldosQ = query(collection(db, 'puntos_saldos'), where('clienteId', '==', userData.uid));
      const saldosSnap = await getDocs(saldosQ);
      const sMap: Record<string, number> = {};
      saldosSnap.forEach(d => {
        const s = d.data() as SaldoPunto;
        sMap[s.comercioId] = s.saldoTotal;
      });
      setSaldosMap(sMap);

      const txQ = query(collection(db, 'transacciones'), where('clienteId', '==', userData.uid));
      const txSnap = await getDocs(txQ);
      const listTx: Transaccion[] = [];
      let totalRedimidos = 0;
      txSnap.forEach(d => {
        const tx = d.data() as Transaccion;
        listTx.push(tx);
        if (tx.tipo === 'CANJE') {
          totalRedimidos += Math.abs(tx.puntos);
        }
      });
      listTx.sort((a, b) => b.fechaHora - a.fechaHora);
      setTransacciones(listTx);
      setPuntosUsados(totalRedimidos);
    } catch (error) {
      console.error("Error cargando información del cliente", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    cargarDatos();
  }, [userData]);

  const procesarQR = async (rawCode: string) => {
    if (!userData) return;
    const cleanCode = rawCode.trim();
    if (!cleanCode) return;

    setScannerMsg(null);

    await startAsyncAction(async () => {
      try {
        // 1. Verificar si es código de influencer
        const codRef = doc(db, 'codigos_influencer', cleanCode.toUpperCase());
        const codSnap = await getDoc(codRef);
        if (codSnap.exists()) {
          const res = await handleCanjearCodigoInfluencer(cleanCode.toUpperCase());
          if (res.ok) {
            setEscaneando(false);
          } else {
            setScannerMsg({ texto: res.msg, tipo: 'error' });
          }
          return;
        }

        // 2. Sesión QR regular de vendedor
        const sesionRef = doc(db, 'sesiones_qr', cleanCode);

        await runTransaction(db, async (transaction) => {
          const sesionDoc = await transaction.get(sesionRef);
          if (!sesionDoc.exists()) {
            throw new Error("El código QR o de canje no es válido o no existe.");
          }

          const sesion = sesionDoc.data() as SesionQR;
          if (sesion.estado !== 'PENDIENTE') {
            throw new Error("Este código QR ya fue utilizado o ha expirado.");
          }
          if (sesion.tipo !== 'ACUMULACION') {
            throw new Error("Este código no es para acumular puntos.");
          }

          // Verificar prepago del comercio
          const comercioRef = doc(db, 'comercios', sesion.comercioId);
          const comDoc = await transaction.get(comercioRef);
          if (comDoc.exists()) {
            const com = comDoc.data() as Comercio;
            const status = checkComercioPrepagoStatus(com);
            if (!status.puedeOperar) {
              throw new Error("Comercio deshabilitado temporalmente.");
            }
          }

          const saldoId = `${userData.uid}_${sesion.comercioId}`;
          const saldoRef = doc(db, 'puntos_saldos', saldoId);
          const saldoDoc = await transaction.get(saldoRef);

          const puntos = sesion.puntosCalculados || 0;

          transaction.update(sesionRef, { estado: 'USADO' });

          const transaccionRef = doc(collection(db, 'transacciones'));
          const nuevaTransaccion: Transaccion = {
            id: transaccionRef.id,
            fechaHora: Date.now(),
            clienteId: userData.uid,
            clienteAlias: userData.email?.split('@')[0] || 'Cliente',
            comercioId: sesion.comercioId,
            vendedorId: sesion.creadorId,
            vendedorAlias: sesion.creadorAlias || 'Vendedor',
            montoFactura: sesion.montoFactura || 0,
            nroFactura: sesion.nroFactura || '',
            puntos: puntos,
            tipo: 'ACUMULACION',
            ...(sesion.reglaAplicadaId ? { reglaAplicadaId: sesion.reglaAplicadaId } : {})
          };
          transaction.set(transaccionRef, nuevaTransaccion);

          if (saldoDoc.exists()) {
            const saldoActual = saldoDoc.data() as SaldoPunto;
            transaction.update(saldoRef, {
              saldoTotal: saldoActual.saldoTotal + puntos,
              updatedAt: Date.now()
            });
          } else {
            const nuevoSaldo: SaldoPunto = {
              id: saldoId,
              clienteId: userData.uid,
              comercioId: sesion.comercioId,
              saldoTotal: puntos,
              updatedAt: Date.now()
            };
            transaction.set(saldoRef, nuevoSaldo);
          }
        });

        setEscaneando(false);
        await cargarDatos();
        navigate('/cliente');
      } catch (error: any) {
        console.error(error);
        setScannerMsg({ texto: error.message || "Error al procesar el código.", tipo: 'error' });
      }
    });
  };

  const handleCanjearCodigoInfluencer = async (codigoId: string): Promise<{ ok: boolean; msg: string }> => {
    if (!userData) return { ok: false, msg: "Usuario no autenticado." };

    return await startAsyncAction(async () => {
      try {
        let isCommerceCode = false;
        let codigoData: any = null;
        
        const codInfRef = doc(db, 'codigos_influencer', codigoId);
        const codInfSnap = await getDoc(codInfRef);
        if (codInfSnap.exists()) {
          codigoData = codInfSnap.data();
        } else {
          const codComRef = doc(db, 'codigos_comercio', codigoId);
          const codComSnap = await getDoc(codComRef);
          if (codComSnap.exists()) {
            codigoData = codComSnap.data();
            isCommerceCode = true;
          }
        }

        if (!codigoData) {
          return { ok: false, msg: "El código ingresado no existe." };
        }

        if (codigoData.estado !== 'ACTIVO') {
          return { ok: false, msg: "El código ingresado está inactivo." };
        }

        if (isCommerceCode) {
          const now = Date.now();
          if (now < codigoData.fechaInicio) {
            return { ok: false, msg: "Este código promocional aún no está vigente." };
          }
          if (now > codigoData.fechaFin) {
            return { ok: false, msg: "Este código promocional ya expiró." };
          }
        }

        // Validar prepago del comercio asociado al código
        const comRef = doc(db, 'comercios', codigoData.comercioId);
        const comSnap = await getDoc(comRef);
        let nombreComercio = 'Comercio';
        if (comSnap.exists()) {
          const com = comSnap.data() as Comercio;
          nombreComercio = com.nombre || nombreComercio;
          const status = checkComercioPrepagoStatus(com);
          if (!status.puedeOperar) {
            return { ok: false, msg: "Comercio deshabilitado temporalmente." };
          }
        }

        const qCanjes = query(
          collection(db, 'canjes_codigo'), 
          where('clienteId', '==', userData.uid),
          where('codigoId', '==', codigoId)
        );
        const canjesSnap = await getDocs(qCanjes);
        const canjesUsuario = canjesSnap.docs.map(d => d.data() as CanjeCodigo);
        
        if (isCommerceCode && canjesUsuario.length > 0) {
          return { ok: false, msg: "Ya canjeaste este código anteriormente." };
        }
        
        const saldoId = `${userData.uid}_${codigoData.comercioId}`;
        const saldoRef = doc(db, 'puntos_saldos', saldoId);
        
        await runTransaction(db, async (transaction) => {
          let puntosAEntregarCliente = 0;
          let vendedorId = '';
          let vendedorAlias = '';
          let influencerId: string | undefined = undefined;

          if (!isCommerceCode) {
            const asignId = `${codigoData.comercioId}_${codigoData.influencerId}`;
            const asigRef = doc(db, 'asignaciones_influencer', asignId);
            const asigDoc = await transaction.get(asigRef);
            if (!asigDoc.exists()) throw new Error("La asignación del influencer no fue encontrada.");
            
            const asigData = asigDoc.data() as AsignacionInfluencer;
            const validationResult = validateCodeRedemption(codigoData, asigData, canjesUsuario);
            if (!validationResult.success) {
              throw new Error(validationResult.errorMsg);
            }
            
            puntosAEntregarCliente = validationResult.puntosAEntregarCliente;
            
            transaction.update(asigRef, {
              puntosParaClientes: asigData.puntosParaClientes - puntosAEntregarCliente,
              updatedAt: Date.now()
            });

            // Obtener nombre del influencer
            const infDoc = await transaction.get(doc(db, 'users', codigoData.influencerId));
            const infData = infDoc.exists() ? (infDoc.data() as Usuario) : null;
            vendedorAlias = infData?.nombre || infData?.email?.split('@')[0] || 'Influencer';
            vendedorId = codigoData.influencerId;
            influencerId = codigoData.influencerId;
          } else {
            puntosAEntregarCliente = codigoData.puntosPorCanje;
            vendedorId = codigoData.comercioId;
            vendedorAlias = nombreComercio;
          }
          
          const saldoDoc = await transaction.get(saldoRef);

          const nuevoCanjeRef = doc(collection(db, 'canjes_codigo'));
          const nuevoCanje: CanjeCodigo = {
            id: nuevoCanjeRef.id,
            clienteId: userData.uid,
            codigoId: codigoId,
            comercioId: codigoData.comercioId,
            fechaCanje: Date.now()
          };
          transaction.set(nuevoCanjeRef, nuevoCanje);

          const transaccionRef = doc(collection(db, 'transacciones'));
          const nuevaTransaccion: Transaccion = {
            id: transaccionRef.id,
            fechaHora: Date.now(),
            clienteId: userData.uid,
            clienteAlias: userData.email?.split('@')[0] || 'Cliente',
            comercioId: codigoData.comercioId,
            vendedorId,
            vendedorAlias,
            ...(influencerId ? { influencerId } : {}),
            codigoId: codigoId,
            montoFactura: 0,
            nroFactura: `CÓDIGO ${codigoId}`,
            puntos: puntosAEntregarCliente,
            tipo: 'ACUMULACION',
          };
          transaction.set(transaccionRef, nuevaTransaccion);

          if (saldoDoc.exists()) {
            const saldoActual = saldoDoc.data() as SaldoPunto;
            transaction.update(saldoRef, {
              saldoTotal: saldoActual.saldoTotal + puntosAEntregarCliente,
              updatedAt: Date.now()
            });
          } else {
            transaction.set(saldoRef, {
              id: saldoId,
              clienteId: userData.uid,
              comercioId: codigoData.comercioId,
              saldoTotal: puntosAEntregarCliente,
              updatedAt: Date.now()
            });
          }
        });

        await cargarDatos();
        return { ok: true, msg: `¡Código ${codigoId} canjeado con éxito! Puntos acreditados a tu cuenta.` };

      } catch (error: any) {
        console.error(error);
        return { ok: false, msg: error.message || "Error al procesar el código." };
      }
    });
  };

  const generarQRCanje = async (comercioId: string, premio: Premio) => {
    if (!userData) return;
    await startAsyncAction(async () => {
      try {
        const com = todosLosComercios.find(c => c.id === comercioId);
        if (com) {
          const status = checkComercioPrepagoStatus(com);
          if (!status.puedeOperar) {
            alert("Comercio deshabilitado temporalmente.");
            return;
          }
        }

        const codigo = await generarCodigoUnicoQR(db);
        const sesionData: Omit<SesionQR, 'id'> = {
          tipo: 'CANJE',
          creadorId: userData.uid,
          creadorAlias: userData.email?.split('@')[0] || 'Cliente',
          comercioId: comercioId,
          estado: 'PENDIENTE',
          createdAt: Date.now(),
          puntosCalculados: premio.puntosRequeridos,
          premioId: premio.id
        };

        await setDoc(doc(db, 'sesiones_qr', codigo), sesionData);
        setQrCanje({ id: codigo, premio: premio.nombre, puntos: premio.puntosRequeridos });
      } catch (error: any) {
        console.error("Error al generar código de canje:", error);
        alert(error.message || "Error al generar el código.");
      }
    });
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando dashboard...</div>;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-12">
      
      <Routes>
        <Route 
          path="/" 
          element={
            <DashboardHome 
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
              puntosUsados={puntosUsados}
              transacciones={transacciones}
              onOpenScanner={() => { setEscaneando(true); setScannerMsg(null); }}
              onCanjearCodigoInfluencer={handleCanjearCodigoInfluencer}
            />
          } 
        />
        <Route 
          path="/premios" 
          element={
            <PremiosList 
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
              onGenerarCanje={generarQRCanje}
            />
          } 
        />
        <Route 
          path="/comercios" 
          element={
            <ComerciosList 
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
            />
          } 
        />
        <Route 
          path="/comercios/:comercioId" 
          element={
            <ComercioView 
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
              transacciones={transacciones}
              onOpenScanner={() => { setEscaneando(true); setScannerMsg(null); }}
              onGenerarCanje={generarQRCanje}
            />
          } 
        />
      </Routes>

      {/* Modal Scanner / Introducción de Código */}
      {escaneando && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 text-center">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-black text-gray-800 text-sm">Escanear Código QR</h3>
              <button onClick={() => setEscaneando(false)} className="text-gray-400 font-bold hover:text-black">✕</button>
            </div>

            <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black shadow-inner">
              <Scanner 
                onScan={(result) => {
                  if (result && result.length > 0) {
                    procesarQR(result[0].rawValue);
                  }
                }} 
              />
            </div>

            <div className="pt-2 border-t space-y-2">
              <span className="text-[11px] text-gray-400 font-bold uppercase block">O escribe el código numérico</span>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Ej: 492019" 
                  value={codigoManual}
                  onChange={(e) => { setCodigoManual(e.target.value); setScannerMsg(null); }}
                  className="flex-1 border rounded-xl px-3 py-2 text-center font-mono font-black text-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-white"
                />
                <button
                  onClick={() => procesarQR(codigoManual)}
                  className="bg-brand-primary text-white font-bold px-4 py-2 rounded-xl text-xs hover:bg-brand-primary-hover transition cursor-pointer"
                >
                  Validar
                </button>
              </div>

              {/* Mensaje de error adyacente dentro del modal */}
              {scannerMsg && (
                <div className={`p-2.5 rounded-xl border text-xs font-bold text-left animate-fade-in ${
                  scannerMsg.tipo === 'success' ? 'bg-green-50 text-green-800 border-green-200' :
                  'bg-red-50 text-red-800 border-red-200'
                }`}>
                  {scannerMsg.texto}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal QR de Canje de Premio */}
      {qrCanje && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 text-center">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-black text-gray-800 text-sm">Presenta este Código</h3>
              <button onClick={() => setQrCanje(null)} className="text-gray-400 font-bold hover:text-black">✕</button>
            </div>

            <p className="text-xs text-gray-600">
              Muestra este código al vendedor para recibir tu premio: <strong>{qrCanje.premio}</strong> ({qrCanje.puntos} pts)
            </p>

            <div className="p-4 bg-white rounded-2xl shadow-md border inline-block">
              <QRCodeSVG value={qrCanje.id} size={200} level="H" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-gray-400 font-bold uppercase block">Código numérico</span>
              <span className="text-3xl font-mono font-black text-brand-primary tracking-widest">{qrCanje.id}</span>
            </div>

            <button
              onClick={() => setQrCanje(null)}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              Listo / Cerrar
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default ClienteDashboard;
