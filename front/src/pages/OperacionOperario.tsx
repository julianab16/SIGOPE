// Operación del operario, pensada para usarse fácil desde el celular:
//   1. Elige el vehículo (primero ve los disponibles y el que ya tiene en uso).
//   2. Panel del vehículo: datos, horómetro inicial y final juntos.
//      "Revisar vehículo" registra el uso y abre la inspección.
//   3. Inspección: Cumple / No cumple / No aplica. "No cumple" pide describir qué pasó.
//      "Finalizar inspección" la guarda en el servidor SIN enviarla.
//   4. Al terminar la jornada, en el panel del vehículo escribe el horómetro final y, si
//      quiere, la observación final (general_notes); "Enviar inspección" cierra el uso y la envía.
import { useEffect, useMemo, useState } from "react";
import CargaEvidencias from "../components/CargaEvidencias";
import { Cargando, Icon, Status, btnGhost, btnPrimary, card, input, textoError } from "../components/ui";
import { api } from "../services/api";
import type { CheckIn, Equipo, ListaOperativa } from "../types";

type Respuesta = "complies" | "does_not_comply" | "not_applicable";
const RESPUESTAS: { valor: Respuesta; etiqueta: string; activo: string }[] = [
  { valor: "complies", etiqueta: "Cumple", activo: "border-emerald-600 bg-emerald-600 text-white" },
  { valor: "does_not_comply", etiqueta: "No cumple", activo: "border-red-600 bg-red-600 text-white" },
  { valor: "not_applicable", etiqueta: "No aplica", activo: "border-slate-500 bg-slate-500 text-white" },
];

type Borrador = { respuestas: Record<string, Respuesta>; notas: Record<string, string> };
const borradorVacio = (): Borrador => ({ respuestas: {}, notas: {} });

const hora = (valor: string) => new Date(valor).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
const lectura = (texto: string) => (texto.trim() === "" ? NaN : Number(texto.replace(",", ".")));
const horas = (valor: string) => String(Number(valor)); // "1690.00" → "1690"

