import { useEffect, useMemo, useState } from "react";
import CargaEvidencias from "../components/CargaEvidencias";
import { Cargando, Field, Icon, Status, btnGhost, btnPrimary, card, input, textoError } from "../components/ui";
import { api } from "../services/api";
import type { CheckIn, Equipo, ListaOperativa, ResultadoInspeccion } from "../types";

type Respuesta = "complies" | "does_not_comply" | "not_applicable";
const RESPUESTAS: { valor: Respuesta; etiqueta: string }[] = [
  { valor: "complies", etiqueta: "Cumple" },
  { valor: "does_not_comply", etiqueta: "No cumple" },
  { valor: "not_applicable", etiqueta: "No aplica" },
];

const fecha = (valor: string) => new Date(valor).toLocaleString("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function OperacionOperario({ puedeReportar = false }: { puedeReportar?: boolean }) {
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const [checkins, setCheckins] = useState<CheckIn[] | null>(null);
  const [seleccionado, setSeleccionado] = useState("");
  const [tipo, setTipo] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [horometroInicial, setHorometroInicial] = useState("");
  const [checkinActivo, setCheckinActivo] = useState<CheckIn | null>(null);
  const [lista, setLista] = useState<ListaOperativa | null>(null);
  const [inspeccion, setInspeccion] = useState<ResultadoInspeccion | null>(null);
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [observaciones, setObservaciones] = useState<Record<string, string>>({});
  const [observacionGeneral, setObservacionGeneral] = useState("");
  const [horometroFinal, setHorometroFinal] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const recargar = async () => {
    const [disponibles, activos] = await Promise.all([
      api.operacion.equiposDisponibles(),
      api.operacion.checkins(),
    ]);
    setEquipos(disponibles);
    setCheckins(activos);
  };

  useEffect(() => {
    recargar().catch((e) => setError(textoError(e))).finally(() => setCargando(false));
  }, []);

  const tipos = useMemo(() => [...new Set((equipos ?? []).map((e) => e.tipo))].sort(), [equipos]);
  const visibles = (equipos ?? []).filter((e) =>
    (tipo === "Todos" || e.tipo === tipo)
    && `${e.codigo} ${e.placa} ${e.marca}`.toLowerCase().includes(busqueda.toLowerCase()),
  );
  const abiertos = (checkins ?? []).filter((c) => !c.finalizadoEn);

  const abrirCheckin = async (checkin: CheckIn) => {
    setCheckinActivo(checkin);
    setLista(null);
    setInspeccion(null);
    setRespuestas({});
    setObservaciones({});
    setObservacionGeneral("");
    setHorometroFinal("");
    setError("");
    setAviso("");
    setCargandoLista(true);
    try {
      const [listaEquipo, inspeccionExistente] = await Promise.all([
        api.operacion.listaParaEquipo(checkin.codigoEquipo),
        api.operacion.inspeccionParaCheckin(checkin),
      ]);
      setLista(listaEquipo);
      setInspeccion(inspeccionExistente);
    } catch (e) {
      setError(textoError(e));
    } finally {
      setCargandoLista(false);
    }
  };

  const iniciar = async () => {
    const equipo = equipos?.find((e) => e.codigo === seleccionado);
    const lectura = Number(horometroInicial);
    if (!equipo) return setError("Selecciona un equipo disponible.");
    if (!horometroInicial || !Number.isFinite(lectura) || lectura < 0) return setError("Ingresa una lectura inicial válida.");
    setGuardando(true);
    setError("");
    try {
      const nuevo = await api.operacion.iniciarCheckin(equipo.codigo, lectura);
      setCheckins((actuales) => [...(actuales ?? []), nuevo]);
      setSeleccionado("");
      setHorometroInicial("");
      await recargar();
      await abrirCheckin(nuevo);
      setAviso("Check-in iniciado. Completa la inspección antes de operar.");
    } catch (e) {
      setError(textoError(e));
    } finally {
      setGuardando(false);
    }
  };

  const guardarInspeccion = async () => {
    if (!checkinActivo || !lista) return;
    const items = lista.secciones.flatMap((s) => s.items);
    if (items.some((item) => !respuestas[item.id])) return setError("Responde todos los ítems antes de enviar la inspección.");
    setGuardando(true);
    setError("");
    try {
      const resultado = await api.operacion.registrarInspeccion({
        equipo: checkinActivo.codigoEquipo,
        lista: lista.id,
        checkin: checkinActivo.id,
        observacionGeneral,
        respuestas: items.map((item) => ({
          item: item.id,
          resultado: respuestas[item.id],
          observacion: observaciones[item.id] ?? "",
        })),
      });
      setInspeccion(resultado);
      setAviso("Inspección registrada.");
    } catch (e) {
      setError(textoError(e));
    } finally {
      setGuardando(false);
    }
  };

  const cerrarCheckin = async () => {
    if (!checkinActivo) return;
    const lectura = Number(horometroFinal);
    if (!horometroFinal || !Number.isFinite(lectura) || lectura < Number(checkinActivo.horometroInicial)) {
      return setError("La lectura final debe ser igual o mayor que la lectura inicial.");
    }
    setGuardando(true);
    setError("");
    try {
      const cerrado = await api.operacion.cerrarCheckin(checkinActivo.id, lectura);
      setCheckins((actuales) => (actuales ?? []).map((c) => c.id === cerrado.id ? cerrado : c));
      setCheckinActivo(null);
      setLista(null);
      setInspeccion(null);
      await recargar();
      setAviso("Uso del equipo finalizado.");
    } catch (e) {
      setError(textoError(e));
    } finally {
      setGuardando(false);
    }
  };

  const reportar = (tipo: "novedad" | "incidente") => {
    if (!checkinActivo) return;
    location.hash = `reportes-operario?equipo=${encodeURIComponent(checkinActivo.codigoEquipo)}&tipo=${tipo}`;
  };

  if (cargando) return <Cargando />;

  return <>
    <div className="mb-6">
      <p className="text-xs font-black uppercase tracking-wider text-[#8A6500]">Operación</p>
      <h2 className="mt-1 text-xl font-black sm:text-2xl">Equipos e inspección</h2>
      <p className="mt-1 text-sm text-slate-500">Selecciona un equipo disponible, registra su uso y completa la inspección.</p>
    </div>

    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
    {aviso && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{aviso}</p>}

    <section className={`${card} p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h3 className="text-lg font-black">Equipos disponibles</h3><p className="mt-1 text-sm text-slate-500">Los equipos con un check-in abierto no se pueden volver a seleccionar.</p></div>
        <button className={btnGhost} onClick={() => { setCargando(true); recargar().catch((e) => setError(textoError(e))).finally(() => setCargando(false)); }}><Icon name="search" size={18} />Actualizar lista</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="relative"><Icon name="search" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} w-full pl-11`} placeholder="Buscar por código, placa o modelo" /></label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${input} w-full border-slate-200`}><option>Todos</option>{tipos.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibles.map((e) => <button key={e.id} onClick={() => setSeleccionado(e.codigo)} className={`rounded-xl border-2 p-4 text-left transition ${seleccionado === e.codigo ? "border-[#F5B800] bg-[#F5B800]/10" : "border-slate-200 hover:border-slate-300"}`}>
          <div className="flex items-start justify-between gap-2"><span className="font-black">{e.codigo}</span><Status type="ok">Disponible</Status></div>
          <p className="mt-2 text-sm font-semibold text-slate-600">{e.tipo} · {e.marca}</p>
          {e.placa && <p className="mt-1 text-xs text-slate-500">Placa {e.placa}</p>}
          {e.horometro && <p className="mt-1 text-xs text-slate-500">Última lectura: {e.horometro} h</p>}
        </button>)}
      </div>
      {visibles.length === 0 && <p className="py-8 text-center text-sm font-semibold text-slate-400">No hay equipos disponibles que coincidan con la búsqueda.</p>}
      {seleccionado && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Horómetro inicial *"><input type="number" min="0" step="0.01" value={horometroInicial} onChange={(e) => setHorometroInicial(e.target.value)} className={`${input} w-full border-slate-200`} placeholder="Lectura actual" /></Field>
        <button disabled={guardando} onClick={iniciar} className={btnPrimary}><Icon name="check" size={18} />{guardando ? "Iniciando..." : "Iniciar check-in"}</button>
      </div>}
    </section>

    {abiertos.length > 0 && <section className="mt-6">
      <h3 className="mb-3 text-lg font-black">Usos en curso</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {abiertos.map((c) => <article key={c.id} className={`${card} flex items-center justify-between gap-3 p-4`}>
          <div><p className="font-black">{c.codigoEquipo}</p><p className="mt-1 text-sm text-slate-500">Inicio {fecha(c.iniciadoEn)} · Horómetro {c.horometroInicial} h</p></div>
          <button onClick={() => void abrirCheckin(c)} className={`${btnGhost} h-10 px-3 text-xs`}>Continuar</button>
        </article>)}
      </div>
    </section>}

    {checkinActivo && <section className={`${card} mt-6 overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div><p className="text-xs font-black uppercase tracking-wider text-[#8A6500]">Check-in abierto</p><h3 className="mt-1 text-lg font-black">{checkinActivo.codigoEquipo}</h3><p className="mt-1 text-sm text-slate-500">Inicio {fecha(checkinActivo.iniciadoEn)} · Horómetro inicial {checkinActivo.horometroInicial} h</p></div>
        <button onClick={() => { setCheckinActivo(null); setLista(null); setInspeccion(null); }} className={`${btnGhost} h-10`}><Icon name="x" size={17} />Cerrar vista</button>
      </div>
      {cargandoLista ? <Cargando /> : !lista ? <p className="p-5 text-sm font-semibold text-slate-600">No fue posible cargar una lista vigente para este equipo.</p> : <>
        <div className="p-4 sm:p-5">
          <h4 className="text-lg font-black">{lista.nombre}</h4>
          <p className="mt-1 text-sm font-semibold text-slate-500">Versión {lista.version} · {lista.secciones.reduce((n, s) => n + s.items.length, 0)} ítems</p>
          {inspeccion ? <div className={`mt-4 rounded-xl p-4 ${inspeccion.esCritica ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
            <p className="font-black">{inspeccion.esCritica ? "Inspección con falla crítica" : "Inspección registrada"}</p>
            <p className="mt-1 text-sm">Resultado: {inspeccion.esCritica ? "Con falla crítica" : "Completada"}</p>
            <CargaEvidencias key={`inspection-${inspeccion.id}`} tipo="inspection" idRegistro={inspeccion.id} />
          </div> : <div className="mt-4 space-y-4">
            {lista.secciones.map((seccion, si) => <article key={`${seccion.titulo}-${si}`} className="overflow-hidden rounded-xl border border-slate-200">
              <h5 className="bg-slate-50 px-4 py-3 font-black">{seccion.titulo}</h5>
              <div className="divide-y divide-slate-100">{seccion.items.map((item) => <div key={item.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-bold">{item.texto}</p>{item.critico && <Status type="danger">Crítico</Status>}</div>
                <div className="mt-3 grid grid-cols-3 gap-2">{RESPUESTAS.map((r) => <button key={r.valor} aria-pressed={respuestas[item.id] === r.valor} onClick={() => setRespuestas({ ...respuestas, [item.id]: r.valor })} className={`min-h-10 rounded-lg border px-2 text-xs font-black sm:text-sm ${respuestas[item.id] === r.valor ? r.valor === "does_not_comply" ? "border-red-500 bg-red-50 text-red-700" : "border-[#F5B800] bg-[#F5B800]/15 text-[#684C00]" : "border-slate-200 text-slate-500"}`}>{r.etiqueta}</button>)}</div>
                <input value={observaciones[item.id] ?? ""} onChange={(e) => setObservaciones({ ...observaciones, [item.id]: e.target.value })} className={`${input} mt-3 w-full border-slate-200`} placeholder="Observación para este ítem (opcional)" />
              </div>)}</div>
            </article>)}
            <Field label="Observación general (opcional)"><textarea value={observacionGeneral} onChange={(e) => setObservacionGeneral(e.target.value)} className={`${input} min-h-24 w-full resize-y border-slate-200 py-3`} /></Field>
            <button disabled={guardando} onClick={guardarInspeccion} className={`${btnPrimary} w-full sm:w-auto`}><Icon name="check" size={18} />{guardando ? "Enviando..." : "Enviar inspección"}</button>
          </div>}
          {puedeReportar && <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row">
            <button onClick={() => reportar("novedad")} className={btnGhost}>Registrar novedad de este equipo</button>
            <button onClick={() => reportar("incidente")} className={btnGhost}>Registrar incidente de este equipo</button>
          </div>}
        </div>
      </>}
      <div className="border-t border-slate-200 bg-slate-50 p-4 sm:p-5">
        <h4 className="font-black">Finalizar uso del equipo</h4>
        <p className="mt-1 text-sm text-slate-500">Registra la lectura del horómetro al terminar la operación.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Horómetro final *"><input type="number" min={Number(checkinActivo.horometroInicial)} step="0.01" value={horometroFinal} onChange={(e) => setHorometroFinal(e.target.value)} className={`${input} w-full border-slate-200`} placeholder="Lectura final" /></Field>
          <button disabled={guardando} onClick={cerrarCheckin} className={`${btnGhost} border-red-200 text-red-700`}>{guardando ? "Guardando..." : "Finalizar uso"}</button>
        </div>
      </div>
    </section>}
  </>;
}
