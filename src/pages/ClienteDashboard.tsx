import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, runTransaction, getDoc, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Scanner } from '@yudiel/react-qr-scanner';
import { QRCodeSVG } from 'qrcode.react';
import type { SaldoPunto, SesionQR, Transaccion, Premio, Comercio } from '../types';

const ClienteDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [saldos, setSaldos] = useState<(SaldoPunto & { comercioNombre?: string, premios?: Premio[] })[]>([]);
  const [escaneando, setEscaneando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string, tipo: 'success' | 'error' | 'info' } | null>(null);
  
  // Para el canje
  const [qrCanje, setQrCanje] = useState<{ id: string, premio: string, puntos: number } | null>(null);

  const cargarSaldos = async () => {
    if (!userData) return;
    const q = query(collection(db, 'puntos_saldos'), where('clienteId', '==', userData.uid));
    const querySnapshot = await getDocs(q);
    
    const saldosCargados: (SaldoPunto & { comercioNombre?: string, premios?: Premio[] })[] = [];
    for (const docSnap of querySnapshot.docs) {
      const saldo = docSnap.data() as SaldoPunto;
      const comercioDoc = await getDoc(doc(db, 'comercios', saldo.comercioId));
      if (comercioDoc.exists()) {
        const cData = comercioDoc.data() as Comercio;
        saldosCargados.push({ ...saldo, comercioNombre: cData.nombre, premios: cData.premios.filter(p => p.activo) });
      } else {
        saldosCargados.push(saldo);
      }
    }
    setSaldos(saldosCargados);
  };

  useEffect(() => {
    cargarSaldos();
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
      cargarSaldos();

    } catch (error: any) {
      console.error(error);
      setMensaje({ texto: error.message || "Error al procesar el código.", tipo: 'error' });
    }
  };

  const generarQRCanje = async (comercioId: string, premio: Premio) => {
    if (!userData) return;
    try {
      setMensaje({ texto: "Generando QR de canje...", tipo: 'info' });
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

      const docRef = await addDoc(collection(db, 'sesiones_qr'), sesionData);
      setQrCanje({ id: docRef.id, premio: premio.nombre, puntos: premio.puntosRequeridos });
      setMensaje(null);
    } catch (error) {
      console.error("Error al generar QR de canje:", error);
      setMensaje({ texto: "Error al generar el QR.", tipo: 'error' });
    }
  };

  if (qrCanje) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Canjear Premio</h2>
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center">
          <h3 className="text-xl font-bold text-gray-800 mb-2">{qrCanje.premio}</h3>
          <p className="text-gray-500 text-sm mb-6 text-center">Muestra este código al cajero para descontar <strong>{qrCanje.puntos} pts</strong> y recibir tu premio.</p>
          
          <div className="bg-white p-4 border-2 border-gray-200 rounded-xl mb-4">
            <QRCodeSVG value={qrCanje.id} size={200} />
          </div>

          <div className="bg-purple-50 w-full p-3 rounded text-center mb-8 border border-purple-100">
            <p className="text-xs text-purple-800 font-medium mb-1">ID del QR (Para pruebas manuales sin cámara):</p>
            <code className="text-xs text-purple-600 font-bold select-all">{qrCanje.id}</code>
          </div>

          <button 
            onClick={() => {
              setQrCanje(null);
              cargarSaldos();
            }} 
            className="text-blue-600 font-medium hover:underline"
          >
            ← Volver a mi saldo (Cancelar Canje)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Mis Puntos</h2>

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

      {escaneando ? (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-8 flex flex-col items-center">
          <h3 className="font-bold text-lg mb-4">Escanear o Ingresar Código</h3>
          <div className="w-full max-w-sm overflow-hidden rounded-lg border-2 border-dashed border-blue-300 relative bg-gray-50 flex items-center justify-center min-h-[250px]">
            <Scanner 
              onScan={(result) => {
                if (result && result.length > 0) {
                  procesarQR(result[0].rawValue);
                }
              }}
            />
          </div>
          
          <div className="w-full max-w-sm mt-6">
            <p className="text-xs text-gray-500 mb-2 text-center">¿La cámara no funciona? (Requiere HTTPS o Localhost). Ingresa el ID del QR manualmente:</p>
            <div className="flex gap-2">
              <input 
                id="manual-qr-input"
                type="text" 
                placeholder="Pegar ID del QR..." 
                className="flex-1 border border-gray-300 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <button 
                onClick={() => {
                  const input = document.getElementById('manual-qr-input') as HTMLInputElement;
                  if (input.value) procesarQR(input.value);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded font-medium text-sm hover:bg-blue-700"
              >
                Canjear
              </button>
            </div>
          </div>

          <button 
            onClick={() => setEscaneando(false)}
            className="mt-6 text-red-600 font-medium hover:underline"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button 
          onClick={() => setEscaneando(true)}
          className="w-full bg-blue-600 text-white font-medium py-4 rounded-xl shadow-md hover:bg-blue-700 transition flex items-center justify-center gap-2 mb-8"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
          Escanear Código para Acumular
        </button>
      )}

      <div>
        <h3 className="text-xl font-bold text-gray-800 mb-4">Saldos y Premios Disponibles</h3>
        {saldos.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 p-8 rounded-xl text-center text-gray-500">
            Aún no tienes puntos acumulados en ningún comercio.
          </div>
        ) : (
          <div className="space-y-6">
            {saldos.map(saldo => (
              <div key={saldo.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-5 flex justify-between items-center bg-gray-50 border-b border-gray-100">
                  <div>
                    <h4 className="font-bold text-gray-800 text-lg">{saldo.comercioNombre || 'Comercio'}</h4>
                    <p className="text-xs text-gray-500">Última actualización: {new Date(saldo.updatedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <span className="block text-3xl font-black text-blue-600">{saldo.saldoTotal}</span>
                    <span className="text-xs font-medium text-gray-500 uppercase">Puntos</span>
                  </div>
                </div>
                
                {saldo.premios && saldo.premios.length > 0 && (
                  <div className="p-5">
                    <p className="text-xs font-bold text-gray-400 uppercase mb-3">Catálogo de Premios</p>
                    <div className="grid gap-3">
                      {saldo.premios.map(premio => {
                        const canAfford = saldo.saldoTotal >= premio.puntosRequeridos;
                        return (
                          <div key={premio.id} className={`flex justify-between items-center p-3 rounded border ${canAfford ? 'border-yellow-200 bg-yellow-50' : 'border-gray-100 bg-white opacity-60'}`}>
                            <div>
                              <span className="block font-bold text-gray-800">{premio.nombre}</span>
                              <span className="text-xs text-gray-500">{premio.puntosRequeridos} pts requeridos</span>
                            </div>
                            <button
                              disabled={!canAfford}
                              onClick={() => generarQRCanje(saldo.comercioId, premio)}
                              className={`text-sm font-medium px-4 py-2 rounded ${canAfford ? 'bg-yellow-500 text-white hover:bg-yellow-600 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                            >
                              Canjear
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClienteDashboard;
