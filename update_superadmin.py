import re

with open("src/pages/SuperAdminDashboard.tsx", "r") as f:
    content = f.read()

# Add qrcode.react import
if "qrcode.react" not in content:
    content = content.replace(
        "import { createUserWithEmailAndPassword } from 'firebase/auth';",
        "import { createUserWithEmailAndPassword } from 'firebase/auth';\nimport { QRCodeSVG } from 'qrcode.react';"
    )

# Add states for Global Users and Edit Comercio
if "const [globalUsers, setGlobalUsers]" not in content:
    content = content.replace(
        "const [searchTerm, setSearchTerm] = useState('');",
        "const [searchTerm, setSearchTerm] = useState('');\n  const [globalUsers, setGlobalUsers] = useState<Usuario[]>([]);\n  const [globalSearchTerm, setGlobalSearchTerm] = useState('');\n  const [editingComercio, setEditingComercio] = useState<Comercio | null>(null);\n  const [editComercioNombre, setEditComercioNombre] = useState('');\n  const [editComercioPlan, setEditComercioPlan] = useState<'regular'|'premium'>('regular');\n  const [editComercioNit, setEditComercioNit] = useState('');"
    )

# Add global users fetch
if "fetchGlobalUsers()" not in content:
    content = content.replace(
        "cargarComercios();\n  }, []);",
        "cargarComercios();\n    const fetchGlobalUsers = async () => {\n      try {\n        const snap = await getDocs(collection(db, 'users'));\n        const users: Usuario[] = [];\n        snap.forEach(d => users.push(d.data() as Usuario));\n        setGlobalUsers(users);\n      } catch (err) {}\n    };\n    fetchGlobalUsers();\n  }, []);"
    )

# Modify handleSimularQrGenerar
content = content.replace(
    "const comercioIdSim = comercios[0].id;",
    "const comercioIdSim = 'TEST_SIMULATOR';"
)
content = content.replace(
    "setMensaje({ texto: 'Código QR de prueba generado', tipo: 'success' });",
    "setMensaje({ texto: 'Código QR de prueba generado', tipo: 'success' });\n      setQrSimReadInput(codigo);"
)

# Modify handleSimularQrLeer
content = content.replace(
    "setMensaje({ texto: `Leído exitosamente! Tipo: ${data.tipo}, Estado: ${data.estado}`, tipo: 'success' });",
    "setMensaje({ texto: `Leído exitosamente! Tipo: ${data.tipo}, Estado: ${data.estado}`, tipo: 'success' });\n        // Auto-delete to invalidate\n        import('firebase/firestore').then(({deleteDoc}) => deleteDoc(doc(db, 'sesiones_qr', qrSimReadInput)));\n        setQrSimCodeResult('');\n        setQrSimReadInput('');"
)

# Toggle state handlers for user and commerce
toggle_handlers = """
  const handleToggleEstadoUsuario = async (usuario: Usuario) => {
    const nuevoEstado = usuario.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    if (!window.confirm(`¿Seguro que deseas ${nuevoEstado === 'bloqueado' ? 'BLOQUEAR' : 'ACTIVAR'} a ${usuario.nombre}?`)) return;
    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'users', usuario.uid), { estado: nuevoEstado });
      setGlobalUsers(globalUsers.map(u => u.uid === usuario.uid ? { ...u, estado: nuevoEstado } : u));
      setMensaje({ texto: `Usuario ${nuevoEstado}`, tipo: 'success' });
    } catch(e: any) { setMensaje({ texto: 'Error: ' + e.message, tipo: 'error' }); }
  };

  const handleToggleEstadoComercio = async (comercio: Comercio) => {
    const nuevoEstado = comercio.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    if (!window.confirm(`¿Seguro que deseas ${nuevoEstado === 'bloqueado' ? 'BLOQUEAR' : 'ACTIVAR'} el comercio ${comercio.nombre}?`)) return;
    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'comercios', comercio.id), { estado: nuevoEstado });
      cargarComercios();
      setMensaje({ texto: `Comercio ${nuevoEstado}`, tipo: 'success' });
    } catch(e: any) { setMensaje({ texto: 'Error: ' + e.message, tipo: 'error' }); }
  };

  const handleGuardarEdicionComercio = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!editingComercio) return;
    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'comercios', editingComercio.id), { nombre: editComercioNombre, nit_rut: editComercioNit, plan: editComercioPlan });
      setMensaje({ texto: `Comercio editado exitosamente`, tipo: 'success' });
      setEditingComercio(null);
      cargarComercios();
    } catch(e: any) { setMensaje({ texto: 'Error: ' + e.message, tipo: 'error' }); }
  };
"""
if "handleToggleEstadoUsuario" not in content:
    content = content.replace(
        "if (loading) return",
        toggle_handlers + "\n  if (loading) return"
    )

