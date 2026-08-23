import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, updateDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { AsignacionInfluencer, CodigoInfluencer, Comercio } from '../types';

export const InfluencerDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [asignaciones, setAsignaciones] = useState<AsignacionInfluencer[]>([]);
  const [codigos, setCodigos] = useState<CodigoInfluencer[]>([]);
  const [comercios, setComercios] = useState<Record<string, Comercio>>({});
  const [loading, setLoading] = useState(true);

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const fetchData = async () => {
    if (!userData) return;
    try {
      // Fetch asignaciones
      const qAsign = query(collection(db, 'asignaciones_influencer'), where('influencerId', '==', userData.uid));
      const snapAsign = await getDocs(qAsign);
      const asigs: AsignacionInfluencer[] = [];
      const comerciosMap: Record<string, Comercio> = { ...comercios };

      snapAsign.forEach(d => asigs.push(d.data() as AsignacionInfluencer));

      // Fetch comercios for those asignaciones
      for (const asig of asigs) {
        if (!comerciosMap[asig.comercioId]) {
          const cSnap = await getDocs(query(collection(db, 'comercios'), where('id', '==', asig.comercioId)));
          if (!cSnap.empty) {
            comerciosMap[asig.comercioId] = cSnap.docs[0].data() as Comercio;
          }
        }
      }

      // Fetch codigos
      const qCodigos = query(collection(db, 'codigos_influencer'), where('influencerId', '==', userData.uid));
      const snapCodigos = await getDocs(qCodigos);
      const cods: CodigoInfluencer[] = [];
      snapCodigos.forEach(d => cods.push(d.data() as CodigoInfluencer));

      setAsignaciones(asigs);
      setComercios(comerciosMap);
      setCodigos(cods);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [userData]);

  const handleAceptarInvitacion = async (asig: AsignacionInfluencer) => {
    try {
      const comercioNombre = comercios[asig.comercioId]?.nombre || 'COMERCIO';
      const cleanComercioName = comercioNombre.replace(/\s+/g, '').toUpperCase().substring(0, 5);
      const codigoBase = `${userData?.prefijoCodigo || 'INF'}${cleanComercioName}`;
      
      const codigoId = window.prompt("Ingresa el código que deseas usar para esta campaña (Ej. NATGOLD):", codigoBase);
      if (!codigoId) return;

      // Check if code exists
      const checkSnap = await getDocs(query(collection(db, 'codigos_influencer'), where('id', '==', codigoId.toUpperCase())));
      if (!checkSnap.empty) {
        alert("Este código ya está en uso. Por favor, elige otro.");
        return;
      }

      // Create Codigo
      const nuevoCodigo: CodigoInfluencer = {
        id: codigoId.toUpperCase(),
        influencerId: userData!.uid,
        comercioId: asig.comercioId,
        puntosPorCanje: 10, // Un valor default, o se podría calcular basado en el comercio
        estado: 'ACTIVO',
        createdAt: Date.now(),
        fechaUltimaRenovacion: Date.now(),
      };

      await setDoc(doc(db, 'codigos_influencer', nuevoCodigo.id), nuevoCodigo);

      // Update Asignacion
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: 'ACEPTADO',
        updatedAt: Date.now()
      });

      alert("¡Invitación aceptada y código generado!");
      fetchData();
    } catch (err) {
      alert("Error al aceptar invitación");
    }
  };

  const handleRechazarInvitacion = async (asig: AsignacionInfluencer) => {
    if (!window.confirm("¿Seguro que deseas rechazar esta invitación?")) return;
    try {
      await updateDoc(doc(db, 'asignaciones_influencer', asig.id), {
        estado: 'RECHAZADO',
        updatedAt: Date.now()
      });
      fetchData();
    } catch (err) {
      alert("Error al rechazar invitación");
    }
  };

  const handleRenovarCampana = async (codigo: CodigoInfluencer) => {
    try {
      await updateDoc(doc(db, 'codigos_influencer', codigo.id), {
        fechaUltimaRenovacion: Date.now()
      });
      alert("¡Campaña renovada! Los clientes podrán usar este código nuevamente por los próximos 30 días.");
      fetchData();
    } catch (err) {
      alert("Error al renovar campaña");
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando panel de influencer...</div>;

  const invitacionesPendientes = asignaciones.filter(a => a.estado === 'PENDIENTE');
  const asignacionesActivas = asignaciones.filter(a => a.estado === 'ACEPTADO');

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Hola, {userData?.nombre}</h2>
          <p className="text-gray-500">Panel de Influencer • Prefijo de Código: <strong className="text-brand-primary">{userData?.prefijoCodigo || 'No asignado'}</strong></p>
        </div>
        <div className="bg-brand-primary/10 text-brand-primary font-bold px-4 py-2 rounded-lg">
          {codigos.filter(c => c.estado === 'ACTIVO').length} Campañas Activas
        </div>
      </div>

      {invitacionesPendientes.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="text-xl font-bold text-yellow-900 mb-4">Invitaciones Pendientes ({invitacionesPendientes.length})</h3>
          <div className="grid gap-4">
            {invitacionesPendientes.map(inv => {
              const c = comercios[inv.comercioId];
              return (
                <div key={inv.id} className="bg-white p-4 rounded-lg shadow-sm flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-gray-800">{c?.nombre || 'Comercio Desconocido'}</h4>
                    <p className="text-sm text-gray-600">Te ofrece una bolsa de <strong>{inv.puntosParaClientes} pts</strong> para tus seguidores.</p>
                    <p className="text-sm text-gray-500">Ratio de ganancia: {inv.ratio.influencer} pts por cada {inv.ratio.cliente} pts dados.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleRechazarInvitacion(inv)} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded">Rechazar</button>
                    <button onClick={() => handleAceptarInvitacion(inv)} className="px-4 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700">Aceptar y Crear Código</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-6">Mis Campañas y Códigos</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {asignacionesActivas.length === 0 ? (
            <p className="text-gray-500 col-span-2">No tienes campañas activas en este momento.</p>
          ) : (
            asignacionesActivas.map(asig => {
              const c = comercios[asig.comercioId];
              const codigo = codigos.find(cod => cod.comercioId === asig.comercioId);
              
              if (!codigo) return null;

              const msSinceRenovation = Date.now() - codigo.fechaUltimaRenovacion;
              const canRenew = msSinceRenovation >= THIRTY_DAYS_MS;
              const daysLeft = Math.ceil((THIRTY_DAYS_MS - msSinceRenovation) / (1000 * 60 * 60 * 24));

              return (
                <div key={asig.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 p-4 border-b">
                    <h4 className="font-bold text-gray-800 text-lg">{c?.nombre}</h4>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="text-center p-4 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300">
                      <p className="text-sm text-gray-500 mb-1">TU CÓDIGO ÚNICO</p>
                      <p className="text-2xl font-black text-brand-primary tracking-widest">{codigo.id}</p>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Bolsa restante:</span>
                      <span className="font-bold">{asig.puntosParaClientes} pts</span>
                    </div>

                    <div className="pt-4 border-t">
                      {canRenew ? (
                        <div className="space-y-2">
                          <p className="text-sm text-green-600 font-medium">Han pasado 30 días o el administrador ha forzado la habilitación. ¡Puedes renovar tu campaña!</p>
                          <button onClick={() => handleRenovarCampana(codigo)} className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white font-bold py-2 rounded-lg transition-colors">
                            Renovar Campaña
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 text-center">
                          <p className="text-sm text-gray-500">Campaña activa.</p>
                          <p className="text-xs text-orange-600 font-medium bg-orange-50 p-2 rounded">
                            Faltan {daysLeft} días para que puedas renovar y volver a repartir puntos a los mismos clientes.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
