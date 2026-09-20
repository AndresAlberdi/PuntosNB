import React, { useCallback, useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { invocar, mensajeDeError } from '../utils/backend';
import type { Comercio, CodigoComercio } from '../types';

interface Props {
  comercio: Comercio;
}

export const AdminCodigosComercio: React.FC<Props> = ({ comercio }) => {
  const [codigos, setCodigos] = useState<CodigoComercio[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [nuevoCodigo, setNuevoCodigo] = useState('');
  const [puntos, setPuntos] = useState(10);
  // La fecha de inicio propuesta es hoy; se calcula una sola vez, al montar el componente.
  const [fechaInicioStr, setFechaInicioStr] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const costoPorCodigo = comercio.costoPorCodigoComercio || 10;
  const saldoActual = comercio.saldoPremiosBs || 0;

  const cargarCodigos = useCallback(async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'codigos_comercio'), where('comercioId', '==', comercio.id));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => d.data() as CodigoComercio);
      // Sort by creation date
      data.sort((a, b) => b.createdAt - a.createdAt);
      setCodigos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [comercio.id]);

  // El cuerpo de un efecto no puede ser `async`: la carga se lanza desde una función
  // interna, de modo que el estado se actualiza al resolverse la consulta y no durante
  // el propio efecto.
  useEffect(() => {
    const cargar = async () => {
      await cargarCodigos();
    };
    cargar();
  }, [cargarCodigos]);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    
    const cleanCode = nuevoCodigo.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!cleanCode) {
      setErrorMsg('El código es inválido.');
      return;
    }
    if (cleanCode.length < 3) {
      setErrorMsg('El código debe tener al menos 3 caracteres.');
      return;
    }
    if (!fechaInicioStr) {
      setErrorMsg('Debe seleccionar una fecha de inicio.');
      return;
    }

    if (saldoActual < costoPorCodigo) {
      setErrorMsg(`Saldo insuficiente. Su billetera de premios tiene Bs. ${saldoActual.toFixed(2)} y el costo es de Bs. ${costoPorCodigo.toFixed(2)}.`);
      return;
    }

    try {
      setSaving(true);

      // El servidor comprueba que el código esté libre, cobra el costo configurado del saldo
      // prepagado y crea el código con su vigencia, todo en una transacción.
      const [anio, mes, dia] = fechaInicioStr.split('-').map(Number);
      const res = await invocar<
        { codigo: string; puntosPorCanje: number; comercioId: string; fechaInicio?: number },
        { codigo: string; costoBs: number; fechaFin: number }
      >('crearCodigoComercio', {
        codigo: cleanCode,
        puntosPorCanje: puntos,
        comercioId: comercio.id,
        fechaInicio: new Date(anio, mes - 1, dia).getTime(),
      });

      setSuccessMsg(`Código ${res.codigo} creado exitosamente. Vence el ${new Date(res.fechaFin).toLocaleDateString()}.`);
      setShowModal(false);
      setNuevoCodigo('');
      cargarCodigos();
    } catch (e) {
      setErrorMsg(mensajeDeError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEstado = async (codigo: CodigoComercio) => {
    try {
      const nuevoEstado = codigo.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
      await invocar('cambiarEstadoCodigoComercio', { codigo: codigo.id, activo: nuevoEstado === 'ACTIVO' });
      cargarCodigos();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return <div className="text-gray-500 p-4">Cargando códigos...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div>
          <h3 className="text-xl font-bold text-gray-800 dark:text-white">Códigos Promocionales del Comercio</h3>
          <p className="text-sm text-gray-500 mt-1">
            Los códigos son válidos por 30 días. El costo de reserva es de <strong className="text-emerald-600">Bs. {costoPorCodigo.toFixed(2)}</strong>.
            <br />
            Saldo actual de premios: <strong className="text-emerald-600">Bs. {saldoActual.toFixed(2)}</strong>
          </p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="sa-btn-primary whitespace-nowrap"
        >
          + Nuevo Código
        </button>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg border border-emerald-200">
          {successMsg}
        </div>
      )}

      {codigos.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800/50 p-8 rounded-xl text-center border border-gray-100 dark:border-gray-700">
          <p className="text-gray-500">No tienes códigos promocionales registrados.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {codigos.map(c => (
            <div key={c.id} className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-brand-primary/10 to-transparent rounded-bl-full" />
              
              <div className="flex justify-between items-start mb-3">
                <h4 className="text-2xl font-black text-brand-primary tracking-tight">{c.id}</h4>
                <button
                  onClick={() => handleToggleEstado(c)}
                  className={`text-xs px-2 py-1 rounded-full font-bold ${c.estado === 'ACTIVO' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
                >
                  {c.estado}
                </button>
              </div>

              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <div className="flex justify-between">
                  <span>Puntos por uso:</span>
                  <span className="font-bold text-gray-900 dark:text-white">{c.puntosPorCanje}</span>
                </div>
                <div className="flex justify-between">
                  <span>Inicio:</span>
                  <span className="font-medium">{new Date(c.fechaInicio).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fin:</span>
                  <span className="font-medium">{new Date(c.fechaFin).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL CREAR CÓDIGO */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="bg-gray-50 dark:bg-gray-700/50 p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-bold text-gray-800 dark:text-white">Crear Código Promocional</h3>
            </div>
            
            <form onSubmit={handleCrear} className="p-5 space-y-4">
              {errorMsg && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="sa-label">Código (Alfanumérico)</label>
                <input 
                  type="text" 
                  className="sa-input uppercase"
                  placeholder="Ej: ANIVERSARIO"
                  value={nuevoCodigo}
                  onChange={e => setNuevoCodigo(e.target.value)}
                  maxLength={15}
                  required
                />
                <p className="text-[10px] text-gray-400 mt-1">Sin espacios ni símbolos.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="sa-label">Puntos a otorgar</label>
                  <input 
                    type="number" 
                    className="sa-input"
                    min="1"
                    value={puntos}
                    onChange={e => setPuntos(Number(e.target.value))}
                    required
                  />
                </div>
                <div>
                  <label className="sa-label">Fecha de Inicio</label>
                  <input 
                    type="date" 
                    className="sa-input"
                    value={fechaInicioStr}
                    onChange={e => setFechaInicioStr(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-xs mt-2 border border-blue-100">
                Al confirmar, se descontarán <strong>Bs. {costoPorCodigo.toFixed(2)}</strong> de la billetera de premios.
                El código será válido por 30 días a partir de la fecha de inicio.
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="sa-btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving}
                  className="sa-btn-primary flex-1 flex justify-center items-center"
                >
                  {saving ? 'Procesando...' : 'Crear y Pagar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
