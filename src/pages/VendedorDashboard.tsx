import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { doc, getDoc, collection, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, SesionQR, SaldoPunto, Transaccion } from '../types';
import { getPaletteStyle } from '../utils/theme';
import { generarCodigoUnicoQR } from '../utils/qr';

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
  const [escaneando, setEscaneando] = useState(false);

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
    setEscaneando(false);
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

    if (regla.tipo === 'POR_COMPRA') {
      total = regla.puntosAOtorgar || 0;
    } else if (regla.tipo === 'POR_PRODUCTO') {
      const seleccion = productos.find(p => p.id === regla.id);
      if (seleccion) {
        total = (seleccion.qty * (regla.puntosAOtorgar || 0));
      }
    } else if (regla.tipo === 'POR_RANGO') {
      const monto = Number(montoFactura) || 0;
      if (monto >= (regla.rangoDesde || 0) && monto <= (regla.rangoHasta || Infinity)) {
        total = regla.puntosAOtorgar || 0;
      }
    } else if (regla.tipo === 'POR_REGISTRO') {
      total = regla.puntosAOtorgar || 0;
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
      const codigo = await generarCodigoUnicoQR(db);
      const sesionData: Omit<SesionQR, 'id'> = {
        tipo: 'ACUMULACION',
        creadorId: userData!.uid,
        creadorAlias: userData!.email?.split('@')[0] || 'Vendedor',
        comercioId: comercio!.id,
        estado: 'PENDIENTE',
        createdAt: Date.now(),
        montoFactura: Number(montoFactura) || 0,
        nroFactura: (reglaSeleccionada && comercio!.reglas.find(r => r.id === reglaSeleccionada)?.tipo === 'POR_REGISTRO') ? 'BONO BIENVENIDA' : nroFactura,
        puntosCalculados: puntos,
        reglaAplicadaId: reglaSeleccionada
      };

      await setDoc(doc(db, 'sesiones_qr', codigo), sesionData);
      setQrData(codigo);
    } catch (error) {
      console.error("Error al generar código de 6 dígitos:", error);
      alert("Hubo un error al generar el código.");
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando panel del vendedor...</div>;
  if (!comercio) return <div className="p-8 text-center text-red-500">Error: Comercio no encontrado.</div>;

  const puntosTotales = calcularPuntos();
  const reglasActivas = comercio.reglas.filter(r => {
    if (!r.activa) return false;
    if (r.tipo === 'POR_RANGO') {
      const monto = Number(montoFactura) || 0;
      return monto >= (r.rangoDesde || 0) && monto <= (r.rangoHasta || Infinity);
    }
    return true;
  });
  const reglasProducto = reglasActivas.filter(r => r.tipo === 'POR_PRODUCTO');

  return (
    <div style={getPaletteStyle(comercio.paletteId)} className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b pb-4">
        <div className="flex items-center gap-3">
          {comercio.logoUrl ? (
            <img src={comercio.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded border bg-white flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 bg-brand-bg-light text-brand-primary rounded flex items-center justify-center font-bold text-lg border border-brand-border flex-shrink-0">NB</div>
          )}
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Panel Vendedor</h2>
            <p className="text-sm text-gray-500 font-semibold">{comercio.nombre}</p>
          </div>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
          <button 
            onClick={() => { setActiveTab('GENERAR'); setMensaje(null); }}
            className={`px-4 py-2 text-sm font-bold rounded-md transition ${activeTab === 'GENERAR' ? 'bg-white shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Otorgar Puntos
          </button>
          <button 
            onClick={() => { setActiveTab('ESCANEAR'); setMensaje(null); }}
            className={`px-4 py-2 text-sm font-bold rounded-md transition ${activeTab === 'ESCANEAR' ? 'bg-white shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Canjear Premio
          </button>
        </div>
      </div>

      {mensaje && (
        <div className={`p-4 rounded-lg mb-6 ${
          mensaje.tipo === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 
          mensaje.tipo === 'error' ? 'bg-red-100 text-red-800 border border-red-200' : 
          'bg-brand-bg-light text-brand-text-dark border border-brand-border'
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
                type="text" required={comercio?.reglas.find(r => r.id === reglaSeleccionada)?.tipo !== 'POR_REGISTRO'}
                className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-brand-primary"
                value={nroFactura} onChange={(e) => setNroFactura(e.target.value)}
                placeholder="000-000-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto de la Factura (Bs.)</label>
              <input 
                type="number" required={comercio?.reglas.find(r => r.id === reglaSeleccionada)?.tipo !== 'POR_REGISTRO'} min="0" step="0.01"
                className="w-full border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-brand-primary"
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
                  <label key={r.id} className={`flex items-center p-3 border rounded-lg cursor-pointer transition ${reglaSeleccionada === r.id ? 'border-brand-primary bg-brand-bg-light' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input 
                      type="radio" 
                      name="regla" 
                      value={r.id} 
                      checked={reglaSeleccionada === r.id}
                      onChange={(e) => setReglaSeleccionada(e.target.value)}
                      className="mr-3 h-4 w-4 text-brand-primary focus:ring-brand-primary"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">
                        {r.tipo === 'POR_COMPRA' && 'Regla por Compra General'}
                        {r.tipo === 'POR_PRODUCTO' && `Producto Específico: ${r.nombreProducto}`}
                        {r.tipo === 'POR_RANGO' && `Rango: Bs. ${r.rangoDesde} a Bs. ${r.rangoHasta}`}
                        {r.tipo === 'POR_REGISTRO' && 'Bono de Bienvenida/Registro'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Otorga {r.puntosAOtorgar} pts.
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
                        <button type="button" onClick={() => handleAddProduct(r.id)} className="w-8 h-8 flex items-center justify-center rounded-full bg-brand-primary text-white border border-blue-600 hover:bg-brand-primary-hover">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-brand-bg-light p-4 rounded-lg flex justify-between items-center border border-brand-border">
            <span className="text-brand-text-dark font-medium">Puntos Calculados:</span>
            <span className="text-2xl font-bold text-brand-primary">{puntosTotales}</span>
          </div>

          <button type="submit" className="w-full bg-brand-primary text-white font-medium py-3 rounded-lg hover:bg-brand-primary-hover transition shadow-sm">
            Generar Código / QR
          </button>
        </form>
      ) : (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center">
          <h3 className="text-xl font-bold text-gray-800 mb-2">Código y QR Listo</h3>
          <p className="text-gray-500 text-sm mb-6 text-center">Pídele al cliente que escanee este código desde su aplicación, o dale este código de 6 dígitos:</p>
          
          <div className="bg-white p-4 border-2 border-gray-200 rounded-xl mb-4">
            <QRCodeSVG value={qrData} size={200} />
          </div>

          <div className="bg-brand-bg-light w-full p-4 rounded text-center mb-8 border border-brand-border">
            <p className="text-xs text-brand-text-dark font-medium mb-2 uppercase tracking-wider">Código de 6 dígitos (Uso Único):</p>
            <div className="text-3xl font-black text-brand-primary tracking-widest select-all">{qrData}</div>
          </div>

          <button 
            onClick={() => {
              setQrData(null);
              setNroFactura('');
              setMontoFactura('');
              setProductos([]);
            }} 
            className="text-brand-primary font-medium hover:underline"
          >
            ← Volver y generar otra factura
          </button>
        </div>
      )}
      </>
      )}

      {activeTab === 'ESCANEAR' && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center">
          <h3 className="font-bold text-lg mb-4 text-brand-text-dark">Escanear QR o Código de Canje</h3>
          
          {!escaneando ? (
            <button 
              onClick={() => setEscaneando(true)}
              className="w-full max-w-sm bg-brand-secondary text-white font-medium py-4 rounded-xl shadow-md hover:opacity-90 transition flex items-center justify-center gap-2 mb-8"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
              Abrir Cámara
            </button>
          ) : (
            <>
              <div className="w-full max-w-sm overflow-hidden rounded-lg border-2 border-dashed border-brand-border relative bg-gray-50 flex items-center justify-center min-h-[250px]">
                <Scanner 
                  onScan={(result) => {
                    if (result && result.length > 0) {
                      procesarQRCanje(result[0].rawValue);
                    }
                  }}
                />
              </div>
              <button 
                onClick={() => setEscaneando(false)}
                className="mt-4 text-red-600 font-medium hover:underline"
              >
                Cerrar Cámara
              </button>
            </>
          )}

          <div className="w-full max-w-sm mt-6 pt-6 border-t border-gray-100">
            <p className="text-sm text-gray-600 mb-4 text-center">O ingresa el código de 6 dígitos del cliente:</p>
            <div className="flex gap-2">
              <input 
                id="manual-qr-canje-input"
                type="text" 
                maxLength={6}
                placeholder="Ej. 123456" 
                className="flex-1 border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-brand-secondary text-sm text-center font-bold tracking-widest"
              />
              <button 
                onClick={() => {
                  const input = document.getElementById('manual-qr-canje-input') as HTMLInputElement;
                  if (input.value) procesarQRCanje(input.value.trim());
                }}
                className="bg-brand-secondary text-white px-4 py-2 rounded font-medium text-sm hover:opacity-90"
              >
                Procesar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorDashboard;
