import { useState } from "react";
import { api } from "../services/api";
import type { EvidenciaAdjunta, TipoRegistroOperativo } from "../types";
import { btnPrimary, Icon, textoError } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVOS = 5;

function extension(nombre: string) {
  return nombre.toLowerCase().split(".").pop() ?? "";
}

function esImagen(archivo: File) {
  return archivo.type.startsWith("image/") || ["jpg", "jpeg", "png"].includes(extension(archivo.name));
}

function formatoPermitido(archivo: File) {
  return ["jpg", "jpeg", "png", "pdf"].includes(extension(archivo.name));
}

function blobCanvas(canvas: HTMLCanvasElement, calidad: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", calidad));
}

async function comprimirImagen(archivo: File) {
  if (archivo.size <= MAX_BYTES) return archivo;
  if (!esImagen(archivo)) throw new Error("Los archivos PDF no pueden superar 5 MB.");

  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error(`No se pudo comprimir ${archivo.name}.`);
  }
  try {
    let escala = Math.min(1, 2000 / Math.max(imagen.width, imagen.height));
    for (let intento = 0; intento < 6; intento++, escala *= 0.75) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(imagen.width * escala));
      canvas.height = Math.max(1, Math.round(imagen.height * escala));
      const contexto = canvas.getContext("2d");
      if (!contexto) throw new Error(`No se pudo comprimir ${archivo.name}.`);
      contexto.fillStyle = "#fff";
      contexto.fillRect(0, 0, canvas.width, canvas.height);
      contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);
      for (let calidad = 0.88; calidad >= 0.4; calidad -= 0.12) {
        const blob = await blobCanvas(canvas, calidad);
        if (blob && blob.size <= MAX_BYTES) {
          const nombre = archivo.name.replace(/\.[^.]+$/, "") || "evidencia";
          return new File([blob], `${nombre}.jpg`, { type: "image/jpeg", lastModified: archivo.lastModified });
        }
      }
    }
    throw new Error(`${archivo.name} sigue superando 5 MB después de comprimirlo.`);
  } finally {
    imagen.close();
  }
}

export default function CargaEvidencias({ tipo, idRegistro }: { tipo: TipoRegistroOperativo; idRegistro: number }) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [subidos, setSubidos] = useState<EvidenciaAdjunta[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");

  const seleccionar = async (seleccionados: FileList | null) => {
    if (!seleccionados?.length) return;
    setError("");
    const nuevos = Array.from(seleccionados);
    if (archivos.length + subidos.length + nuevos.length > MAX_ARCHIVOS) {
      setError("Puedes adjuntar hasta 5 archivos por registro.");
      return;
    }
    const procesados: File[] = [];
    try {
      for (const archivo of nuevos) {
        if (!formatoPermitido(archivo)) throw new Error("Solo se permiten archivos JPG, PNG o PDF.");
        procesados.push(await comprimirImagen(archivo));
      }
      setArchivos((actuales) => [...actuales, ...procesados]);
    } catch (e) {
      setError(textoError(e));
    }
  };

  const subir = async () => {
    setSubiendo(true);
    setError("");
    try {
      for (const archivo of archivos) {
        const evidencia = await api.operacion.subirEvidencia(tipo, idRegistro, archivo);
        setSubidos((actuales) => [...actuales, evidencia]);
        setArchivos((actuales) => actuales.filter((x) => x !== archivo));
      }
    } catch (e) {
      setError(textoError(e));
    } finally {
      setSubiendo(false);
    }
  };

  return <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
    <h3 className="font-black">Evidencias</h3>
    <p className="mt-1 text-sm text-slate-500">Hasta 5 archivos JPG, PNG o PDF, máximo 5 MB cada uno.</p>
    <label className="mt-4 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 text-sm font-bold text-slate-600 hover:border-[#F5B800]">
      <Icon name="plus" size={18} />Seleccionar archivos
      <input className="sr-only" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" multiple onChange={(e) => { void seleccionar(e.target.files); e.currentTarget.value = ""; }} />
    </label>
    {archivos.length > 0 && <ul className="mt-3 space-y-2">{archivos.map((f) => <li key={`${f.name}-${f.lastModified}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"><span className="min-w-0 truncate font-semibold">{f.name}</span><button aria-label={`Quitar ${f.name}`} onClick={() => setArchivos(archivos.filter((x) => x !== f))} className="text-slate-400 hover:text-red-600"><Icon name="x" size={17} /></button></li>)}</ul>}
    {archivos.length > 0 && <button disabled={subiendo} onClick={subir} className={`${btnPrimary} mt-3 w-full`}>{subiendo ? "Subiendo..." : "Subir evidencias"}</button>}
    {subidos.length > 0 && <ul className="mt-3 space-y-2">{subidos.map((e) => <li key={e.id} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><Icon name="check" size={17} /><a href={e.url} target="_blank" rel="noreferrer" className="truncate underline">{e.nombre}</a></li>)}</ul>}
    {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
  </section>;
}
