import { useEffect, useState } from "react";
import CargaEvidencias from "../components/CargaEvidencias";
import { Cargando, Field, Icon, Tabs, btnPrimary, card, input, textoError } from "../components/ui";
import { api } from "../services/api";
import type { Equipo, RegistroOperativo, SeveridadIncidente, TipoNovedad, TipoRegistroOperativo } from "../types";

const TIPOS_NOVEDAD: { valor: TipoNovedad; etiqueta: string }[] = [
  { valor: "mechanical_failure", etiqueta: "Falla mecánica" },
  { valor: "unsafe_condition", etiqueta: "Condición insegura" },
  { valor: "damage", etiqueta: "Daño" },
  { valor: "environmental", etiqueta: "Observación ambiental" },
];
const SEVERIDADES: { valor: SeveridadIncidente; etiqueta: string }[] = [
  { valor: "leve", etiqueta: "Leve" },
  { valor: "media", etiqueta: "Moderado" },
  { valor: "grave", etiqueta: "Grave" },
];

function ahoraLocal() {
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  return ahora.toISOString().slice(0, 16);
}

export default function ReportesOperario() {
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const [pestana, setPestana] = useState(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("tipo") === "incidente" ? "Incidente" : "Novedad");
  const [equipo, setEquipo] = useState(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("equipo") ?? "");
  const [tipo, setTipo] = useState<TipoNovedad>("mechanical_failure");
  const [descripcion, setDescripcion] = useState("");
  const [observacion, setObservacion] = useState("");
  const [ocurridoEn, setOcurridoEn] = useState(ahoraLocal);
  const [severidad, setSeveridad] = useState<SeveridadIncidente>("leve");
  const [registro, setRegistro] = useState<{ tipo: TipoRegistroOperativo; datos: RegistroOperativo } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.equipos.listar().then(setEquipos).catch((e) => setError(textoError(e)));
  }, []);

  const nuevaCaptura = () => {
    setRegistro(null);
    setEquipo("");
    setDescripcion("");
    setObservacion("");
    setOcurridoEn(ahoraLocal());
    setSeveridad("leve");
    setTipo("mechanical_failure");
    setError("");
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipo) return setError("Selecciona el equipo relacionado.");
    if (!descripcion.trim()) return setError("Escribe la descripción del reporte.");
    setGuardando(true);
    setError("");
    try {
      if (pestana === "Novedad") {
        const resultado = await api.operacion.registrarNovedad({
          equipo,
          tipo,
          descripcion: descripcion.trim(),
          observacion: observacion.trim(),
        });
        setRegistro({ tipo: "news", datos: resultado });
      } else {
        if (!ocurridoEn) return setError("Indica la fecha y hora del incidente.");
        const resultado = await api.operacion.registrarIncidente({
          equipo,
          ocurridoEn,
          descripcion: descripcion.trim(),
          severidad,
        });
        setRegistro({ tipo: "incident", datos: resultado });
      }
    } catch (err) {
      setError(textoError(err));
    } finally {
      setGuardando(false);
    }
  };

  if (!equipos) return error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : <Cargando />;

  return <>
    <div className="mb-6">
      <p className="text-xs font-black uppercase tracking-wider text-[#8A6500]">Operación</p>
      <h2 className="mt-1 text-xl font-black sm:text-2xl">Novedades e incidentes</h2>
      <p className="mt-1 text-sm text-slate-500">Reporta fallas o incidentes para que queden registrados y puedan recibir seguimiento.</p>
    </div>

    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
    {registro ? <article className={`${card} p-5 sm:p-6`}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Icon name="check" /></span>
        <div className="min-w-0 flex-1"><h3 className="text-lg font-black">{registro.tipo === "news" ? "Novedad registrada" : "Incidente registrado"}</h3><p className="mt-1 text-sm text-slate-500">Estado: Reportado · Registro #{registro.datos.id}</p></div>
        <button onClick={nuevaCaptura} className="text-sm font-black text-[#8A6500]">Nuevo reporte</button>
      </div>
      <CargaEvidencias key={`${registro.tipo}-${registro.datos.id}`} tipo={registro.tipo} idRegistro={registro.datos.id} />
    </article> : <article className={`${card} overflow-hidden`}>
      <div className="border-b border-slate-200 p-4 sm:p-5"><Tabs tabs={["Novedad", "Incidente"]} value={pestana} onChange={(v) => { setPestana(v); setError(""); }} /></div>
      <form onSubmit={guardar} className="space-y-5 p-4 sm:p-6">
        <Field label="Equipo *"><select value={equipo} onChange={(e) => setEquipo(e.target.value)} className={`${input} w-full border-slate-200`}><option value="">Selecciona un equipo</option>{equipos.map((x) => <option key={x.id} value={x.codigo}>{x.codigo} · {x.tipo} · {x.estado}</option>)}</select></Field>
        {pestana === "Novedad" ? <Field label="Tipo de novedad *"><select value={tipo} onChange={(e) => setTipo(e.target.value as TipoNovedad)} className={`${input} w-full border-slate-200`}>{TIPOS_NOVEDAD.map((x) => <option key={x.valor} value={x.valor}>{x.etiqueta}</option>)}</select></Field> : <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha y hora del incidente *"><input type="datetime-local" value={ocurridoEn} onChange={(e) => setOcurridoEn(e.target.value)} className={`${input} w-full border-slate-200`} /></Field>
            <Field label="Severidad *"><select value={severidad} onChange={(e) => setSeveridad(e.target.value as SeveridadIncidente)} className={`${input} w-full border-slate-200`}>{SEVERIDADES.map((x) => <option key={x.valor} value={x.valor}>{x.etiqueta}</option>)}</select></Field>
          </div>
          <p className="text-xs font-semibold text-slate-500">La fecha y hora del reporte se registran automáticamente.</p>
        </>}
        <Field label="Descripción *"><textarea required maxLength={5000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={`${input} min-h-32 w-full resize-y border-slate-200 py-3`} placeholder={pestana === "Novedad" ? "Describe la falla o anomalía observada" : "Describe lo ocurrido"} /></Field>
        {pestana === "Novedad" && <Field label="Observación (opcional)"><textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} className={`${input} min-h-24 w-full resize-y border-slate-200 py-3`} /></Field>}
        <button type="submit" disabled={guardando} className={`${btnPrimary} w-full sm:w-auto`}><Icon name="check" size={18} />{guardando ? "Enviando..." : `Registrar ${pestana.toLowerCase()}`}</button>
      </form>
    </article>}
  </>;
}