# Replace "Sesión" with "QR" in the texts
content = content.replace("ID Sesión QR:", "ID QR:")
content = content.replace("Generar Sesión en Firebase", "Generar QR en Firebase")
content = content.replace("Pega el ID de Sesión QR...", "Pega el ID del QR...")
content = content.replace("Consultar Estado de Sesión", "Consultar Estado de QR")

# Modify QR Simulator UI to include SVG
qr_ui = """
          <div className="space-y-4">
            <h4 className="font-bold text-sm text-[var(--text-muted)]">Generar QR de Prueba</h4>
            <select className="sa-input" value={qrSimTipo} onChange={e => setQrSimTipo(e.target.value as any)}>
              <option value="ACUMULACION">Acumulación (Vendedor)</option>
              <option value="CANJE">Canje (Cliente)</option>
            </select>
            {qrSimTipo === 'ACUMULACION' && (
              <input type="number" placeholder="Monto simulado (ej: 100)" className="sa-input" value={qrSimMonto} onChange={e => setQrSimMonto(e.target.value)} />
            )}
            <button onClick={handleSimularQrGenerar} className="sa-btn-primary">Generar QR en Firebase</button>
            {qrSimCodeResult && (
              <div className="mt-4 p-4 bg-white border rounded text-center flex flex-col items-center justify-center">
                <QRCodeSVG value={qrSimCodeResult} size={200} level="H" />
                <p className="mt-4 text-sm font-bold text-gray-500">ID QR:</p>
                <div className="text-xl font-mono select-all tracking-widest text-black">{qrSimCodeResult}</div>
                <p className="mt-2 text-xs text-red-500">Este QR no es válido para usuarios reales.</p>
              </div>
            )}
            {mensaje && mensaje.texto.includes('Leído exitosamente') && (
              <div className="mt-4 p-4 bg-green-100 text-green-800 rounded text-center font-bold">
                {mensaje.texto}
              </div>
            )}
          </div>
"""
# Regex replace QR Simulator UI
import re
content = re.sub(
    r'<div className="space-y-4">.*?<h4 className="font-bold text-sm text-\[var\(--text-muted\)\]">Generar QR de Prueba</h4>.*?</select>.*?\{qrSimCodeResult && \([^)]+\)\}.*?</div>',
    qr_ui.strip(),
    content,
    flags=re.DOTALL
)