export default function OperacionOperario({ puedeReportar = false }: { puedeReportar?: boolean }) {
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const [usos, setUsos] = useState<CheckIn[]>([]);
  const [vista, setVista] = useState<"equipos" | "vehiculo" | "inspeccion" | "enviada">("equipos");
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [uso, setUso] = useState<CheckIn | null>(null); // uso abierto del vehículo elegido
  const [lista, setLista] = useState<ListaOperativa | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [inicial, setInicial] = useState("");
  const [final, setFinal] = useState("");
  const [observacion, setObservacion] = useState(""); // observación final: se escribe en el panel y se envía con el horómetro final
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const recargar = async () => {
    const [disponibles, todos] = await Promise.all([api.operacion.equiposDisponibles(), api.operacion.checkins()]);
    setEquipos(disponibles);
    setUsos(todos.filter((c) => !c.finalizadoEn));
  };
  useEffect(() => { recargar().catch((e) => setError(textoError(e))).finally(() => setCargando(false)); }, []);

  const volverAEquipos = async () => {
    setVista("equipos"); setEquipo(null); setUso(null); setLista(null); setError(""); setInicial(""); setFinal(""); setObservacion("");
    window.scrollTo({ top: 0 });
    await recargar().catch((e) => setError(textoError(e)));
  };
  const abrirVehiculo = async (e: Equipo | null, abierto: CheckIn | null) => {
    setError(""); setFinal(""); setObservacion(""); setLista(null); setBorrador(borradorVacio());
    setUso(abierto); setInicial(abierto ? horas(abierto.horometroInicial) : "");
    setVista("vehiculo"); window.scrollTo({ top: 0 });
    if (e) setEquipo(e);
    else if (abierto) { setEquipo(null); setEquipo(await api.operacion.equipo(abierto.codigoEquipo).catch(() => null)); }
  };

  // Paso 2 → 3: registra el uso (con el horómetro inicial) y abre la lista de inspección.
  const iniciarInspeccion = async () => {
    const codigo = uso?.codigoEquipo ?? equipo?.codigo;
    if (!codigo) return;
    setError(""); setGuardando(true);
    try {
      let actual = uso;
      if (!actual) {
        const valor = lectura(inicial);
        if (!Number.isFinite(valor) || valor < 0) { setError("Escribe el horómetro inicial: el número que marca el vehículo ahora."); return; }
        actual = await api.operacion.iniciarCheckin(codigo, valor);
        setUso(actual);
      }
      setLista(await api.operacion.listaParaEquipo(codigo));
      setVista("inspeccion"); window.scrollTo({ top: 0 });
    } catch (e) { setError(textoError(e)); }
    finally { setGuardando(false); }
  };

  // Paso 3 → 2: guarda la inspección en el servidor como pendiente de envío.
  const finalizarInspeccion = async () => {
    if (!uso || !lista) return;
    const items = lista.secciones.flatMap((s) => s.items);
    const sinResponder = items.find((i) => !borrador.respuestas[i.id]);
    const sinDescripcion = items.find((i) => borrador.respuestas[i.id] === "does_not_comply" && !borrador.notas[i.id]?.trim());
    const pendiente = sinResponder ?? sinDescripcion;
    if (pendiente) {
      setError(sinResponder ? `Falta responder: "${sinResponder.texto}".` : `Describe qué pasó con "${sinDescripcion!.texto}".`);
      document.getElementById(`item-${pendiente.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setError(""); setGuardando(true);
    try {
      const resultado = await api.operacion.registrarInspeccion({
        equipo: uso.codigoEquipo, lista: lista.id, checkin: uso.id, pendiente: true,
        observacionGeneral: "", // la observación final se escribe en el panel del vehículo al enviar
        respuestas: items.map((i) => ({ item: i.id, resultado: borrador.respuestas[i.id], observacion: borrador.respuestas[i.id] === "does_not_comply" ? borrador.notas[i.id].trim() : "" })),
      });
      setUso({ ...uso, inspeccion: { ...resultado, pendiente: true } });
      setVista("vehiculo"); window.scrollTo({ top: 0 });
    } catch (e) { setError(textoError(e)); }
    finally { setGuardando(false); }
  };

  // Paso 4: horómetro final + envío.
  const enviar = async () => {
    if (!uso) return;
    const valor = lectura(final);
    if (!Number.isFinite(valor)) return setError("Escribe el horómetro final: el número que marca el vehículo al terminar.");
    if (valor < Number(uso.horometroInicial)) return setError(`El horómetro final no puede ser menor que el inicial (${horas(uso.horometroInicial)}).`);
    setError(""); setGuardando(true);
    try { await api.operacion.cerrarCheckin(uso.id, valor, observacion.trim()); setVista("enviada"); window.scrollTo({ top: 0 }); }
    catch (e) { setError(textoError(e)); }
    finally { setGuardando(false); }
  };

  if (cargando) return <Cargando />;
  const aviso = error && <p role="alert" className="mb-4 flex gap-3 rounded-xl bg-red-50 p-4 text-base font-bold text-red-700"><Icon name="warning" className="mt-0.5 shrink-0" />{error}</p>;

  if (vista === "enviada") return <div className="mx-auto max-w-xl">
    <section className={`${card} p-6 text-center sm:p-10`}>
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" size={32} /></span>
      <h2 className="mt-4 text-2xl font-black">Inspección enviada</h2>
      <p className="mt-2 text-base text-slate-600">Se registró el horómetro final de {uso?.codigoEquipo} y se envió la inspección. ¡Gracias!</p>
      <button onClick={volverAEquipos} className={`${btnPrimary} mt-6 h-14 w-full text-base`}>Volver a los vehículos</button>
    </section>
  </div>;

  if (vista === "inspeccion" && lista && uso) return <Inspeccion lista={lista} codigo={uso.codigoEquipo} borrador={borrador} setBorrador={setBorrador} guardando={guardando} aviso={aviso}
    onVolver={() => { setError(""); setVista("vehiculo"); window.scrollTo({ top: 0 }); }} onFinalizar={finalizarInspeccion} />;

  if (vista === "vehiculo") {
    const codigo = uso?.codigoEquipo ?? equipo?.codigo ?? "";
    const insp = uso?.inspeccion ?? null;
    return <div className="mx-auto max-w-3xl">
      <button onClick={volverAEquipos} className="mb-4 flex min-h-12 items-center gap-2 rounded-xl px-2 text-base font-black text-[#8A6500] hover:bg-[#F5B800]/10"><span className="rotate-180"><Icon name="arrow" size={20} /></span>Volver a los vehículos</button>
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-start gap-4 border-b border-slate-200 p-5 sm:p-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#F5B800]/20 text-[#8A6500]"><Icon name="equipment" size={28} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-black">{codigo}</h2>
            <p className="mt-1 text-base font-bold text-slate-600">{equipo ? `${equipo.tipo} · ${equipo.marca}` : "Cargando datos…"}</p>
            {equipo && <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-slate-500">{equipo.placa && <span>Placa {equipo.placa}</span>}{equipo.anio && <span>Año {equipo.anio}</span>}{equipo.serie && <span>Serie {equipo.serie}</span>}</div>}
          </div>
          {uso ? <Status type="warn">En uso</Status> : <Status type="ok">Disponible</Status>}
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <Horometro titulo="Horómetro inicial" ayuda={uso ? `Registrado ${hora(uso.iniciadoEn)}` : equipo?.horometro ? `Última lectura conocida: ${equipo.horometro} h` : "El número que marca el vehículo ahora"}
            valor={inicial} onCambio={setInicial} bloqueado={!!uso} />
          <Horometro titulo="Horómetro final" ayuda={insp ? "Escríbelo al terminar la jornada" : "Se llena al terminar la jornada, después de la inspección"}
            valor={final} onCambio={setFinal} bloqueado={!insp} />
        </div>

        <div className="border-t border-slate-200 bg-slate-50 p-5 sm:p-6">
          {!insp ? <>
            {aviso}
            <button disabled={guardando} onClick={iniciarInspeccion} className={`${btnPrimary} h-16 w-full text-lg`}><Icon name="clipboard" size={22} />{guardando ? "Abriendo…" : "Revisar vehículo · Iniciar inspección"}</button>
          </> : <>
            <div className={`rounded-xl p-4 ${insp.esCritica ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
              <p className="flex items-center gap-2 text-lg font-black"><Icon name={insp.esCritica ? "warning" : "check"} />Inspección terminada</p>
              <p className="mt-1 text-base font-semibold">{insp.esCritica ? "Hay ítems críticos que NO cumplen. No operes el vehículo y avisa al jefe de taller." : "Está guardada. Se enviará cuando escribas el horómetro final."}</p>
              {insp.esCritica && <p className="mt-1 text-sm font-semibold">La inspección quedará guardada y se enviará con el horómetro final.</p>}
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm font-black">Fotos o documentos (opcional)</p><CargaEvidencias key={`inspection-${insp.id}`} tipo="inspection" idRegistro={insp.id} /></div>
            <label className="mt-4 block rounded-xl border border-slate-200 bg-white p-4">
              <span className="block text-base font-black">Observación final <span className="font-semibold text-slate-400">(opcional)</span></span>
              <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} className={`${input} mt-2 min-h-24 w-full resize-y border-slate-200 py-3 text-base`} placeholder="Ej. No se usó el vehículo por las fallas encontradas; el horómetro final es igual al inicial" />
            </label>
            {aviso}
            <button disabled={guardando || !final.trim()} onClick={enviar} className={`${btnPrimary} mt-4 h-16 w-full text-lg`}><Icon name="arrow" size={22} />{guardando ? "Enviando…" : "Enviar inspección"}</button>
            {!final.trim() && <p className="mt-2 text-center text-sm font-semibold text-slate-500">Escribe el horómetro final para poder enviar.</p>}
          </>}
          {puedeReportar && uso && <div className="mt-5 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
            <button onClick={() => { location.hash = `reportes-operario?equipo=${encodeURIComponent(uso.codigoEquipo)}&tipo=novedad`; }} className={btnGhost}>Reportar una novedad</button>
            <button onClick={() => { location.hash = `reportes-operario?equipo=${encodeURIComponent(uso.codigoEquipo)}&tipo=incidente`; }} className={btnGhost}>Reportar un incidente</button>
          </div>}
        </div>
      </section>
    </div>;
  }

  return <ElegirVehiculo equipos={equipos ?? []} usos={usos} aviso={aviso} onElegir={(e) => void abrirVehiculo(e, null)} onContinuar={(c) => void abrirVehiculo(null, c)} />;
}

function Horometro({ titulo, ayuda, valor, onCambio, bloqueado }: { titulo: string; ayuda: string; valor: string; onCambio: (v: string) => void; bloqueado: boolean }) {
  return <label className={`block rounded-2xl border-2 p-4 ${bloqueado ? "border-slate-200 bg-slate-50" : "border-[#F5B800] bg-white"}`}>
    <span className="block text-base font-black">{titulo}</span>
    <span className="mt-2 flex items-center gap-2"><input type="text" inputMode="decimal" disabled={bloqueado} value={valor} onChange={(e) => onCambio(e.target.value.replace(/[^\d.,]/g, ""))} placeholder={bloqueado ? "—" : "0"} className={`${input} min-h-14 w-full border-slate-200 text-2xl disabled:bg-slate-100 disabled:text-slate-500`} /><span className="text-lg font-black text-slate-400">h</span></span>
    <span className="mt-2 block text-sm font-semibold text-slate-500">{ayuda}</span>
  </label>;
}

function ElegirVehiculo({ equipos, usos, aviso, onElegir, onContinuar }: { equipos: Equipo[]; usos: CheckIn[]; aviso: React.ReactNode; onElegir: (e: Equipo) => void; onContinuar: (c: CheckIn) => void }) {
  const [tipo, setTipo] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const tipos = useMemo(() => [...new Set(equipos.map((e) => e.tipo))].sort(), [equipos]);
  const visibles = equipos.filter((e) => (tipo === "Todos" || e.tipo === tipo) && `${e.codigo} ${e.placa} ${e.marca}`.toLowerCase().includes(busqueda.toLowerCase()));

  return <>
    {aviso}
    {usos.length > 0 && <section className="mb-8">
      <h2 className="text-2xl font-black">Vehículo en uso</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{usos.map((c) => <button key={c.id} onClick={() => onContinuar(c)} className="flex items-center justify-between gap-2 rounded-2xl border-2 border-[#F5B800] bg-[#F5B800]/10 p-5 text-left">
        <span className="text-2xl font-black">{c.codigoEquipo}</span><Icon name="arrow" size={22} />
      </button>)}</div>
    </section>}

    <h2 className="text-2xl font-black">Elige el vehículo</h2>
    <p className="mt-1 text-base text-slate-500">Toca el vehículo que vas a revisar.</p>
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{["Todos", ...tipos].map((t) => <button key={t} onClick={() => setTipo(t)} className={`h-11 shrink-0 rounded-full border-2 px-4 text-sm font-black ${tipo === t ? "border-[#2B2B2B] bg-[#2B2B2B] text-white" : "border-slate-200 bg-white text-slate-600"}`}>{t}</button>)}</div>
    {equipos.length > 6 && <label className="relative mt-3 block"><Icon name="search" size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} min-h-14 w-full border-slate-200 pl-12 text-base`} placeholder="Buscar por código o placa" /></label>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibles.map((e) => <button key={e.id} onClick={() => onElegir(e)} className={`${card} flex items-center gap-4 p-5 text-left transition hover:border-[#F5B800] hover:shadow-md`}>
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#F5B800]/15 text-[#8A6500]"><Icon name="equipment" size={24} /></span>
      <span className="min-w-0 flex-1"><span className="block text-xl font-black">{e.codigo}</span><span className="mt-0.5 block truncate text-base font-semibold text-slate-600">{e.tipo} · {e.marca}</span>{e.placa && <span className="block text-sm text-slate-500">Placa {e.placa}</span>}</span>
      <Icon name="arrow" size={20} className="shrink-0 text-slate-400" />
    </button>)}</div>
    {visibles.length === 0 && <p className="rounded-2xl bg-white p-10 text-center text-base font-semibold text-slate-400">No hay vehículos disponibles{tipo !== "Todos" || busqueda ? " con ese filtro" : " en este momento"}.</p>}
  </>;
}

