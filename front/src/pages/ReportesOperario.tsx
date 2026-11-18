import { useEffect, useRef, useState } from "react";
import CargaEvidencias from "../components/CargaEvidencias";
import { Cargando, Field, Icon, Tabs, btnPrimary, card, erroresDeFormulario, input, textoError } from "../components/ui";
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
  const [erroresCampos, setErroresCampos] = useState<Record<string, string>>({});
  const referenciasCampos = useRef<Record<string, HTMLElement | null>>({});
  const [evidenceKey, setEvidenceKey] = useState(0);

  useEffect(() => {
    api.equipos.listar().then(setEquipos).catch((e) => setError(textoError(e)));
  }, []);

  const enfocarCampo = (campo: string) => {
    window.requestAnimationFrame(() => {
      const elemento = referenciasCampos.current[campo];
      elemento?.focus();
      elemento?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const cambiarCampo = (campo: string, actualizar: () => void) => {
    actualizar();
    setErroresCampos((actuales) => {
      const restantes = { ...actuales };
      delete restantes[campo];
      return restantes;
    });
    setError("");
  };

  const nuevaCaptura = () => {
    setRegistro(null);
    setEvidenceKey((actual) => actual + 1);
    setEquipo("");
    setDescripcion("");
    setObservacion("");
    setOcurridoEn(ahoraLocal());
    setSeveridad("leve");
    setTipo("mechanical_failure");
    setError("");
    setErroresCampos({});
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const erroresLocales: Record<string, string> = {};
    if (!equipo) erroresLocales.equipo = "Selecciona el equipo relacionado.";
    if (!descripcion.trim()) erroresLocales.descripcion = "Escribe la descripción del reporte.";
    if (pestana === "Incidente" && !ocurridoEn) erroresLocales.ocurridoEn = "Indica la fecha y hora del incidente.";
    if (Object.keys(erroresLocales).length) {
      setErroresCampos(erroresLocales);
      setError("Revisa los campos indicados.");
      enfocarCampo(Object.keys(erroresLocales)[0]);
      return;
    }

    setGuardando(true);
    setError("");
    setErroresCampos({});
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
        const resultado = await api.operacion.registrarIncidente({
          equipo,
          ocurridoEn,
          descripcion: descripcion.trim(),
          severidad,
        });
        setRegistro({ tipo: "incident", datos: resultado });
      }
    } catch (err) {
      const { campos, resto } = erroresDeFormulario(
        err,
        ["equipo", "tipo", "descripcion", "observacion", "ocurridoEn", "severidad"],
      );
      setErroresCampos(campos);
      const ordenCampos = ["equipo", pestana === "Incidente" ? "ocurridoEn" : "tipo", "descripcion", "severidad", "observacion"];
      const primero = ordenCampos.find((campo) => campos[campo]);
      setError(primero ? resto ?? "Corrige el campo indicado e inténtalo de nuevo." : resto ?? textoError(err));
      if (primero) enfocarCampo(primero);
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
    <article className={`${card} overflow-hidden`}>
      {!registro && <div className="border-b border-slate-200 p-4 sm:p-5"><Tabs tabs={["Novedad", "Incidente"]} value={pestana} onChange={(v) => { setPestana(v); setError(""); setErroresCampos({}); }} /></div>}
      {registro && <div role="status" className="m-4 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-800 sm:m-5">
        <Icon name="check" />
        <div><p className="font-black">{registro.tipo === "news" ? "Novedad registrada correctamente" : "Incidente registrado correctamente"}</p><p className="mt-1 text-sm">Estado: Reportado · Registro #{registro.datos.id}</p></div>
      </div>}
      <form onSubmit={guardar} className="space-y-5 p-4 sm:p-6">
        {!registro && <>
          <Field label="Equipo *" error={erroresCampos.equipo}><select ref={(el) => { referenciasCampos.current.equipo = el; }} id="reporte-equipo" required aria-invalid={Boolean(erroresCampos.equipo)} value={equipo} onChange={(e) => cambiarCampo("equipo", () => setEquipo(e.target.value))} className={`${input} w-full ${erroresCampos.equipo ? "border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-200"}`}><option value="">Selecciona un equipo</option>{equipos.map((x) => <option key={x.id} value={x.codigo}>{x.codigo} · {x.tipo} · {x.estado}</option>)}</select></Field>
          {pestana === "Novedad" ? <Field label="Tipo de novedad *" error={erroresCampos.tipo}><select ref={(el) => { referenciasCampos.current.tipo = el; }} id="reporte-tipo" required aria-invalid={Boolean(erroresCampos.tipo)} value={tipo} onChange={(e) => cambiarCampo("tipo", () => setTipo(e.target.value as TipoNovedad))} className={`${input} w-full ${erroresCampos.tipo ? "border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-200"}`}>{TIPOS_NOVEDAD.map((x) => <option key={x.valor} value={x.valor}>{x.etiqueta}</option>)}</select></Field> : <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fecha y hora del incidente *" error={erroresCampos.ocurridoEn}><input ref={(el) => { referenciasCampos.current.ocurridoEn = el; }} id="reporte-ocurrido-en" required aria-invalid={Boolean(erroresCampos.ocurridoEn)} type="datetime-local" value={ocurridoEn} onChange={(e) => cambiarCampo("ocurridoEn", () => setOcurridoEn(e.target.value))} className={`${input} w-full ${erroresCampos.ocurridoEn ? "border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-200"}`} /></Field>
              <Field label="Severidad *" error={erroresCampos.severidad}><select ref={(el) => { referenciasCampos.current.severidad = el; }} id="reporte-severidad" required aria-invalid={Boolean(erroresCampos.severidad)} value={severidad} onChange={(e) => cambiarCampo("severidad", () => setSeveridad(e.target.value as SeveridadIncidente))} className={`${input} w-full ${erroresCampos.severidad ? "border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-200"}`}>{SEVERIDADES.map((x) => <option key={x.valor} value={x.valor}>{x.etiqueta}</option>)}</select></Field>
            </div>
            <p className="text-xs font-semibold text-slate-500">La fecha y hora del reporte se registran automáticamente.</p>
          </>}
          <Field label="Descripción *" error={erroresCampos.descripcion}><textarea ref={(el) => { referenciasCampos.current.descripcion = el; }} id="reporte-descripcion" required aria-invalid={Boolean(erroresCampos.descripcion)} maxLength={5000} value={descripcion} onChange={(e) => cambiarCampo("descripcion", () => setDescripcion(e.target.value))} className={`${input} min-h-32 w-full resize-y py-3 ${erroresCampos.descripcion ? "border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-200"}`} placeholder={pestana === "Novedad" ? "Describe la falla o anomalía observada" : "Describe lo ocurrido"} /></Field>
          {pestana === "Novedad" && <Field label="Observación (opcional)" error={erroresCampos.observacion}><textarea ref={(el) => { referenciasCampos.current.observacion = el; }} id="reporte-observacion" aria-invalid={Boolean(erroresCampos.observacion)} value={observacion} onChange={(e) => cambiarCampo("observacion", () => setObservacion(e.target.value))} className={`${input} min-h-24 w-full resize-y py-3 ${erroresCampos.observacion ? "border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-200"}`} /></Field>}
        </>}
        <CargaEvidencias
          key={evidenceKey}
          tipo={registro?.tipo ?? (pestana === "Novedad" ? "news" : "incident")}
          idRegistro={registro?.datos.id}
          automatico
        />
        {registro
          ? <button type="button" onClick={nuevaCaptura} className="flex h-12 items-center justify-center rounded-xl border-2 border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-700">Nuevo reporte</button>
          : <button type="submit" disabled={guardando} className={`${btnPrimary} w-full sm:w-auto`}><Icon name="check" size={18} />{guardando ? "Enviando..." : `Registrar ${pestana.toLowerCase()}`}</button>}
      </form>
    </article>
  </>;
}