# Replace existing comercios list with edit feature
comercios_list_ui = """
          <h4 className="mt-6 mb-2 font-bold text-[var(--text-muted)] text-sm uppercase">Comercios Existentes ({comercios.length})</h4>
          <ul className="space-y-4 max-h-96 overflow-y-auto pr-2">
            {comercios.map(c => (
              <li key={c.id} className="sa-card bg-gray-50 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded border bg-white flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center font-bold text-gray-400 text-sm flex-shrink-0">NB</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[var(--text-main)] text-lg">{c.nombre} {c.estado === 'bloqueado' && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded ml-2">BLOQUEADO</span>}</strong>
                    <span className="text-sm text-[var(--text-muted)] block truncate">NIT: {c.nit_rut} | Plan: <span className="font-bold text-brand-primary uppercase">{c.plan || 'regular'}</span></span>
                  </div>
                </div>
                
                {editingComercio?.id === c.id ? (
                  <form onSubmit={handleGuardarEdicionComercio} className="border-t pt-3 mt-2 space-y-3 bg-white p-3 rounded shadow-inner">
                    <h5 className="font-bold text-sm">Editar Comercio</h5>
                    <input className="sa-input" value={editComercioNombre} onChange={e=>setEditComercioNombre(e.target.value)} required placeholder="Nombre" />
                    <input className="sa-input" value={editComercioNit} onChange={e=>setEditComercioNit(e.target.value)} required placeholder="NIT/RUT" />
                    <select className="sa-input" value={editComercioPlan} onChange={e=>setEditComercioPlan(e.target.value as any)}>
                      <option value="regular">Regular</option>
                      <option value="premium">Premium</option>
                    </select>
                    <div className="flex gap-2">
                      <button type="submit" className="sa-btn-primary text-sm">Guardar</button>
                      <button type="button" onClick={() => setEditingComercio(null)} className="sa-btn-secondary text-sm">Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t pt-3 mt-2">
                    <button onClick={() => { setEditingComercio(c); setEditComercioNombre(c.nombre); setEditComercioNit(c.nit_rut); setEditComercioPlan(c.plan || 'regular'); }} className="text-xs bg-gray-200 text-gray-800 font-bold px-3 py-1.5 rounded hover:bg-gray-300 transition border">Editar</button>
                    <button onClick={() => handleToggleEstadoComercio(c)} className={`text-xs font-bold px-3 py-1.5 rounded transition border ${c.estado === 'bloqueado' ? 'bg-green-500 text-white hover:bg-green-600 border-green-700' : 'bg-orange-500 text-white hover:bg-orange-600 border-orange-700'}`}>
                      {c.estado === 'bloqueado' ? 'Desbloquear' : 'Bloquear'}
                    </button>
                    <button onClick={() => handleBorrarComercio(c)} className="text-xs bg-red-500 text-white font-bold px-3 py-1.5 rounded hover:bg-red-600 transition border border-red-700 ml-auto">Borrar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
"""

content = re.sub(
    r'<h4 className="mt-6 mb-2 font-bold text-\[var\(--text-muted\)\] text-sm uppercase">Comercios Existentes \(\{comercios.length\}\)</h4>.*?</ul>',
    comercios_list_ui.strip(),
    content,
    flags=re.DOTALL
)


# Add Global users ui
global_users_ui = """
      {/* 5. Listado Global de Usuarios */}
      <div className="sa-card">
        <h3 className="sa-subtitle">5. Listado Global de Usuarios (Clientes, Vendedores, Admins)</h3>
        <div className="mb-4">
          <input type="text" className="sa-input max-w-md" placeholder="Buscar por nombre, correo o teléfono..." value={globalSearchTerm} onChange={e => setGlobalSearchTerm(e.target.value)} />
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="sa-table">
            <thead className="sticky top-0 bg-[var(--bg-surface)]">
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>WhatsApp</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {globalUsers.filter(u => u.nombre.toLowerCase().includes(globalSearchTerm.toLowerCase()) || u.email.toLowerCase().includes(globalSearchTerm.toLowerCase()) || (u.telefono && u.telefono.includes(globalSearchTerm))).map(u => (
                  <tr key={u.uid} className={u.estado === 'bloqueado' ? 'opacity-60' : ''}>
                    <td className="font-medium">{u.nombre}</td>
                    <td>{u.email}</td>
                    <td>{u.telefono || '-'}</td>
                    <td><span className="sa-badge">{u.rol.replace('_', ' ')}</span></td>
                    <td>
                      {u.estado === 'bloqueado' ? (
                        <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded font-bold border border-red-200">BLOQUEADO</span>
                      ) : (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-bold border border-green-200">ACTIVO</span>
                      )}
                    </td>
                    <td className="flex gap-2">
                      <button onClick={() => handleToggleEstadoUsuario(u)} className={`text-xs font-bold px-3 py-1 rounded transition border ${u.estado === 'bloqueado' ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}`}>
                        {u.estado === 'bloqueado' ? 'Activar' : 'Bloquear'}
                      </button>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
"""

content = content.replace("    </div>\n  );\n};\n\nexport default SuperAdminDashboard;", global_users_ui + "\n    </div>\n  );\n};\n\nexport default SuperAdminDashboard;")

with open("src/pages/SuperAdminDashboard.tsx", "w") as f:
    f.write(content)

