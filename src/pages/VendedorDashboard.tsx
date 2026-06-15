import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, SesionQR, SaldoPunto, Transaccion } from '../types';

const VendedorDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [nroFactura, setNroFactura] = useState('');
  const [montoFactura, setMontoFactura] = useState<number | ''>('');
  const [reglaSeleccionada, setReglaSeleccionada] = useState<string>('');
  const [productos, setProductos] = useState<{ id: string; qty: number }[]>([]);
  const [qrData, setQrData] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'GENERAR' | 'ESCANEAR'>('GENERAR');
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    const fetchComercio = async () => {
      if (userData?.comercioId) {
        try {
          const docRef = doc(db, 'comercios', userData.comercioId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data() as Comercio;
            setComercio(data);
            const activas = data.reglas.filter(r => r.activa);
            if (activas.length === 1) {
              setReglaSeleccionada(activas[0].id);
            }
          }
        } catch (error) {
          console.error("Error fetching comercio:", error);
        }
      }
      setLoading(false);
    };
    fetchComercio();
  }, [userData]);

  const procesarQRCanje = async (sesionId: string) => {
    if (!userData || !comercio) return;
    setMensaje({ texto: "Procesando canje...", tipo: 'info' });

    try {
      const sesionRef = doc(db, 'sesiones_qr', sesionId);
      const { runTransaction } = await import('firebase/firestore');

      await runTransaction(db, async (transaction) => {
        const sesionDoc = await transaction.get(sesionRef);
        if (!sesionDoc.exists()) {
          throw new Error("El código QR no es válido o no existe.");
        }

        const sesion = sesionDoc.data() as SesionQR;
        if (sesion.estado !== 'PENDIENTE') {
          throw new Error("Este código QR ya fue procesado o ha expirado.");
        }
        if (sesion.tipo !== 'CANJE') {
          throw new Error("Este código no es un código de canje de premio.");
        }
        if (sesion.comercioId !== comercio.id) {
          throw new Error("Este código pertenece a otro comercio.");
        }

        const saldoId = `${sesion.creadorId}_${comercio.id}`;
        const saldoRef = doc(db, 'puntos_saldos', saldoId);
        
        const saldoDoc = await transaction.get(saldoRef);

        if (!saldoDoc.exists()) {
          throw new Error("El cliente no tiene saldo en este comercio.");
        }

        const saldoActual = saldoDoc.data() as SaldoPunto;
        const puntosARestar = sesion.puntosCalculados || 0;

        if (saldoActual.saldoTotal < puntosARestar) {
          throw new Error(`Saldo insuficiente. El cliente tiene ${saldoActual.saldoTotal} pts y requiere ${puntosARestar} pts.`);
        }

        // 1. Marcar sesión como usada
        transaction.update(sesionRef, { estado: 'USADO' });

        // 2. Registrar transacción (negativa)
        const transaccionRef = doc(collection(db, 'transacciones'));
        const nuevaTransaccion: Transaccion = {
          id: transaccionRef.id,
          fechaHora: Date.now(),
          clienteId: sesion.creadorId,
          clienteAlias: sesion.creadorAlias || 'Cliente',
          comercioId: comercio.id,
          vendedorId: userData.uid,
          vendedorAlias: userData.email?.split('@')[0] || 'Vendedor',
          montoFactura: 0,
          nroFactura: 'CANJE PREMIO',
          puntos: -puntosARestar,
          tipo: 'CANJE'
        };
        transaction.set(transaccionRef, nuevaTransaccion);

        // 3. Actualizar saldo
        transaction.update(saldoRef, {
          saldoTotal: saldoActual.saldoTotal - puntosARestar,
          updatedAt: Date.now()
        });
      });

      setMensaje({ texto: "¡Canje aprobado y procesado exitosamente! Entrega el premio al cliente.", tipo: 'success' });
    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: error.message || "Error al procesar el código.", tipo: 'error' });
    }
  };

  const handleAddProduct = (reglaId: string) => {
    setReglaSeleccionada(reglaId);
    setProductos(prev => {
      const exists = prev.find(p => p.id === reglaId);
      if (exists) {
        return prev.map(p => p.id === reglaId ? { ...p, qty: p.qty + 1 } : p);
      }
      return [...prev, { id: reglaId, qty: 1 }];
    });
  };

  const handleRemoveProduct = (reglaId: string) => {
    setProductos(prev => {
      const exists = prev.find(p => p.id === reglaId);
      if (exists && exists.qty > 1) {
        return prev.map(p => p.id === reglaId ? { ...p, qty: p.qty - 1 } : p);
      }
      return prev.filter(p => p.id !== reglaId);
    });
  };

  const calcularPuntos = () => {
    if (!comercio || !reglaSeleccionada) return 0;
    
    const regla = comercio.reglas.find(r => r.id === reglaSeleccionada && r.activa);
    if (!regla) return 0;

    let total = 0;
    const monto = Number(montoFactura) || 0;

    if (regla.tipo === 'POR_COMPRA') {
      total = regla.puntosAOtorgar || 0;
    } else if (regla.tipo === 'POR_MONTO' && regla.rangos) {
      const rangoMatch = regla.rangos.find(r => monto >= r.min && monto <= r.max);
      if (rangoMatch) {
        total = rangoMatch.puntos;
      }
    } else if (regla.tipo === 'POR_PRODUCTO') {
      const seleccion = productos.find(p => p.id === regla.id);
      if (seleccion) {
        total = (seleccion.qty * (regla.puntosAOtorgar || 0));
      }
    }

    return total;
  };

  const generarQR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reglaSeleccionada) {
      alert("Debes seleccionar una regla de asignación.");
      return;
    }

    const puntos = calcularPuntos();
    if (puntos === 0) {
      alert("La compra no genera puntos con la regla seleccionada y el monto/producto actual.");
      return;
    }

    try {
      const sesionData: Omit<SesionQR, 'id'> = {
        tipo: 'ACUMULACION',
        creadorId: userData!.uid,
        creadorAlias: userData!.email?.split('@')[0] || 'Vendedor',
        comercioId: comercio!.id,
        estado: 'PENDIENTE',
        createdAt: Date.now(),
        montoFactura: Number(montoFactura),
        nroFactura,
        puntosCalculados: puntos,
        reglaAplicadaId: reglaSeleccionada
      };

      const docRef = await addDoc(collection(db, 'sesiones_qr'), sesionData);
      setQrData(docRef.id);
    } catch (error) {
      console.error("Error al generar QR:", error);
      alert("Hubo un error al generar el código QR.");
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando panel del vendedor...</div>;
  if (!comercio) return <div className="p-8 text-center text-red-500">Error: Comercio no encontrado.</div>;

  const puntosTotales = calcularPuntos();
  const reglasActivas = comercio.reglas.filter(r => r.activa);
  const reglasProducto = reglasActivas.filter(r => r.tipo === 'POR_PRODUCTO');

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Panel Vendedor</h2>
        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
          <button 
            onClick={() => { setActiveTab('GENERAR'); setMensaje(null); }}
            className={`px-4 py-2 text-sm font-bold rounded-md transition ${activeTab === 'GENERAR' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Otorgar Puntos
          </button>
          <button 
            onClick={() => { setActiveTab('ESCANEAR'); setMensaje(null); }}
            className={`px-4 py-2 text-sm font-bold rounded-md transition ${activeTab === 'ESCANEAR' ? 'bg-white shadow-sm text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Canjear Premio
          </button>
        </div>
      </div>

      {mensaje && (
        <div className={`p-4 rounded-lg mb-6 ${
          mensaje.tipo === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 
          mensaje.tipo === 'error' ? 'bg-red-100 text-red-800 border border-red-200' : 
          'bg-blue-100 text-blue-800 border border-blue-200'
        }`}>
          {mensaje.texto}
          <button className="float-right font-bold" onClick={() => setMensaje(null)}>✕</button>
        </div>
      )}

      {activeTab === 'GENERAR' && (
        <>
          {!qrData ? (
        <form onSubmit={generarQR} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número de Factura</label>
              <input 
                type="text" required
                className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={nroFactura} onChange={(e) => setNroFactura(e.target.value)}
                placeholder="000-000-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto de la Factura (Bs.)</label>
              <input 
                type="number" required min="1" step="0.01"
                className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={montoFactura} onChange={(e) => setMontoFactura(Number(e.target.value) || '')}
                placeholder="100.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Selecciona la Regla a Aplicar</label>
            {reglasActivas.length === 0 ? (
              <p className="text-red-500 text-sm">No hay reglas activas. Contacta al administrador.</p>
            ) : (
              <div className="space-y-2">
                {reglasActivas.map(r => (
                  <label key={r.id} className={`flex items-center p-3 border rounded-lg cursor-pointer transition ${reglaSeleccionada === r.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input 
                      type="radio" 
                      name="regla" 
                      value={r.id} 
                      checked={reglaSeleccionada === r.id}
                      onChange={(e) => setReglaSeleccionada(e.target.value)}
                      className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">
                        {r.tipo === 'POR_COMPRA' && 'Regla por Compra General'}
                        {r.tipo === 'POR_MONTO' && 'Regla por Rangos de Monto'}
                        {r.tipo === 'POR_PRODUCTO' && `Producto Específico: ${r.nombreProducto}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {r.tipo !== 'POR_MONTO' && `Otorga ${r.puntosAOtorgar} pts.`}
                        {r.tipo === 'POR_MONTO' && 'Los puntos se calcularán según el rango en el que caiga el monto (Bs).'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {reglaSeleccionada && reglasActivas.find(r => r.id === reglaSeleccionada)?.tipo === 'POR_PRODUCTO' && (
            <div className="pt-4 border-t border-gray-100">
              <h3 className="font-medium text-gray-800 mb-3">Cantidad de Productos Especiales</h3>
              <div className="space-y-2">
                {reglasProducto.filter(r => r.id === reglaSeleccionada).map(r => {
                  const qty = productos.find(p => p.id === r.id)?.qty || 0;
                  return (
                    <div key={r.id} className="flex justify-between items-center p-3 bg-gray-50 rounded border border-gray-200">
                      <div>
                        <span className="font-medium text-gray-800">{r.nombreProducto}</span>
                        <span className="text-xs text-gray-500 ml-2">({r.puntosAOtorgar} pts c/u)</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => handleRemoveProduct(r.id)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-gray-300 hover:bg-gray-100">-</button>
                        <span className="w-4 text-center font-bold">{qty}</span>
                        <button type="button" onClick={() => handleAddProduct(r.id)} className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white border border-blue-600 hover:bg-blue-700">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-blue-50 p-4 rounded-lg flex justify-between items-center border border-blue-100">
            <span className="text-blue-900 font-medium">Puntos Calculados:</span>
            <span className="text-2xl font-bold text-blue-700">{puntosTotales}</span>
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white font-medium py-3 rounded-lg hover:bg-blue-700 transition shadow-sm">
            Generar Código QR
          </button>
        </form>
      ) : (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center">
          <h3 className="text-xl font-bold text-gray-800 mb-2">QR Listo para Escanear</h3>
          <p className="text-gray-500 text-sm mb-6 text-center">Pídele al cliente que escanee este código desde su aplicación para recibir <strong>{puntosTotales} puntos</strong>.</p>
          
          <div className="bg-white p-4 border-2 border-gray-200 rounded-xl mb-4">
            <QRCodeSVG value={qrData} size={200} />
          </div>

          <div className="bg-blue-50 w-full p-3 rounded text-center mb-8 border border-blue-100">
            <p className="text-xs text-blue-800 font-medium mb-1">ID del QR (Para pruebas manuales sin cámara):</p>
            <code className="text-xs text-blue-600 font-bold select-all">{qrData}</code>
          </div>

          <button 
            onClick={() => {
              setQrData(null);
              setNroFactura('');
              setMontoFactura('');
              setProductos([]);
            }} 
            className="text-blue-600 font-medium hover:underline"
          >
            ← Volver y generar otra factura
          </button>
        </div>
      )}
      </>
      )}

      {activeTab === 'ESCANEAR' && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center">
          <h3 className="font-bold text-lg mb-4 text-purple-900">Escanear QR de Canje</h3>
          
          <div className="w-full max-w-sm mt-2">
            <p className="text-sm text-gray-600 mb-4 text-center">Para pruebas en local sin cámara web, pide al cliente el ID de su QR de canje e ingrésalo aquí:</p>
            <div className="flex gap-2">
              <input 
                id="manual-qr-canje-input"
                type="text" 
                placeholder="Pegar ID del QR de canje..." 
                className="flex-1 border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              />
              <button 
                onClick={() => {
                  const input = document.getElementById('manual-qr-canje-input') as HTMLInputElement;
                  if (input.value) procesarQRCanje(input.value);
                }}
                className="bg-purple-600 text-white px-4 py-2 rounded font-medium text-sm hover:bg-purple-700"
              >
                Procesar Canje
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorDashboard;
