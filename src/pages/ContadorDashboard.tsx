import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, CobroPrepago } from '../types';
import { optimizarImagen, resumenOptimizacion } from '../utils/imageOptimizer';
import { invocar, mensajeDeError } from '../utils/backend';
import { cargarComerciosCompletos } from '../utils/comercios';

export const ContadorDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [cobros, setCobros] = useState<CobroPrepago[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [selectedComercioId, setSelectedComercioId] = useState('');
  const [montoCobrado, setMontoCobrado] = useState('');
  const [confirmarMontoCobrado, setConfirmarMontoCobrado] = useState('');
  const [cantidadMeses, setCantidadMeses] = useState(0);
  const [montoPremios, setMontoPremios] = useState('');
  const [codigoDeposito, setCodigoDeposito] = useState('');
  const [comprobanteBase64, setComprobanteBase64] = useState('');
  // Identifica este cobro concreto: si la conexión falla y se reintenta, el servidor reconoce
  // que es el mismo y no cobra dos veces.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());

  // Feedback message
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);

  const fetchData = async () => {
    try {
      // 1. Fetch Comercios
      const listComercios = await cargarComerciosCompletos();
      setComercios(listComercios);
      if (listComercios.length > 0 && !selectedComercioId) {
        setSelectedComercioId(listComercios[0].id);
      }

      // 2. Fetch Cobros
      const snapCobros = await getDocs(collection(db, 'cobros_prepago'));
      const listCobros: CobroPrepago[] = [];
      snapCobros.forEach(d => listCobros.push(d.data() as CobroPrepago));
      listCobros.sort((a, b) => b.fechaHora - a.fechaHora);
      setCobros(listCobros);
    } catch (err) {
      console.error("Error fetching contador data:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const selectedComercio = comercios.find(c => c.id === selectedComercioId);
  const mensualidadBs = selectedComercio?.mensualidadBs || 25.00;
  const costoPremioBs = selectedComercio?.costoPorPremioBs || 1.25;

  // Calcular meses consecutivos a partir del mes actual o siguiente impago
  const calcularMesesConsecutivos = (cantidad: number): string[] => {
    if (cantidad <= 0 || !selectedComercio) return [];
    
    const mesesPagados = selectedComercio.mesesPagados || [];
    const ahora = new Date();
    const meses: string[] = [];

    let currentYear = ahora.getFullYear();
    let currentMonth = ahora.getMonth() + 1; // 1-12

    // Avanzar si el mes ya está pagado
    while (mesesPagados.includes(`${currentYear}-${String(currentMonth).padStart(2, '0')}`)) {
      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    for (let i = 0; i < cantidad; i++) {
      meses.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    return meses;
  };

  const mesesSeleccionados = calcularMesesConsecutivos(cantidadMeses);
  const subtotalMensualidad = cantidadMeses * mensualidadBs;
  const subtotalPremios = parseFloat(montoPremios) || 0;
  const totalCalculado = subtotalMensualidad + subtotalPremios;
  const premiosEquivalentes = Math.floor(subtotalPremios / costoPremioBs);

  const montosCoinciden = montoCobrado !== '' && montoCobrado === confirmarMontoCobrado;
  const montoIngresadoNum = parseFloat(montoCobrado) || 0;
  const totalCoincideConCalculo = Math.abs(montoIngresadoNum - totalCalculado) < 0.01 && montoIngresadoNum > 0;

  const handleRegistrarCobro = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);

    if (!selectedComercio) {
      setMensaje({ texto: 'Selecciona un comercio.', tipo: 'error' });
      return;
    }

    if (!montosCoinciden) {
      setMensaje({ texto: 'Error de doble digitación: El monto cobrado y la confirmación no coinciden exactamente.', tipo: 'error' });
      return;
    }

    if (!totalCoincideConCalculo) {
      setMensaje({ texto: `El monto ingresado (Bs. ${montoIngresadoNum}) no coincide con la suma calculada de mensualidad + premios (Bs. ${totalCalculado.toFixed(2)}).`, tipo: 'error' });
      return;
    }

    if (!codigoDeposito.trim()) {
      setMensaje({ texto: 'Ingresa el código o número de depósito bancario.', tipo: 'error' });
      return;
    }

    try {
      // El servidor recalcula la mensualidad desde la configuración del comercio y registra el
      // cobro y la acreditación en una sola transacción: ya no pueden quedar desparejos.
      // `clave` hace que un reintento por mala conexión no cobre dos veces.
      const respuesta = await invocar<
        {
          comercioId: string; mesesPagados: string[]; montoPremios: number;
          codigoDeposito: string; comprobanteUrl?: string; recibeFactura: boolean; clave: string;
        },
        { cobroId: string; montoTotal: number; montoMensualidad: number; saldoPremiosBs: number }
      >('registrarCobroPrepago', {
        comercioId: selectedComercio.id,
        mesesPagados: mesesSeleccionados,
        montoPremios: subtotalPremios,
        codigoDeposito: codigoDeposito.trim().toUpperCase(),
        comprobanteUrl: comprobanteBase64 || undefined,
        recibeFactura: selectedComercio.recibeFactura ?? true,
        clave: claveIdempotencia,
      });


      setMensaje({ texto: `¡Cobro de Bs. ${respuesta.montoTotal.toFixed(2)} para "${selectedComercio.nombre}" registrado con éxito!`, tipo: 'success' });

      // Limpiar formulario
      setMontoCobrado('');
      setConfirmarMontoCobrado('');
      setCantidadMeses(0);
      setMontoPremios('');
      setCodigoDeposito('');
      setComprobanteBase64('');
      setClaveIdempotencia(crypto.randomUUID());
      const fileInput = document.getElementById('comprobante-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

      fetchData();
    } catch (err) {
      setMensaje({ texto: mensajeDeError(err), tipo: 'error' });
    }
  };


  const handleBorrarCobro = async (cobro: CobroPrepago) => {
    if (cobro.estado === 'VERIFICADO') {
      alert("No puedes eliminar este cobro porque ya fue verificado y conciliado por el SuperAdmin.");
      return;
    }
    if (!confirm(`¿Anular el cobro de Bs. ${cobro.montoTotal.toFixed(2)} de "${cobro.nombreComercio}"? Se devolverá el saldo y se quitarán los meses pagados.`)) return;

    try {
      // El servidor borra el cobro y revierte saldo y meses en una sola transacción, y se niega
      // a anular si el comercio ya consumió ese saldo en premios.
      await invocar('anularCobroPrepago', { cobroId: cobro.id });
      setMensaje({ texto: 'Cobro anulado y saldo revertido correctamente.', tipo: 'success' });
      fetchData();
    } catch (err) {
      setMensaje({ texto: mensajeDeError(err), tipo: 'error' });
    }
  };
;

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando panel de contabilidad...</div>;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-8">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <span>📑</span> Panel de Contabilidad & Cobranzas
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Registro de Prepagos de Mensualidad y Premios con doble digitación y comprobante bancario.
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs uppercase font-bold text-gray-400">Contador Activo</span>
          <p className="font-mono text-sm font-bold text-emerald-600">{userData?.email}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        
        {/* Formulario de Registro de Cobro */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-6">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white border-b pb-3">Registrar Nuevo Cobro de Prepago</h3>

          {mensaje && (
            <div className={`p-4 rounded-xl text-xs font-bold ${mensaje.tipo === 'success' ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-red-100 text-red-800 border border-red-300'}`}>
              {mensaje.texto}
            </div>
          )}

          <form onSubmit={handleRegistrarCobro} className="space-y-5">
            {/* 1. Selección de Comercio */}
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase">1. Selecciona el Comercio</label>
              <select 
                className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-800 dark:text-white"
                value={selectedComercioId} 
                onChange={e => setSelectedComercioId(e.target.value)}
              >
                {comercios.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} (NIT: {c.nit_rut}) {c.razonSocial ? `- ${c.razonSocial}` : ''}
                  </option>
                ))}
              </select>
              {selectedComercio && (
                <div className="mt-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-100 dark:border-emerald-800 text-xs flex flex-wrap justify-between gap-2">
                  <span><strong>Tarifa Mensualidad:</strong> Bs. {mensualidadBs.toFixed(2)}</span>
                  <span><strong>Costo por Premio:</strong> Bs. {costoPremioBs.toFixed(2)}</span>
                  <span><strong>Factura:</strong> {selectedComercio.recibeFactura ? 'Sí' : 'No'}</span>
                  <span><strong>Saldo Actual Premios:</strong> Bs. {(selectedComercio.saldoPremiosBs || 0).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* 2. Doble Digitación del Monto Cobrado */}
            <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-200 dark:border-gray-600 space-y-3">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">2. Monto Total Depositado (Doble Digitación Obligatoria)</label>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-[11px] text-gray-500 block mb-1">Monto Depositado (Bs):</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    placeholder="Ej: 160.00"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-black text-emerald-600"
                    value={montoCobrado}
                    onChange={e => setMontoCobrado(e.target.value)}
                  />
                </div>
                <div>
                  <span className="text-[11px] text-gray-500 block mb-1">Confirmar Monto Depositado (Bs):</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    placeholder="Ej: 160.00"
                    className={`w-full bg-white dark:bg-gray-800 border rounded-lg px-3 py-2 text-sm font-black ${confirmarMontoCobrado && !montosCoinciden ? 'border-red-500 text-red-600' : 'border-gray-300 dark:border-gray-600 text-emerald-600'}`}
                    value={confirmarMontoCobrado}
                    onChange={e => setConfirmarMontoCobrado(e.target.value)}
                  />
                </div>
              </div>
              {confirmarMontoCobrado && !montosCoinciden && (
                <p className="text-xs text-red-500 font-bold">⚠️ Los montos ingresados no coinciden.</p>
              )}
            </div>

            {/* 3. Distribución del Pago: Mensualidad + Premios */}
            <div className="space-y-4">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">3. Distribución del Prepago</label>
              
              {/* Selector de Meses de Mensualidad */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">Meses de Mensualidad a Prepagar:</span>
                  <span className="text-xs font-bold text-emerald-600">Subtotal: Bs. {subtotalMensualidad.toFixed(2)}</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {[0, 1, 2, 3, 4, 6, 12].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCantidadMeses(num)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${cantidadMeses === num ? 'bg-emerald-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}`}
                    >
                      {num === 0 ? 'Sin Mensualidad' : `${num} ${num === 1 ? 'Mes' : 'Meses'}`}
                    </button>
                  ))}
                </div>
                {mesesSeleccionados.length > 0 && (
                  <p className="text-[11px] text-gray-500">
                    Meses cubiertos: <strong className="text-emerald-700">{mesesSeleccionados.join(', ')}</strong>
                  </p>
                )}
              </div>

              {/* Monto asignado a Premios */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">Monto asignado a Premios (Bs):</span>
                  <span className="text-xs font-bold text-purple-600">{premiosEquivalentes} Premios equivalentes</span>
                </div>
                <input 
                  type="number" 
                  step="0.01" 
                  placeholder="Ej: 60.00"
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2 text-sm font-semibold"
                  value={montoPremios}
                  onChange={e => setMontoPremios(e.target.value)}
                />
              </div>
            </div>

            {/* 4. Datos del Depósito y Comprobante */}
            <div className="grid sm:grid-cols-2 gap-4 border-t pt-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase">Código / N° de Depósito</label>
                <input 
                  type="text" 
                  required 
                  placeholder="Ej: DEP-9823412"
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2 text-sm font-mono font-bold"
                  value={codigoDeposito}
                  onChange={e => setCodigoDeposito(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase">Comprobante (Foto / Imagen)</label>
                <input 
                  id="comprobante-file"
                  type="file" 
                  accept="image/*"
                  className="w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const optimizada = await optimizarImagen(file, 'comprobante');
                        setComprobanteBase64(optimizada.dataUrl);
                        setMensaje({ texto: `Comprobante listo: ${resumenOptimizacion(optimizada)}`, tipo: 'success' });
                      } catch (err) {
                        setMensaje({ texto: err instanceof Error ? err.message : 'No se pudo procesar la imagen.', tipo: 'error' });
                      }
                    }
                  }}
                />
              </div>
            </div>

            {comprobanteBase64 && (
              <div className="p-2 border rounded-xl bg-gray-50 dark:bg-gray-700 flex items-center gap-3">
                <img src={comprobanteBase64} alt="Comprobante" className="h-16 w-16 object-cover rounded border" />
                <span className="text-xs text-gray-500">Comprobante listo y optimizado para verificación del SuperAdmin.</span>
              </div>
            )}

            {/* Tarjeta de Resumen en Vivo */}
            <div className={`p-4 rounded-xl border text-xs flex flex-wrap justify-between items-center gap-2 ${totalCoincideConCalculo ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 text-emerald-900 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 text-amber-900 dark:text-amber-200'}`}>
              <div>
                <strong>Resumen de Cobro:</strong> {cantidadMeses} meses (Bs. {subtotalMensualidad.toFixed(2)}) + Premios (Bs. {subtotalPremios.toFixed(2)}) = <span className="text-sm font-black">Bs. {totalCalculado.toFixed(2)}</span>
              </div>
              <div>
                {totalCoincideConCalculo ? '✅ Monto Cuadrado Exacto' : '⚠️ Monto depositado no coincide con la suma'}
              </div>
            </div>

            <button 
              type="submit" 
              disabled={!totalCoincideConCalculo || !montosCoinciden}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition shadow text-sm cursor-pointer"
            >
              Registrar Cobro y Notificar a SuperAdmins
            </button>
          </form>
        </div>

        {/* Historial de Cobros del Contador */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white border-b pb-3">Cobros Registrados ({cobros.length})</h3>
          
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {cobros.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No has registrado cobros aún.</p>
            ) : (
              cobros.map(c => {
                const esEditable = c.estado !== 'VERIFICADO' && (c.consumidoPremiosBs || 0) === 0;

                return (
                  <div key={c.id} className="p-4 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 space-y-2 text-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <strong className="text-sm text-gray-800 dark:text-white block">{c.nombreComercio}</strong>
                        <span className="text-[10px] text-gray-400">{new Date(c.fechaHora).toLocaleDateString()} | Dep: {c.codigoDeposito}</span>
                      </div>
                      <span className="font-black text-emerald-600 text-sm">Bs. {c.montoTotal.toFixed(2)}</span>
                    </div>

                    <div className="text-[11px] text-gray-600 dark:text-gray-300">
                      <p>Mensualidad: Bs. {c.montoMensualidad.toFixed(2)} ({c.mesesPagados.join(', ') || '0 meses'})</p>
                      <p>Premios: Bs. {c.montoPremios.toFixed(2)} ({c.cantidadPremiosEquivalentes} pts)</p>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-600">
                      {c.estado === 'VERIFICADO' ? (
                        <span className="text-[10px] font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded">🔒 CONCILIADO</span>
                      ) : (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded">⏳ PENDIENTE</span>
                      )}

                      {esEditable ? (
                        <button 
                          onClick={() => handleBorrarCobro(c)}
                          className="text-[11px] text-red-600 hover:text-red-800 font-bold cursor-pointer"
                        >
                          Eliminar
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic">No modificable</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default ContadorDashboard;
