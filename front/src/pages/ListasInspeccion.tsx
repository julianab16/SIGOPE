// Listas de inspección: una lista por tipo de equipo.
// Las secciones y sus ítems no se escriben: se eligen entre las opciones que guarda el backend
// (cada ítem pertenece a una sección). Si falta alguna opción, se puede agregar desde aquí.
import { useEffect, useMemo, useState } from "react";
import { Cargando, Drawer, Field, Icon, Status, Toast, btnGhost, btnPrimary, card, erroresDeFormulario, input, textoError, type Aviso } from "../components/ui";
import { api } from "../services/api";
import type { ItemBanco, ListaInspeccion, TipoEquipo } from "../types";

type Seccion = { titulo: string; ids: string[] }; // ids de los ítems elegidos, en orden

const contar = (l: ListaInspeccion) => l.secciones.reduce((n, s) => n + s.items.length, 0);
const seccionesDe = (l: ListaInspeccion): Seccion[] => l.secciones.map((s) => ({ titulo: s.titulo, ids: s.items.map((i) => i.id ?? "") }));
const idsDe = (secciones: Seccion[]) => secciones.flatMap((s) => s.ids);
const ordenar = (a: string, b: string) => a.localeCompare(b, "es");

export default function ListasInspeccion() {
  const [listas, setListas] = useState<ListaInspeccion[] | null>(null);
  const [tipos, setTipos] = useState<TipoEquipo[]>([]);
  const [opciones, setOpciones] = useState<ItemBanco[]>([]); // todos los ítems disponibles, con su sección
  const [selId, setSelId] = useState<string>();
  const [draft, setDraft] = useState<Seccion[]>([]);
  const [abierta, setAbierta] = useState(0);
  const [agregandoSeccion, setAgregandoSeccion] = useState(false);
  const [nueva, setNueva] = useState<{ tipo: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState(false); // confirmación para eliminar la lista
  const [aviso, setAviso] = useState<Aviso>(null);

  useEffect(() => {
    Promise.all([api.listas.listar(), api.tipos.listar(), api.banco.listar()]).then(([l, t, o]) => {
      setListas(l); setTipos(t); setOpciones(o);
      if (l[0]) { setSelId(l[0].id); setDraft(seccionesDe(l[0])); }
    }).catch((e) => setAviso({ texto: textoError(e), error: true }));
  }, []);

  // Datos de cada ítem por id: las opciones y, por si alguno se desactivó, los que ya están en las listas.
  const porId = useMemo(() => {
    const m = new Map(opciones.map((o) => [o.id, o]));
    for (const l of listas ?? []) for (const s of l.secciones) for (const i of s.items) if (i.id && !m.has(i.id)) m.set(i.id, { id: i.id, texto: i.texto, categoria: s.titulo, critico: !!i.critico });
    return m;
  }, [opciones, listas]);

  if (!listas) return aviso ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{aviso.texto}</p> : <Cargando />;

  const sel = listas.find((l) => l.id === selId);
  const sucio = !!sel && JSON.stringify(idsDe(draft)) !== JSON.stringify(idsDe(seccionesDe(sel)));
  const totalItems = idsDe(draft).length;
  const vacias = draft.filter((s) => s.ids.length === 0).length;
  const libres = tipos.filter((t) => t.activo && !listas.some((l) => l.tipo === t.nombre)).map((t) => t.nombre);
  const todasLasSecciones = [...new Set(opciones.map((o) => o.categoria))].sort(ordenar);
  const seccionesDisponibles = todasLasSecciones.filter((t) => !draft.some((s) => s.titulo === t));

  const elegirLista = (l: ListaInspeccion) => { setSelId(l.id); setDraft(seccionesDe(l)); setAbierta(0); setAgregandoSeccion(false); };
  const upd = (fn: (d: Seccion[]) => void) => setDraft((actual) => { const d = actual.map((s) => ({ ...s, ids: [...s.ids] })); fn(d); return d; });
  const alternar = (si: number, id: string) => upd((d) => { const s = d[si]; s.ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id]; });
  const mover = (si: number, ii: number, dir: -1 | 1) => upd((d) => { const a = d[si].ids; const j = ii + dir; if (j < 0 || j >= a.length) return; [a[ii], a[j]] = [a[j], a[ii]]; });
  const agregarSeccion = (titulo: string) => { upd((d) => { d.push({ titulo, ids: [] }); }); setAbierta(draft.length); setAgregandoSeccion(false); };

  const actualizar = async () => {
    if (!sel) return;
    setGuardando(true);
    try {
      const l = await api.listas.actualizar(sel.id, idsDe(draft)); // las secciones sin ítems elegidos no se guardan
      setListas(listas.map((x) => (x.id === l.id ? l : x))); setDraft(seccionesDe(l));
      setAviso({ texto: `${l.nombre ?? `Lista de ${l.tipo.toLowerCase()}`} actualizada (versión ${l.version})` });
    } catch (e) { setAviso({ texto: textoError(e), error: true }); }
    finally { setGuardando(false); }
  };
  const eliminar = async () => {
    if (!sel) return;
    setGuardando(true);
    try {
      await api.listas.eliminar(sel.id);
      const restantes = listas.filter((x) => x.id !== sel.id);
      setListas(restantes);
      if (restantes[0]) elegirLista(restantes[0]); else { setSelId(undefined); setDraft([]); }
      setAviso({ texto: `${sel.nombre ?? `Lista de ${sel.tipo.toLowerCase()}`} eliminada` });
    } catch (e) { setAviso({ texto: textoError(e), error: true }); }
    finally { setGuardando(false); setBorrar(false); }
  };
  const crear = async () => {
    if (!nueva?.tipo) return;
    try { const l = await api.listas.crear(nueva.tipo); setListas([...listas, l]); elegirLista(l); setAgregandoSeccion(true); setNueva(null); setAviso({ texto: "Lista creada. Agrega sus secciones." }); }
    catch (e) { setAviso({ texto: textoError(e), error: true }); }
  };

  return <>
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-black sm:text-2xl">Listas de inspección</h2><p className="mt-1 text-sm text-slate-500">Cada tipo de equipo tiene una lista. El operario la responde al hacer el check-in.</p></div><button onClick={() => setNueva({ tipo: libres[0] ?? "" })} className={btnPrimary}><Icon name="plus" size={19} />Nueva lista</button></div>
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <aside className="-mx-4 flex min-w-0 gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:space-y-3 lg:overflow-visible lg:px-0 lg:pb-0">{listas.map((l) => <button key={l.id} onClick={() => elegirLista(l)} className={`w-64 shrink-0 rounded-2xl border bg-white p-4 text-left lg:w-full ${selId === l.id ? "border-[#F5B800] ring-2 ring-[#F5B800]/20" : "border-slate-200"}`}>
        <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#F5B800]/15 text-[#8A6500]"><Icon name="equipment" size={19} /></span><div className="min-w-0"><p className="font-black">{l.tipo}</p><p className="mt-0.5 text-xs font-semibold text-slate-400">{l.secciones.length} secciones · {contar(l)} ítems</p></div></div>
      </button>)}</aside>

      {!sel ? <article className={`${card} grid min-h-60 place-items-center p-8 text-center text-sm font-semibold text-slate-400`}>Aún no hay listas. Crea la primera con "Nueva lista".</article> :
      <article className={`${card} min-w-0 overflow-hidden`}>
        <div className="border-b border-slate-200 p-4 sm:p-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-black sm:text-2xl">{sel.nombre ?? `Lista de ${sel.tipo.toLowerCase()}`}</h3>
              <p className="mt-1 text-sm font-bold text-slate-500">{draft.length} secciones · {totalItems} ítems · versión {sel.version}</p>
            </div>
            <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none"><button onClick={() => setBorrar(true)} title="Eliminar lista" aria-label="Eliminar lista" className="grid h-12 shrink-0 place-items-center rounded-xl border-2 border-red-100 px-3 text-red-600 hover:bg-red-50 sm:!flex-none"><Icon name="trash" size={19} /></button><button disabled={!sucio && !vacias} onClick={() => elegirLista(sel)} className={btnGhost}>Descartar</button><button disabled={!sucio || guardando} onClick={actualizar} className={btnPrimary}><Icon name="check" size={19} />{guardando ? "Guardando..." : "Actualizar lista"}</button></div>
          </div>
          {sucio && <div className="mt-4 flex gap-3 rounded-xl bg-blue-50 p-4 text-sm font-semibold text-blue-800"><Icon name="info" className="mt-0.5 shrink-0" /><p>Tienes cambios sin guardar. Al actualizar, las inspecciones que ya se hicieron conservan la lista anterior.</p></div>}
          {vacias > 0 && <div className="mt-3 flex gap-3 rounded-xl bg-orange-50 p-4 text-sm font-semibold text-orange-900"><Icon name="warning" className="mt-0.5 shrink-0" /><p>{vacias === 1 ? "Hay una sección" : `Hay ${vacias} secciones`} sin ítems elegidos. Ábrela y marca los ítems que se revisan; si no, no se guardará.</p></div>}
        </div>

        <div className="space-y-3 bg-slate-50/60 p-3 sm:p-5">
          {draft.map((s, si) => <SeccionLista key={`${s.titulo}-${si}`} seccion={s} abierta={abierta === si} onAbrir={() => setAbierta(abierta === si ? -1 : si)}
            opciones={opciones.filter((o) => o.categoria === s.titulo && !draft.some((otra, oi) => oi !== si && otra.ids.includes(o.id)))}
            porId={porId} onAlternar={(id) => alternar(si, id)} onMover={(ii, dir) => mover(si, ii, dir)}
            onTodos={(ids) => upd((d) => { d[si].ids = ids; })}
            onQuitar={() => { upd((d) => { d.splice(si, 1); }); setAbierta(-1); }}
            onNuevaOpcion={(o) => { setOpciones((x) => [...x, o]); upd((d) => { d[si].ids.push(o.id); }); }} />)}

          {agregandoSeccion
            ? <AgregarSeccion disponibles={seccionesDisponibles} cuantas={(t) => opciones.filter((o) => o.categoria === t).length} existentes={todasLasSecciones} enLista={draft.map((s) => s.titulo)} onElegir={agregarSeccion} onCancelar={() => setAgregandoSeccion(false)} />
            : <button onClick={() => setAgregandoSeccion(true)} className="h-12 w-full rounded-xl border-2 border-dashed border-slate-300 bg-white text-sm font-black text-slate-500">+ Agregar sección</button>}
        </div>
      </article>}
    </div>

    {nueva && <Drawer title="Nueva lista de inspección" subtitle="Cada tipo de equipo tiene una sola lista." onClose={() => setNueva(null)} footer={<><button className={`${btnGhost} flex-1`} onClick={() => setNueva(null)}>Cancelar</button><button disabled={!nueva.tipo} className={`${btnPrimary} flex-1`} onClick={crear}>Crear lista</button></>}>
      {libres.length === 0 ? <div className="flex gap-3 rounded-xl bg-orange-50 p-4 text-sm font-semibold text-orange-900"><Icon name="info" className="mt-0.5 shrink-0" /><p>Todos los tipos de equipo ya tienen lista. Para crear otra, primero agrega un tipo nuevo en <strong>Equipos y tipos</strong>.</p></div> : <>
        <Field label="Tipo de equipo *"><select className={`${input} w-full border-slate-200`} value={nueva.tipo} onChange={(e) => setNueva({ tipo: e.target.value })}>{libres.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <p className="text-sm font-semibold text-slate-500">Todos los equipos de este tipo usarán esta lista en su inspección diaria. Después eliges sus secciones e ítems.</p>
      </>}
    </Drawer>}
    {borrar && sel && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40"><div role="dialog" aria-modal="true" className="w-[calc(100%-2rem)] max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl">
      <span className="grid size-12 place-items-center rounded-xl bg-red-50 text-red-600"><Icon name="trash" /></span>
      <h2 className="mt-4 text-xl font-black">Eliminar lista</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">Se eliminará <strong className="text-slate-800">{sel.nombre ?? `Lista de ${sel.tipo.toLowerCase()}`}</strong>. Esta acción no se puede deshacer. Si la lista ya tiene inspecciones hechas, no se podrá eliminar.</p>
      <div className="mt-6 flex gap-3"><button disabled={guardando} className={`${btnGhost} flex-1`} onClick={() => setBorrar(false)}>Cancelar</button><button disabled={guardando} className="h-12 flex-1 rounded-xl bg-red-600 px-5 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50" onClick={eliminar}>{guardando ? "Eliminando…" : "Eliminar"}</button></div>
    </div></div>}
    {aviso && <Toast text={aviso.texto} error={aviso.error} onClose={() => setAviso(null)} />}
  </>;
}

/** Una sección de la lista. Abierta, muestra todos los ítems de esa sección: marcados (los que lleva la lista) y sin marcar. */
function SeccionLista({ seccion, abierta, onAbrir, opciones, porId, onAlternar, onMover, onTodos, onQuitar, onNuevaOpcion }: {
  seccion: Seccion; abierta: boolean; onAbrir: () => void; opciones: ItemBanco[]; porId: Map<string, ItemBanco>;
  onAlternar: (id: string) => void; onMover: (ii: number, dir: -1 | 1) => void; onTodos: (ids: string[]) => void; onQuitar: () => void; onNuevaOpcion: (o: ItemBanco) => void;
}) {
  const sinElegir = opciones.filter((o) => !seccion.ids.includes(o.id)).sort((a, b) => ordenar(a.texto, b.texto));
  // Marcar todos: los ya marcados conservan su orden y los demás se agregan al final.
  const marcarTodos = () => onTodos(sinElegir.length ? [...seccion.ids, ...sinElegir.map((o) => o.id)] : []);
  const total = seccion.ids.length + sinElegir.length;
  const casilla = (on: boolean) => <span className={`grid size-6 shrink-0 place-items-center rounded-md border-2 ${on ? "border-[#F5B800] bg-[#F5B800] text-[#2B2B2B]" : "border-slate-300 bg-white"}`}>{on && <Icon name="check" size={14} />}</span>;

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex min-h-[64px] items-center gap-2 px-3 sm:gap-3 sm:px-4">
      <button aria-label={abierta ? "Cerrar sección" : "Abrir sección"} onClick={onAbrir} className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#F5B800]/15 text-[#8A6500]"><Icon name={abierta ? "up" : "down"} size={19} /></button>
      <button onClick={onAbrir} className="min-w-0 flex-1 px-2 py-1 text-left text-base font-black">{seccion.titulo}</button>
      <span className={`text-xs font-bold ${seccion.ids.length ? "text-slate-400" : "text-orange-600"}`}>{seccion.ids.length} de {total} ítems</span>
      <button onClick={onQuitar} title="Quitar sección de la lista" className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Icon name="trash" size={18} /></button>
    </div>
    {abierta && <div className="border-t border-slate-100">
      <div className="flex items-center gap-3 bg-slate-50 px-3 py-2 sm:px-4">
        <p className="min-w-0 flex-1 text-xs font-semibold text-slate-500">Marca los ítems que se revisan en este tipo de equipo. Los marcados se pueden ordenar con las flechas.</p>
        {total > 0 && <button role="checkbox" aria-checked={!sinElegir.length} onClick={marcarTodos} className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-xs font-black text-[#8A6500] hover:bg-[#F5B800]/15">{casilla(!sinElegir.length)}{sinElegir.length ? "Marcar todos" : "Quitar todos"}</button>}
      </div>
      {seccion.ids.map((id, ii) => { const o = porId.get(id); return <div key={id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 sm:gap-3 sm:px-4">
        <div className="flex flex-col"><button aria-label="Subir" disabled={ii === 0} onClick={() => onMover(ii, -1)} className="text-slate-400 disabled:text-slate-200"><Icon name="up" size={16} /></button><button aria-label="Bajar" disabled={ii === seccion.ids.length - 1} onClick={() => onMover(ii, 1)} className="text-slate-400 disabled:text-slate-200"><Icon name="down" size={16} /></button></div>
        <span className="w-5 shrink-0 text-center text-xs font-black text-slate-400">{ii + 1}</span>
        <button role="checkbox" aria-checked onClick={() => onAlternar(id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">{casilla(true)}<span className="min-w-0 flex-1 text-sm font-bold">{o?.texto ?? id}</span></button>
        {o?.critico && <Status type="danger">Crítico</Status>}
      </div>; })}
      {sinElegir.map((o) => <div key={o.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 sm:gap-3 sm:px-4">
        <span className="w-[18px] shrink-0" /><span className="w-5 shrink-0" />
        <button role="checkbox" aria-checked={false} onClick={() => onAlternar(o.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">{casilla(false)}<span className="min-w-0 flex-1 text-sm font-semibold text-slate-500">{o.texto}</span></button>
        {o.critico && <Status type="danger">Crítico</Status>}
      </div>)}
      <NuevaOpcion seccion={seccion.titulo} onCreada={onNuevaOpcion} />
    </div>}
  </section>;
}

/** Agrega a una sección un ítem que no existe; queda disponible para todas las listas. */
function NuevaOpcion({ seccion, onCreada }: { seccion: string; onCreada: (o: ItemBanco) => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [critico, setCritico] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  if (texto === null) return <button onClick={() => setTexto("")} className="m-4 h-11 w-[calc(100%-2rem)] rounded-xl border border-dashed border-slate-300 text-sm font-bold text-slate-500">+ Agregar un ítem que no está en {seccion}</button>;
  const guardar = async () => {
    if (!texto.trim()) return setError("Escribe qué se revisa.");
    setGuardando(true);
    try { onCreada(await api.banco.crear({ texto, categoria: seccion, critico })); setTexto(null); setCritico(false); setError(""); }
    catch (e) { const { campos, resto } = erroresDeFormulario(e, ["texto"]); setError(campos.texto ?? resto ?? ""); }
    finally { setGuardando(false); }
  };
  return <div className="m-4 space-y-3 rounded-xl border-2 border-dashed border-slate-300 p-3">
    <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && guardar()} className={`${input} min-h-11 w-full ${error ? "border-red-500" : "border-slate-200"}`} placeholder={`Nuevo ítem de ${seccion}`} />
    {error && <p className="text-sm font-bold text-red-600">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button role="checkbox" aria-checked={critico} onClick={() => setCritico(!critico)} className={`h-10 rounded-lg px-3 text-xs font-black ${critico ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>{critico ? "Crítico" : "Marcar como crítico"}</button>
      <span className="flex-1" />
      <button onClick={() => { setTexto(null); setError(""); }} className="h-10 rounded-lg px-3 text-sm font-bold text-slate-500 hover:bg-slate-100">Cancelar</button>
      <button disabled={guardando} onClick={guardar} className="h-10 rounded-lg bg-[#F5B800] px-4 text-sm font-black text-[#2B2B2B] disabled:opacity-50">{guardando ? "Agregando..." : "Agregar"}</button>
    </div>
  </div>;
}

/** Opciones de secciones para agregar a la lista, o una sección nueva. */
function AgregarSeccion({ disponibles, cuantas, existentes, enLista, onElegir, onCancelar }: { disponibles: string[]; cuantas: (t: string) => number; existentes: string[]; enLista: string[]; onElegir: (t: string) => void; onCancelar: () => void }) {
  const [nueva, setNueva] = useState("");
  const [error, setError] = useState("");
  const crear = () => {
    const t = nueva.trim();
    if (!t) return setError("Escribe el nombre de la sección.");
    if (enLista.some((x) => x.toLowerCase() === t.toLowerCase())) return setError("Esa sección ya está en la lista.");
    onElegir(existentes.find((x) => x.toLowerCase() === t.toLowerCase()) ?? t);
  };
  return <div className="rounded-2xl border-2 border-dashed border-[#F5B800] bg-white p-4">
    <div className="flex items-center justify-between"><p className="text-sm font-black">Elige la sección que quieres agregar</p><button aria-label="Cancelar" onClick={onCancelar} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><Icon name="x" size={18} /></button></div>
    {disponibles.length === 0 ? <p className="mt-3 text-sm font-semibold text-slate-500">La lista ya tiene todas las secciones disponibles.</p> :
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{disponibles.map((t) => <button key={t} onClick={() => onElegir(t)} className="flex min-h-12 items-center justify-between gap-2 rounded-xl border-2 border-slate-200 px-3 text-left text-sm font-black hover:border-[#F5B800] hover:bg-[#F5B800]/10"><span>{t}</span><span className="text-xs font-bold text-slate-400">{cuantas(t)} ítems</span></button>)}</div>}
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="text-xs font-bold text-slate-500">¿No está la sección? Créala y luego agrégale sus ítems.</p>
      <div className="mt-2 flex gap-2"><input value={nueva} onChange={(e) => { setNueva(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && crear()} className={`${input} min-h-11 min-w-0 flex-1 ${error ? "border-red-500" : "border-slate-200"}`} placeholder="Nombre de la nueva sección" /><button onClick={crear} className="h-11 shrink-0 rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700 hover:bg-slate-200">Crear</button></div>
      {error && <p className="mt-2 text-sm font-bold text-red-600">{error}</p>}
    </div>
  </div>;
}
