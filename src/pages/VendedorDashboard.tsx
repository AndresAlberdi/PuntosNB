import React, { useEffect, useState } from 'react';
import { doc, getDoc, collection, setDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Comercio, SesionQR, Transaccion, SaldoPunto } from '../types';
import { getPaletteStyle } from '../utils/theme';
import { checkComercioPrepagoStatus } from '../utils/reports';

const VendedorDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'GENERAR' | 'ESCANEAR'>('GENERAR');

  // Generation state
  const [montoFactura, setMontoFactura] = useState<string>('');
  const [nroFactura, setNroFactura] = useState<string>('');
  const [sinFactura, setSinFactura] = useState<boolean>(false);
  const [reglaSeleccionada, setReglaSeleccionada] = useState<string>('');
  const [productos, setProductos] = useState<{ id: string, qty: number }[]>([]);
  const [qrData, setQrData] = useState<string | null>(null);

  // Scanning / Code redemption state
  const [codigoManual, setCodigoManual] = useState<string>('');
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    const fetchComercio = async () => {
      if (userData?.comercioId) {
        try {
          const docRef = doc(db, 'comercios', userData.comercioId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const comData = docSnap.data() as Comercio;
            setComercio(comData);
            
            const reglasActivas = comData.reglas?.filter(r => r.activa) || [];
            const reglaCompra = reglasActivas.find(r => r.tipo === 'POR_COMPRA');
            if (reglaCompra) {
              setReglaSeleccionada(reglaCompra.id);
            } else if (reglasActivas.length > 0) {
              setReglaSeleccionada(reglasActivas[0].id);
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

  // Listener para QR activo generado por el vendedor
  useEffect(() => {
    if (!qrData) return;

    const unsubscribe = onSnapshot(doc(db, 'sesiones_qr', qrData), (docSnap) => {
      if (docSnap.exists()) {
        const sesion = docSnap.data() as SesionQR;
        if (sesion.estado === 'USADO') {
          setMensaje({ texto: "¡Puntos asignados al cliente con éxito!", tipo: 'success' });
          setQrData(null);
          setMontoFactura('');
          setNroFactura('');
          setSinFactura(false);
          setProductos([]);
        }
      }
    });

    return () => unsubscribe();
  }, [qrData]);

  // Procesar canje de premio introducido por el cliente (6 dígitos o QR)
  const handleProcesarCodigoPremio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigoManual || !comercio || !userData) return;
    setMensaje(null);

    // Verificar prepago antes de canjear
    const prepagoStatus = checkComercioPrepagoStatus(comercio);
    if (!prepagoStatus.puedeOperar) {
      setMensaje({ texto: "Comercio deshabilitado temporalmente por falta de pago.", tipo: 'error' });
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const sesionRef = doc(db, 'sesiones_qr', codigoManual.trim());
        const sesionDoc = await transaction.get(sesionRef);

        if (!sesionDoc.exists()) {
          throw new Error("El código no es válido o no existe.");
        }

        const sesion = sesionDoc.data() as SesionQR;
        if (sesion.estado !== 'PENDIENTE') {
          throw new Error("Este código ya fue procesado o ha expirado.");
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

        // Si es prepago, verificar y deducir costo por premio del saldo del comercio
        const comercioRef = doc(db, 'comercios', comercio.id);
        const comDoc = await transaction.get(comercioRef);
        if (comDoc.exists()) {
          const comFresh = comDoc.data() as Comercio;
          if (comFresh.modalidadPago === 'PREPAGO') {
            const costo = comFresh.costoPorPremioBs || 1.25;
            const nuevoSaldo = Math.max(0, (comFresh.saldoPremiosBs || 0) - costo);
            transaction.update(comercioRef, { saldoPremiosBs: nuevoSaldo });
          }
        }

        // 1. Marcar sesión como usada
        transaction.update(sesionRef, { estado: 'USADO' });

        // 2. Registrar transacción
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

        // 3. Actualizar saldo cliente
        transaction.update(saldoRef, {
          saldoTotal: saldoActual.saldoTotal - puntosARestar,
          updatedAt: Date.now()
        });
      });

      setMensaje({ texto: "¡Canje aprobado y procesado exitosamente! Entrega el premio al cliente.", tipo: 'success' });
      setCodigoManual('');
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
    if (!comercio) return 0;
    
    // 1. Puntos acumulados por productos especiales seleccionados
    let ptsProductos = 0;
    productos.forEach(prod => {
      const reglaProd = comercio.reglas.find(r => r.id === prod.id);
      if (reglaProd && reglaProd.activa) {
        ptsProductos += prod.qty * (reglaProd.puntosAOtorgar || 0);
      }
    });

    // 2. Si hay productos agregados, sumamos los puntos de productos
    const reglaSel = comercio.reglas.find(r => r.id === reglaSeleccionada);
    
    if (reglaSel) {
      if (reglaSel.tipo === 'POR_COMPRA') {
        const monto = Number(montoFactura) || 0;
        return Math.floor(monto * (reglaSel.puntosAOtorgar || 0)) + ptsProductos;
      } else if (reglaSel.tipo === 'POR_RANGO') {
        return (reglaSel.puntosAOtorgar || 0) + ptsProductos;
      } else if (reglaSel.tipo === 'POR_REGISTRO') {
        return (reglaSel.puntosAOtorgar || 0) + ptsProductos;
      } else if (reglaSel.tipo === 'POR_PRODUCTO') {
        return ptsProductos;
      }
    }

    return ptsProductos;
  };

  const generarQR = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);

    const prepagoStatus = checkComercioPrepagoStatus(comercio!);
    if (!prepagoStatus.puedeOperar) {
      setMensaje({ texto: "Comercio deshabilitado temporalmente por falta de pago de mensualidad.", tipo: 'error' });
      return;
    }

    const puntos = calcularPuntos();
    if (puntos <= 0) {
      setMensaje({ texto: "El cálculo de puntos debe ser mayor a 0 para generar el código.", tipo: 'error' });
      return;
    }

    try {
      const codigo = Math.floor(100000 + Math.random() * 900000).toString();
      const nroFinal = sinFactura ? 'S/F' : (nroFactura.trim() || 'S/F');

      const sesionData: SesionQR = {
        id: codigo,
        tipo: 'ACUMULACION',
        creadorId: userData!.uid,
        creadorAlias: userData!.email?.split('@')[0] || 'Vendedor',
        comercioId: comercio!.id,
        estado: 'PENDIENTE',
        createdAt: Date.now(),
        montoFactura: Number(montoFactura) || 0,
        nroFactura: (reglaSeleccionada && comercio!.reglas.find(r => r.id === reglaSeleccionada)?.tipo === 'POR_REGISTRO') ? 'BONO BIENVENIDA' : nroFinal,
        puntosCalculados: puntos,
        reglaAplicadaId: reglaSeleccionada
      };

      await setDoc(doc(db, 'sesiones_qr', codigo), sesionData);
      setQrData(codigo);
    } catch (error) {
      console.error("Error al generar código de 6 dígitos:", error);
      setMensaje({ texto: "Hubo un error al generar el código.", tipo: 'error' });
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando panel del vendedor...</div>;
  if (!comercio) return <div className="p-8 text-center text-red-500">Error: Comercio no encontrado.</div>;

  const prepagoStatus = checkComercioPrepagoStatus(comercio);
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
    <div style={getPaletteStyle(comercio.paletteId)} className="w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      
      {/* Alertas de Prepago para Vendedores */}
      {comercio.modalidadPago === 'PREPAGO' && (
        <>
          {prepagoStatus.alertaRojaMensualidad && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm text-red-800 text-xs">
              <strong className="font-black text-sm block">⚠️ Comercio Temporalmente Inhabilitado</strong>
              La mensualidad no ha sido prepagada. No se pueden otorgar puntos ni canjear premios.
            </div>
          )}
          {prepagoStatus.alertaAmarillaMensualidad && !prepagoStatus.alertaRojaMensualidad && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-xl shadow-sm text-amber-900 text-xs">
              <strong>⏳ Alerta de Prepago:</strong> La mensualidad vence en {prepagoStatus.diasRestantesMes} días.
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          {comercio.logoUrl ? (
            <img src={comercio.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded-xl border bg-white flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 bg-brand-bg-light text-brand-primary rounded-xl flex items-center justify-center font-bold text-lg border border-brand-border flex-shrink-0">NB</div>
          )}
          <div>
            <h2 className="text-xl font-black text-gray-800 dark:text-white">Panel de Ventas y Canje</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold">{comercio.nombre}</p>
          </div>
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl text-xs font-bold">
          <button 
            onClick={() => { setActiveTab('GENERAR'); setMensaje(null); }}
            className={`px-4 py-2 rounded-lg transition ${activeTab === 'GENERAR' ? 'bg-white dark:bg-gray-800 shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
          >
            Otorgar Puntos
          </button>
          <button 
            onClick={() => { setActiveTab('ESCANEAR'); setMensaje(null); }}
            className={`px-4 py-2 rounded-lg transition ${activeTab === 'ESCANEAR' ? 'bg-white dark:bg-gray-800 shadow-sm text-brand-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
          >
            Canjear Premio
          </button>
        </div>
      </div>

      {activeTab === 'GENERAR' && (
        <>
          {!qrData ? (
            <form onSubmit={generarQR} className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-6 text-xs">
              
              {/* Mensajes de Alerta dentro del mismo recuadro */}
              {mensaje && (
                <div className={`p-3 rounded-xl text-xs font-bold flex justify-between items-center ${
                  mensaje.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  <span>{mensaje.texto}</span>
                  <button type="button" onClick={() => setMensaje(null)} className="font-black ml-2">✕</button>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-bold text-gray-700 dark:text-gray-300">Número de Factura</label>
                    <button
                      type="button"
                      onClick={() => {
                        setSinFactura(!sinFactura);
                        if (!sinFactura) setNroFactura('');
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded font-black transition cursor-pointer ${sinFactura ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {sinFactura ? '✓ Marcado Sin Factura' : 'Botón: Sin Factura'}
                    </button>
                  </div>
                  <input 
                    type="text" 
                    disabled={sinFactura}
                    required={!sinFactura && comercio?.reglas.find(r => r.id === reglaSeleccionada)?.tipo !== 'POR_REGISTRO'}
                    className={`w-full border rounded-xl px-3 py-2 ${sinFactura ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white'}`}
                    value={sinFactura ? 'S/F' : nroFactura} 
                    onChange={(e) => setNroFactura(e.target.value)}
                    placeholder="000-000-001"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">Monto de la Venta (Bs.)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    min="0"
                    className="w-full border rounded-xl px-3 py-2 bg-white font-bold text-gray-800"
                    value={montoFactura} 
                    onChange={(e) => setMontoFactura(e.target.value)}
                    placeholder="Ej: 150.00"
                  />
                </div>
              </div>

              {/* Selector de Regla */}
              <div>
                <label className="block font-bold text-gray-700 dark:text-gray-300 mb-2">Seleccionar Regla / Promoción</label>
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {reglasActivas.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setReglaSeleccionada(r.id);
                      }}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                        reglaSeleccionada === r.id 
                          ? 'border-brand-primary bg-brand-bg-light ring-2 ring-brand-primary' 
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-bold text-gray-800">
                        {r.tipo === 'POR_COMPRA' && 'General por Compra'}
                        {r.tipo === 'POR_PRODUCTO' && `Producto: ${r.nombreProducto}`}
                        {r.tipo === 'POR_RANGO' && `Rango ($${r.rangoDesde}-$${r.rangoHasta})`}
                        {r.tipo === 'POR_REGISTRO' && 'Bono Primer Registro'}
                      </span>
                      <span className="text-brand-primary font-black mt-1">+{r.puntosAOtorgar} pts</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Catálogo con Fotos para Productos Especiales */}
              {reglasProducto.length > 0 && (
                <div className="border-t pt-4 space-y-3">
                  <label className="font-bold text-gray-700 dark:text-gray-300 block">Agregar Productos Especiales Vendidos</label>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {reglasProducto.map(rp => {
                      const prodItem = productos.find(p => p.id === rp.id);
                      const qty = prodItem ? prodItem.qty : 0;
                      return (
                        <div key={rp.id} className="p-3 border rounded-xl bg-white flex items-center justify-between gap-2 shadow-sm">
                          <div className="flex items-center gap-2">
                            {rp.imagenUrl ? (
                              <img src={rp.imagenUrl} alt="Foto" className="w-10 h-10 object-cover rounded-lg border" />
                            ) : (
                              <div className="w-10 h-10 bg-purple-100 text-purple-700 rounded-lg flex items-center justify-center font-bold text-xs">📦</div>
                            )}
                            <div>
                              <strong className="block text-gray-800">{rp.nombreProducto}</strong>
                              <span className="text-purple-600 font-bold">+{rp.puntosAOtorgar} pts c/u</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {qty > 0 && (
                              <button 
                                type="button" 
                                onClick={() => handleRemoveProduct(rp.id)} 
                                className="w-6 h-6 bg-red-100 text-red-700 rounded font-black flex items-center justify-center cursor-pointer"
                              >
                                -
                              </button>
                            )}
                            <span className="font-black px-1">{qty}</span>
                            <button 
                              type="button" 
                              onClick={() => handleAddProduct(rp.id)} 
                              className="w-6 h-6 bg-green-100 text-green-700 rounded font-black flex items-center justify-center cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Botón Generar QR */}
              <div className="border-t pt-4 flex items-center justify-between">
                <div>
                  <span className="text-gray-400 block font-bold">Puntos a Entregar:</span>
                  <span className="text-2xl font-black text-brand-primary">{puntosTotales} pts</span>
                </div>
                <button
                  type="submit"
                  disabled={!prepagoStatus.puedeOperar}
                  className={`px-6 py-3 rounded-xl font-black text-white text-sm shadow transition ${
                    prepagoStatus.puedeOperar ? 'bg-brand-primary hover:bg-brand-primary-hover cursor-pointer' : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  Generar Código QR
                </button>
              </div>

            </form>
          ) : (
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center space-y-4 max-w-md mx-auto">
              <h3 className="text-lg font-black text-gray-800 dark:text-white">Escanea el Código QR</h3>
              <p className="text-xs text-gray-500">Pide al cliente que escanee este código desde su teléfono para recibir sus puntos.</p>

              <div className="p-4 bg-white rounded-2xl shadow-md border inline-block">
                <QRCodeSVG value={qrData} size={220} level="H" />
              </div>

              <div className="space-y-1">
                <span className="text-xs text-gray-400 font-bold uppercase block">O introduce el código de 6 dígitos</span>
                <span className="text-3xl font-mono font-black text-brand-primary tracking-widest">{qrData}</span>
              </div>

              <button
                type="button"
                onClick={() => setQrData(null)}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Cancelar y Nueva Venta
              </button>
            </div>
          )}
        </>
      )}

      {/* Pestaña Canjear Premio */}
      {activeTab === 'ESCANEAR' && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 max-w-lg mx-auto space-y-4 text-xs">
          <h3 className="text-base font-black text-gray-800 dark:text-white">Validar Canje de Premio</h3>
          <p className="text-gray-500">Ingresa el código numérico de 6 dígitos que el cliente generó al canjear su premio:</p>

          {mensaje && (
            <div className={`p-3 rounded-xl text-xs font-bold flex justify-between items-center ${
              mensaje.tipo === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              <span>{mensaje.texto}</span>
              <button type="button" onClick={() => setMensaje(null)} className="font-black ml-2">✕</button>
            </div>
          )}

          <form onSubmit={handleProcesarCodigoPremio} className="space-y-4">
            <div>
              <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">Código de Canje (6 Dígitos)</label>
              <input 
                type="text" 
                required
                maxLength={6}
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej: 849201"
                className="w-full border rounded-xl px-3 py-2.5 font-mono text-center text-2xl font-black text-brand-primary tracking-widest"
              />
            </div>

            <button
              type="submit"
              disabled={!prepagoStatus.puedeOperar}
              className={`w-full py-3 rounded-xl font-black text-white text-sm shadow transition ${
                prepagoStatus.puedeOperar ? 'bg-purple-600 hover:bg-purple-700 cursor-pointer' : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              Validar y Descontar Premio
            </button>
          </form>
        </div>
      )}

    </div>
  );
};

export default VendedorDashboard;
