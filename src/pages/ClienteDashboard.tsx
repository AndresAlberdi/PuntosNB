import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, runTransaction, setDoc } from 'firebase/firestore';
import { Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Scanner } from '@yudiel/react-qr-scanner';
import { QRCodeSVG } from 'qrcode.react';
import type { SaldoPunto, SesionQR, Transaccion, Premio, Comercio } from '../types';
import { CLIENT_AVATARS, getPaletteStyle } from '../utils/theme';
import { generarCodigoUnicoQR } from '../utils/qr';

// ==========================================
// SUB-VIEW: DASHBOARD INICIAL (BIENVENIDA)
// ==========================================
interface DashboardHomeProps {
  todosLosComercios: Comercio[];
  saldosMap: Record<string, number>;
  puntosUsados: number;
  transacciones: Transaccion[];
  onOpenScanner: () => void;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({
  todosLosComercios,
  saldosMap,
  puntosUsados,
  transacciones,
  onOpenScanner
}) => {
  const { userData } = useAuth();
  
  // Calcular puntos disponibles totales
  const puntosDisponibles = Object.values(saldosMap).reduce((a, b) => a + b, 0);

  // Filtrar comercios donde el cliente tiene saldo activo
  const comerciosActivos = todosLosComercios.filter(c => saldosMap[c.id] > 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Mensaje de Bienvenida */}
      <div className="bg-white p-6 rounded-xl border border-brand-border shadow-sm flex items-center gap-4">
        <img 
          src={userData?.avatarUrl || CLIENT_AVATARS[0]} 
          alt="Avatar" 
          className="w-16 h-16 rounded-full border-2 border-brand-primary bg-white object-contain" 
        />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">¡Hola, {userData?.nombre || 'Cliente'}!</h2>
          <p className="text-sm text-gray-500">Bienvenido a tu monedero de fidelidad multi-marca. Revisa y canjea tus puntos.</p>
        </div>
      </div>

      {/* Tarjetas de Estadísticas */}
      <div className="grid grid-cols-2 gap-4">
        <Link to="/cliente/comercios" className="bg-gradient-to-br from-brand-primary to-brand-secondary text-white p-6 rounded-2xl shadow-sm border border-brand-border hover:shadow-md transition">
          <span className="block text-xs uppercase font-semibold tracking-wider opacity-85">Puntos Disponibles</span>
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
          className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white font-semibold py-4 rounded-xl shadow-md transition flex items-center justify-center gap-2 text-base"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
          Escanear Código para Acumular
        </button>
        <Link
          to="/cliente/comercios"
          className="w-full bg-brand-bg-light hover:bg-opacity-80 text-brand-primary border border-brand-border font-semibold py-4 rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-base"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          Ver Todos los Comercios
        </Link>
      </div>

      {/* Tus Comercios Activos */}
      <div className="bg-white p-6 rounded-xl border border-brand-border shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Tus Comercios Activos</h3>
        {comerciosActivos.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            Aún no tienes puntos en ningún comercio. ¡Explora los comercios y empieza a acumular!
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {comerciosActivos.map(c => (
              <Link 
                key={c.id} 
                to={`/cliente/comercios/${c.id}`} 
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-brand-border hover:bg-brand-bg-light transition"
              >
                {c.logoUrl ? (
                  <img src={c.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded border bg-white flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center font-bold text-gray-400 text-xs flex-shrink-0">NB</div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-gray-800 text-sm truncate">{c.nombre}</h4>
                  <span className="block text-xs font-bold text-brand-primary">{saldosMap[c.id]} Puntos</span>
                </div>
                <span className="text-gray-400 text-sm font-bold">➔</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Historial Corto */}
      <div className="bg-white p-6 rounded-xl border border-brand-border shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Movimientos Recientes</h3>
        {transacciones.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">No hay transacciones registradas.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {transacciones.slice(0, 5).map(tx => {
              const comercio = todosLosComercios.find(c => c.id === tx.comercioId);
              return (
                <li key={tx.id} className="py-3 flex justify-between items-center text-sm">
                  <div className="min-w-0 flex-1 pr-4">
                    <span className="font-semibold text-gray-800 block truncate">{comercio?.nombre || 'Comercio'}</span>
                    <span className="text-xs text-gray-400 block">{new Date(tx.fechaHora).toLocaleDateString()} | {tx.tipo}</span>
                  </div>
                  <span className={`font-bold ${tx.tipo === 'ACUMULACION' ? 'text-green-600' : 'text-red-600'}`}>
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
  
  // Flatten all active prizes
  let premiosData: { comercio: Comercio, premio: Premio, saldo: number, canAfford: boolean }[] = [];
  
  todosLosComercios.forEach(c => {
    const saldo = saldosMap[c.id] || 0;
    c.premios.filter(p => p.activo).forEach(p => {
      premiosData.push({
        comercio: c,
        premio: p,
        saldo: saldo,
        canAfford: saldo >= p.puntosRequeridos
      });
    });
  });

  if (filter === 'AVAILABLE') {
    premiosData = premiosData.filter(d => d.canAfford);
  }

  // Sort by affordability then by points required
  premiosData.sort((a, b) => {
    if (a.canAfford && !b.canAfford) return -1;
    if (!a.canAfford && b.canAfford) return 1;
    return a.premio.puntosRequeridos - b.premio.puntosRequeridos;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/cliente" className="text-sm font-semibold text-brand-primary hover:underline">← Volver al Dashboard</Link>
          <h2 className="text-2xl font-bold text-gray-800 mt-2">Catálogo de Premios</h2>
        </div>
        <div className="bg-gray-100 p-1 rounded-lg inline-flex">
          <button 
            onClick={() => setFilter('AVAILABLE')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${filter === 'AVAILABLE' ? 'bg-white shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Mis Alcanzables
          </button>
          <button 
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${filter === 'ALL' ? 'bg-white shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Todos
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {premiosData.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500 bg-white rounded-xl border">
            No hay premios disponibles en esta categoría.
          </div>
        ) : (
          premiosData.map((d, idx) => (
            <div key={`${d.comercio.id}_${d.premio.id}_${idx}`} className={`bg-white p-5 rounded-2xl border transition shadow-sm flex flex-col justify-between ${d.canAfford ? 'border-brand-border' : 'border-gray-100 opacity-75'}`}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  {d.comercio.logoUrl ? (
                    <img src={d.comercio.logoUrl} alt="Logo" className="w-6 h-6 object-contain rounded bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center font-bold text-gray-400 text-[10px] flex-shrink-0">NB</div>
                  )}
                  <span className="text-xs font-bold text-gray-500 truncate">{d.comercio.nombre}</span>
                </div>
                <h3 className="font-bold text-gray-800 text-sm">{d.premio.nombre}</h3>
                <p className="text-xs text-gray-500 mt-1 mb-3 line-clamp-2">{d.premio.descripcion}</p>
                
                <div className="flex items-center justify-between mt-auto">
                  <span className={`text-sm font-black ${d.canAfford ? 'text-brand-primary' : 'text-gray-400'}`}>
                    {d.premio.puntosRequeridos} pts
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium">Tú tienes: {d.saldo} pts</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50">
                <button
                  disabled={!d.canAfford}
                  onClick={() => onGenerarCanje(d.comercio.id, d.premio)}
                  className={`w-full py-2 rounded-lg text-sm font-bold transition ${d.canAfford ? 'bg-brand-primary text-white hover:bg-brand-primary-hover shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  {d.canAfford ? 'Canjear Premio' : 'Te faltan ' + (d.premio.puntosRequeridos - d.saldo) + ' pts'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ==========================================
// SUB-VIEW: SELECTOR DE COMERCIOS (LISTADO)
// ==========================================
interface ComerciosListProps {
  todosLosComercios: Comercio[];
  saldosMap: Record<string, number>;
}

const ComerciosList: React.FC<ComerciosListProps> = ({ todosLosComercios, saldosMap }) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filtrar por búsqueda
  const filtered = todosLosComercios.filter(c => 
    c.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.nit_rut.includes(searchQuery)
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/cliente" className="text-sm font-semibold text-brand-primary hover:underline">← Volver al Dashboard</Link>
          <h2 className="text-2xl font-bold text-gray-800 mt-2">Comercios Disponibles</h2>
        </div>
      </div>

      {/* Buscador */}
      <input 
        type="text"
        placeholder="Buscar por nombre o NIT..."
        className="w-full border border-gray-300 px-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      {/* Lista */}
      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.length === 0 ? (
          <div className="col-span-2 text-center py-12 text-gray-500">No se encontraron comercios.</div>
        ) : (
          filtered.map(c => {
            const saldo = saldosMap[c.id] || 0;
            return (
              <div key={c.id} className="bg-white p-5 rounded-2xl border border-brand-border shadow-sm flex flex-col justify-between hover:shadow-md transition">
                <div className="flex gap-4">
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt="Logo" className="w-16 h-16 object-contain rounded border bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center font-bold text-gray-400 text-lg flex-shrink-0">NB</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-gray-800 text-base truncate">{c.nombre}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">NIT: {c.nit_rut}</p>
                    <p className="text-sm mt-2 font-medium text-gray-600">
                      Saldo: <span className="font-bold text-brand-primary">{saldo} pts</span>
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-gray-50">
                  <Link 
                    to={`/cliente/comercios/${c.id}`}
                    className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-center font-medium py-2 rounded-lg block transition text-sm"
                  >
                    Entrar al Comercio
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ==========================================
// SUB-VIEW: PÁGINA DE COMERCIO (DETALLADA)
// ==========================================
interface ComercioDetailProps {
  todosLosComercios: Comercio[];
  saldosMap: Record<string, number>;
  transacciones: Transaccion[];
  onOpenScanner: () => void;
  onGenerarCanje: (comercioId: string, premio: Premio) => void;
}

const ComercioDetail: React.FC<ComercioDetailProps> = ({
  todosLosComercios,
  saldosMap,
  transacciones,
  onOpenScanner,
  onGenerarCanje
}) => {
  const { comercioId } = useParams<{ comercioId: string }>();
  const comercio = todosLosComercios.find(c => c.id === comercioId);
  const navigate = useNavigate();

  if (!comercio) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 font-semibold mb-4">Comercio no encontrado.</p>
        <Link to="/cliente/comercios" className="text-brand-primary hover:underline">Volver a comercios</Link>
      </div>
    );
  }

  // Filtrar saldo y transacciones de este comercio
  const saldo = saldosMap[comercio.id] || 0;
  const misTransacciones = transacciones.filter(tx => tx.comercioId === comercio.id);
  const premiosActivos = comercio.premios.filter(p => p.activo);

  return (
    <div style={getPaletteStyle(comercio.paletteId)} className="space-y-6 animate-fade-in">
      {/* Cabecera del Comercio con su Palette */}
      <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {comercio.logoUrl ? (
            <img src={comercio.logoUrl} alt="Logo" className="w-16 h-16 object-contain rounded border bg-white flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 bg-brand-bg-light text-brand-primary rounded flex items-center justify-center font-bold text-xl border border-brand-border flex-shrink-0">NB</div>
          )}
          <div>
            <h2 className="text-2xl font-bold text-gray-800 leading-tight">{comercio.nombre}</h2>
            <p className="text-xs text-gray-400 mt-1">NIT: {comercio.nit_rut}</p>
          </div>
        </div>
        
        {/* Saldo de Puntos en Comercio */}
        <div className="text-right">
          <span className="block text-3xl font-black text-brand-primary">{saldo}</span>
          <span className="text-xs uppercase font-bold text-gray-400 tracking-wider">Mis Puntos</span>
        </div>
      </div>

      {/* Botones de acción del comercio */}
      <div className="grid sm:grid-cols-2 gap-4">
        <button
          onClick={onOpenScanner}
          className="bg-brand-primary hover:bg-brand-primary-hover text-white font-semibold py-3.5 rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
          Acumular Puntos Aquí
        </button>
        <button
          onClick={() => navigate('/cliente/comercios')}
          className="bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 font-medium py-3.5 rounded-xl transition text-sm text-center"
        >
          ← Volver a Comercios
        </button>
      </div>

      {/* Catálogo y Movimientos */}
      <div className="grid md:grid-cols-2 gap-6">
        
        {/* Catálogo de Premios */}
        <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4 uppercase tracking-wider text-xs border-b pb-2 text-brand-primary border-brand-border">Premios de {comercio.nombre}</h3>
            {premiosActivos.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">Este comercio no tiene premios disponibles por ahora.</p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {premiosActivos.map(p => {
                  const canAfford = saldo >= p.puntosRequeridos;
                  return (
                    <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg border transition ${canAfford ? 'border-brand-border bg-brand-bg-light' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                      <div className="min-w-0 flex-1 pr-2">
                        <strong className="block text-gray-800 text-sm truncate">{p.nombre}</strong>
                        <span className="block text-xs text-gray-500 truncate">{p.descripcion}</span>
                        <span className="block text-xs font-bold text-brand-primary mt-1">{p.puntosRequeridos} pts</span>
                      </div>
                      <button
                        disabled={!canAfford}
                        onClick={() => onGenerarCanje(comercio.id, p)}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition ${canAfford ? 'bg-brand-primary text-white hover:bg-brand-primary-hover shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
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
          <h3 className="text-lg font-bold text-gray-800 mb-4 uppercase tracking-wider text-xs border-b pb-2 text-brand-primary border-brand-border">Tus Movimientos</h3>
          {misTransacciones.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No registras movimientos en este comercio.</p>
          ) : (
            <ul className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {misTransacciones.map(tx => (
                <li key={tx.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex justify-between items-start text-xs">
                  <div>
                    <span className="font-bold text-gray-800 block">{tx.tipo}</span>
                    <span className="text-gray-400 block mt-0.5">{new Date(tx.fechaHora).toLocaleString()}</span>
                    {tx.tipo === 'ACUMULACION' && tx.montoFactura > 0 && (
                      <span className="text-gray-500 block mt-0.5">Factura: {tx.nroFactura} (${tx.montoFactura})</span>
                    )}
                  </div>
                  <span className={`font-bold text-sm ${tx.tipo === 'ACUMULACION' ? 'text-green-600' : 'text-red-600'}`}>
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
// COMPONENTE PRINCIPAL: CLIENTEDASHBOARD
// ==========================================
const ClienteDashboard: React.FC = () => {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [todosLosComercios, setTodosLosComercios] = useState<Comercio[]>([]);
  const [saldosMap, setSaldosMap] = useState<Record<string, number>>({});
  const [puntosUsados, setPuntosUsados] = useState(0);
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [loading, setLoading] = useState(true);

  // States para modales de QR
  const [escaneando, setEscaneando] = useState(false);
  const [manualQrInput, setManualQrInput] = useState('');
  const [qrCanje, setQrCanje] = useState<{ id: string, premio: string, puntos: number } | null>(null);
  
  // Mensajes globales
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'success' | 'error' | 'info' } | null>(null);

  const cargarDatos = async () => {
    if (!userData) return;
    try {
      // 1. Cargar todos los comercios
      const comerciosSnap = await getDocs(collection(db, 'comercios'));
      const listC: Comercio[] = [];
      comerciosSnap.forEach(d => listC.push(d.data() as Comercio));
      setTodosLosComercios(listC);

      // 2. Cargar saldos del usuario
      const saldosQ = query(collection(db, 'puntos_saldos'), where('clienteId', '==', userData.uid));
      const saldosSnap = await getDocs(saldosQ);
      const sMap: Record<string, number> = {};
      saldosSnap.forEach(d => {
        const s = d.data() as SaldoPunto;
        sMap[s.comercioId] = s.saldoTotal;
      });
      setSaldosMap(sMap);

      // 3. Cargar transacciones del usuario
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

  const procesarQR = async (sesionId: string) => {
    if (!userData) return;
    setEscaneando(false);
    setMensaje({ texto: "Procesando código...", tipo: 'info' });

    try {
      const sesionRef = doc(db, 'sesiones_qr', sesionId);

      await runTransaction(db, async (transaction) => {
        const sesionDoc = await transaction.get(sesionRef);
        if (!sesionDoc.exists()) {
          throw new Error("El código QR no es válido o no existe.");
        }

        const sesion = sesionDoc.data() as SesionQR;
        if (sesion.estado !== 'PENDIENTE') {
          throw new Error("Este código QR ya fue utilizado o ha expirado.");
        }
        if (sesion.tipo !== 'ACUMULACION') {
          throw new Error("Este código no es para acumular puntos.");
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
          reglaAplicadaId: sesion.reglaAplicadaId
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

      setMensaje({ texto: "¡Puntos acumulados exitosamente!", tipo: 'success' });
      cargarDatos();
      navigate('/cliente');

    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: error.message || "Error al procesar el código.", tipo: 'error' });
    }
  };

  const generarQRCanje = async (comercioId: string, premio: Premio) => {
    if (!userData) return;
    try {
      setMensaje({ texto: "Generando código de canje...", tipo: 'info' });
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
      setMensaje(null);
    } catch (error) {
      console.error("Error al generar código de canje:", error);
      setMensaje({ texto: "Error al generar el código.", tipo: 'error' });
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando dashboard...</div>;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Mensajes Globales de Notificación */}
      {mensaje && (
        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm animate-fade-in ${
          mensaje.tipo === 'success' ? 'bg-green-50 text-green-800 border-green-200' : 
          mensaje.tipo === 'error' ? 'bg-red-50 text-red-800 border-red-200' : 
          'bg-brand-bg-light text-brand-primary border-brand-border'
        }`}>
          <span className="font-medium text-sm">{mensaje.texto}</span>
          <button className="font-bold text-xs" onClick={() => setMensaje(null)}>✕</button>
        </div>
      )}

      {/* Ruteador de Sub-vistas */}
      <Routes>
        <Route 
          index 
          element={
            <DashboardHome
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
              puntosUsados={puntosUsados}
              transacciones={transacciones}
              onOpenScanner={() => setEscaneando(true)}
            />
          } 
        />
        
        <Route 
          path="comercios" 
          element={
            <ComerciosList
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
            />
          } 
        />
        
        <Route 
          path="comercios/:comercioId" 
          element={
            <ComercioDetail
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
              transacciones={transacciones}
              onOpenScanner={() => setEscaneando(true)}
              onGenerarCanje={generarQRCanje}
            />
          } 
        />
        <Route 
          path="premios" 
          element={
            <PremiosList
              todosLosComercios={todosLosComercios}
              saldosMap={saldosMap}
              onGenerarCanje={generarQRCanje}
            />
          } 
        />

      </Routes>

      {/* MODAL: CÁMARA ESCÁNER QR */}
      {escaneando && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center">
            <h3 className="font-bold text-lg mb-4 text-gray-800">Escanear Código o QR</h3>
            
            <div className="w-full overflow-hidden rounded-xl border border-gray-200 relative bg-gray-50 flex items-center justify-center min-h-[250px]">
              <Scanner 
                onScan={(result) => {
                  if (result && result.length > 0) {
                    procesarQR(result[0].rawValue);
                  }
                }}
              />
            </div>
            
            <div className="w-full mt-6 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2 text-center">¿La cámara no funciona? Ingresa el código de 6 dígitos:</p>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  maxLength={6}
                  placeholder="Ej. 123456" 
                  className="flex-1 border border-gray-300 px-3 py-2 rounded-lg text-sm text-center font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  value={manualQrInput}
                  onChange={e => setManualQrInput(e.target.value)}
                />
                <button 
                  onClick={() => {
                    if (manualQrInput.trim()) {
                      procesarQR(manualQrInput.trim());
                      setManualQrInput('');
                    }
                  }}
                  className="bg-brand-primary hover:bg-brand-primary-hover text-white px-4 py-2 rounded-lg font-medium text-sm transition"
                >
                  Acumular
                </button>
              </div>
            </div>

            <button 
              onClick={() => setEscaneando(false)}
              className="mt-6 text-sm font-semibold text-red-600 hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* MODAL: QR DE CANJE ACTIVO */}
      {qrCanje && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full flex flex-col items-center">
            <h3 className="text-xl font-bold text-gray-800 text-center mb-2">{qrCanje.premio}</h3>
            <p className="text-gray-500 text-xs mb-6 text-center leading-relaxed">
              Muestra este código al vendedor para descontar <strong>{qrCanje.puntos} pts</strong> y recibir tu premio.
            </p>
            
            <div className="bg-white p-4 border border-gray-200 rounded-xl mb-4 shadow-sm">
              <QRCodeSVG value={qrCanje.id} size={200} />
            </div>

            <div className="bg-brand-bg-light w-full p-4 rounded-lg text-center mb-6 border border-brand-border">
              <p className="text-xs text-brand-primary font-bold mb-2 uppercase tracking-wider">Código de Canje (6 dígitos):</p>
              <div className="text-3xl font-black text-gray-800 tracking-widest select-all">{qrCanje.id}</div>
            </div>

            <button 
              onClick={() => {
                setQrCanje(null);
                cargarDatos(); // Recargar saldos al cerrar
              }} 
              className="bg-brand-primary hover:bg-brand-primary-hover text-white w-full py-2.5 rounded-xl font-semibold transition text-sm"
            >
              Cerrar y Actualizar Saldo
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default ClienteDashboard;