function Inspeccion({ lista, codigo, borrador, setBorrador, guardando, aviso, onVolver, onFinalizar }: {
  lista: ListaOperativa; codigo: string; borrador: Borrador; setBorrador: (b: Borrador) => void; guardando: boolean; aviso: React.ReactNode; onVolver: () => void; onFinalizar: () => void;
}) {
  const items = lista.secciones.flatMap((s) => s.items);
  const respondidos = items.filter((i) => borrador.respuestas[i.id]).length;
  const responder = (id: string, r: Respuesta) => setBorrador({ ...borrador, respuestas: { ...borrador.respuestas, [id]: r } });

  return <div className="mx-auto max-w-3xl">
    <button onClick={onVolver} className="mb-4 flex min-h-12 items-center gap-2 rounded-xl px-2 text-base font-black text-[#8A6500] hover:bg-[#F5B800]/10"><span className="rotate-180"><Icon name="arrow" size={20} /></span>Volver al vehículo</button>
    <div className="sticky top-[72px] z-10 -mx-4 mb-4 border-b border-slate-200 bg-[#F5F6F7]/95 px-4 py-3 backdrop-blur sm:top-[84px] sm:mx-0 sm:rounded-2xl sm:border sm:bg-white sm:px-5">
      <p className="text-sm font-black uppercase tracking-wider text-[#8A6500]">Inspección de {codigo}</p>
      <div className="mt-2 flex items-center gap-3"><div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#F5B800] transition-all" style={{ width: `${items.length ? (respondidos / items.length) * 100 : 0}%` }} /></div><span className="shrink-0 text-base font-black">{respondidos} de {items.length}</span></div>
    </div>
    {items.length === 0 && <p className={`${card} p-6 text-base font-semibold text-slate-500`}>La lista de este vehículo no tiene ítems. Avisa al administrador.</p>}
    <div className="space-y-5">{lista.secciones.map((s, si) => <section key={`${s.titulo}-${si}`} className={`${card} overflow-hidden`}>
      <h3 className="bg-slate-50 px-5 py-4 text-xl font-black">{s.titulo}</h3>
      <div className="divide-y divide-slate-100">{s.items.map((item) => { const r = borrador.respuestas[item.id]; const nota = borrador.notas[item.id] ?? ""; return <div key={item.id} id={`item-${item.id}`} className="p-5">
        <div className="flex flex-wrap items-start gap-2"><p className="flex-1 text-lg font-bold">{item.texto}</p>{item.critico && <Status type="danger">Crítico</Status>}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">{RESPUESTAS.map((op) => <button key={op.valor} aria-pressed={r === op.valor} onClick={() => responder(item.id, op.valor)} className={`min-h-14 rounded-xl border-2 px-1 text-sm font-black sm:text-base ${r === op.valor ? op.activo : "border-slate-200 bg-white text-slate-600"}`}>{op.etiqueta}</button>)}</div>
        {r === "does_not_comply" && <div className="mt-3">
          {item.critico && <p className="mb-2 flex gap-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700"><Icon name="warning" size={18} className="shrink-0" />Ítem crítico: no operes el vehículo y avisa al jefe de taller.</p>}
          <label className="block text-base font-black text-red-700">¿Qué pasó? Describe el problema *</label>
          <textarea value={nota} onChange={(e) => setBorrador({ ...borrador, notas: { ...borrador.notas, [item.id]: e.target.value } })} className={`${input} mt-2 min-h-24 w-full resize-y py-3 text-base ${nota.trim() ? "border-slate-200" : "border-red-300"}`} placeholder="Ej. La llanta delantera derecha está desinflada" />
        </div>}
      </div>; })}</div>
    </section>)}</div>

    <div className="mt-5">{aviso}</div>
    <button disabled={guardando} onClick={onFinalizar} className={`${btnPrimary} h-16 w-full text-lg`}><Icon name="check" size={22} />{guardando ? "Guardando…" : "Finalizar inspección"}</button>
    <p className="mt-2 text-center text-sm font-semibold text-slate-500">Todavía no se envía: se guarda y la envías al final de la jornada con el horómetro final.</p>
  </div>;
}
