// Backend simulado en memoria. Implementa el mismo contrato que el backend real (ver api.ts),
// con las mismas validaciones básicas. Los cambios se pierden al recargar la página.
import {
  MODULOS,
  type CheckIn,
  type EvidenciaAdjunta,
  type ItemBanco,
  type ListaInspeccion,
  type ListaOperativa,
  type Nivel,
  type Modulo,
  type ResultadoInspeccion,
  type RegistroOperativo,
  type SeveridadIncidente,
  type TipoNovedad,
  type TipoRegistroOperativo,
} from "../types";
import type { Api } from "./api";
import { ApiError } from "./ApiError";
import { codigoEquipo, usuarioGenerado } from "./codigos";
import * as datos from "./mockData";

const db = structuredClone({ usuarios: datos.usuarios, roles: datos.roles, tipos: datos.tipos, equipos: datos.equipos, listas: datos.listas });
let sesionActual = "";

// Banco de ítems: se arma con los ítems de las listas de prueba (sin repetir) y cada ítem de lista apunta a él.
const banco: ItemBanco[] = [];
for (const lista of db.listas) for (const seccion of lista.secciones) for (const item of seccion.items) {
  let enBanco = banco.find((b) => b.categoria === seccion.titulo && b.texto === item.texto);
  if (!enBanco) { enBanco = { id: `ITM-${banco.length + 1}`, texto: item.texto, categoria: seccion.titulo, critico: !!item.critico }; banco.push(enBanco); }
  item.id = enBanco.id;
}
/** Agrupa los ítems elegidos en secciones consecutivas por categoría, como el backend. */
function seccionesDe(itemIds: string[]): ListaInspeccion["secciones"] {
  const secciones: ListaInspeccion["secciones"] = [];
  for (const id of itemIds) {
    const b = banco.find((x) => x.id === id);
    if (!b) throw new ApiError(400, { items: [`El ítem ${id} no existe.`] });
    if (secciones[secciones.length - 1]?.titulo !== b.categoria) secciones.push({ titulo: b.categoria, items: [] });
    secciones[secciones.length - 1].items.push({ id: b.id, texto: b.texto, critico: b.critico });
  }
  return secciones;
}
const registros = {
  checkins: [] as (CheckIn & { operador: number })[],
  inspecciones: [] as (ResultadoInspeccion & { equipo: string; checkin: number; respuestas: string[]; pendiente: boolean })[],
  novedades: [] as (RegistroOperativo & { equipo: string; tipo: TipoNovedad; descripcion: string; observacion: string })[],
  incidentes: [] as (RegistroOperativo & { equipo: string; ocurridoEn: string; descripcion: string; severidad: SeveridadIncidente })[],
  evidencias: [] as EvidenciaAdjunta[],
};
let siguienteRegistro = 0;

const esperar = <T,>(valor: T): Promise<T> => new Promise((ok) => setTimeout(() => ok(structuredClone(valor)), 150));
const siguienteId = (lista: { id: number }[]) => Math.max(0, ...lista.map((x) => x.id)) + 1;
const hoy = () => new Date().toLocaleDateString("es-CO");
const claveTemporal = () => Math.random().toString(36).slice(2, 12);
const buscar = <T extends { id: number | string }>(lista: T[], id: T["id"]) => {
  const x = lista.find((y) => y.id === id);
  if (!x) throw new ApiError(404, { detail: ["No encontrado."] });
  return x;
};

function conInspeccion(c: CheckIn): CheckIn {
  const i = registros.inspecciones.find((x) => x.checkin === c.id);
  return { ...c, inspeccion: i ? { id: i.id, resultadoGlobal: i.resultadoGlobal, esCritica: i.esCritica, pendiente: i.pendiente } : null };
}

export const mockApi: Api = {
  auth: {
    async login(usuario, clave) {
      const u = db.usuarios.find((x) => x.usuario === usuario || x.documento === usuario);
      if (!u || !u.activo || clave !== datos.CLAVE_PRUEBA) throw new ApiError(401, { detail: ["Credenciales inválidas."] });
      sesionActual = u.nombre;
      const permisos = db.roles.find((r) => r.nombre === u.rol)?.permisos
        ?? Object.fromEntries(MODULOS.map((m) => [m, "Sin acceso"])) as Record<Modulo, Nivel>;
      return esperar({ token: "token-de-prueba", nombre: u.nombre, usuario: u.usuario, rol: u.rol, esAdmin: u.rol === "Administrador", debeCambiarClave: false, permisos });
    },
    async logout() {
      sesionActual = "";
    },
    async cambiarClave(actual) {
      if (actual !== datos.CLAVE_PRUEBA) throw new ApiError(400, { actual: ["La contraseña actual no es correcta."] });
      await esperar(null);
    },
  },

  usuarios: {
    listar: async () => esperar(db.usuarios),
    async crear(d) {
      if (db.usuarios.some((u) => u.documento === d.documento)) throw new ApiError(400, { documento: ["Ya existe un usuario con este documento."] });
      const usuario = usuarioGenerado(d.nombre, d.documento);
      if (!usuario) throw new ApiError(400, { nombre: ["Escribe nombre y apellido para generar el usuario."] });
      const nuevo = { ...d, usuario, id: siguienteId(db.usuarios) };
      db.usuarios.unshift(nuevo);
      return esperar({ ...nuevo, claveTemporal: claveTemporal() });
    },
    async actualizar(id, d) {
      if (d.documento && db.usuarios.some((u) => u.id !== id && u.documento === d.documento)) throw new ApiError(400, { documento: ["Ya existe un usuario con este documento."] });
      const u = Object.assign(buscar(db.usuarios, id), d);
      u.usuario = usuarioGenerado(u.nombre, u.documento) || u.usuario;
      return esperar(u);
    },
    async restablecerClave(id) {
      buscar(db.usuarios, id);
      return esperar(claveTemporal());
    },
  },

  roles: {
    listar: async () => esperar(db.roles),
    async crear(nombre, soloConsulta) {
      if (db.roles.some((r) => r.nombre.toLowerCase() === nombre.toLowerCase())) throw new ApiError(400, { nombre: ["Ya existe un rol con este nombre."] });
      const permisos = Object.fromEntries(MODULOS.map((m) => [m, soloConsulta ? "Solo ver" : "Sin acceso"])) as Record<Modulo, Nivel>;
      const nuevo = { id: siguienteId(db.roles), nombre, base: false, permisos };
      db.roles.push(nuevo);
      return esperar(nuevo);
    },
    async guardarPermisos(id, permisos) {
      const r = buscar(db.roles, id);
      r.permisos = { ...permisos };
      return esperar(r);
    },
  },

  tipos: {
    listar: async () => esperar(db.tipos),
    async crear(d) {
      if (db.tipos.some((t) => t.nombre.toLowerCase() === d.nombre.toLowerCase())) throw new ApiError(400, { nombre: ["Ya existe un tipo con este nombre."] });
      const nuevo = { ...d, id: siguienteId(db.tipos) };
      db.tipos.push(nuevo);
      return esperar(nuevo);
    },
    async actualizar(id, d) {
      if (d.nombre && db.tipos.some((t) => t.id !== id && t.nombre.toLowerCase() === d.nombre!.toLowerCase())) throw new ApiError(400, { nombre: ["Ya existe un tipo con este nombre."] });
      const t = buscar(db.tipos, id);
      const anterior = t.nombre;
      Object.assign(t, d);
      if (d.nombre && d.nombre !== anterior) {
        db.equipos.forEach((e) => { if (e.tipo === anterior) e.tipo = d.nombre!; });
        db.listas.forEach((l) => { if (l.tipo === anterior) l.tipo = d.nombre!; });
      }
      return esperar(t);
    },
    async eliminar(id) {
      const t = buscar(db.tipos, id);
      if (db.equipos.some((e) => e.tipo === t.nombre)) throw new ApiError(400, { detail: ["No se puede eliminar un tipo con equipos asociados."] });
      db.tipos = db.tipos.filter((x) => x.id !== id);
      db.listas = db.listas.filter((l) => l.tipo !== t.nombre);
      await esperar(null);
    },
  },

  equipos: {
    listar: async () => esperar(db.equipos),
    async crear({ numero, ...d }) {
      const codigo = codigoEquipo(d.tipo, numero);
      if (!codigo) throw new ApiError(400, { numero: ["Elige un número entre 1 y 999."] });
      if (db.equipos.some((e) => e.codigo === codigo)) throw new ApiError(400, { numero: [`El código ${codigo} ya existe. Elige otro número.`] });
      const nuevo = { ...d, id: codigo, codigo, modificado: `${sesionActual || "Administrador"} · ${hoy()}` };
      db.equipos.unshift(nuevo);
      return esperar(nuevo);
    },
    async actualizar(id, d) {
      return esperar(Object.assign(buscar(db.equipos, id), d, { modificado: `${sesionActual || "Administrador"} · ${hoy()}` }));
    },
  },

  listas: {
    listar: async () => esperar(db.listas),
    async crear(tipo) {
      if (db.listas.some((l) => l.tipo === tipo)) throw new ApiError(400, { tipo: ["Este tipo de equipo ya tiene lista."] });
      const nueva = { id: `CHK-${tipo.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`, tipo, nombre: `Lista de ${tipo.toLowerCase()}`, version: 1, secciones: [] };
      db.listas.push(nueva);
      return esperar(nueva);
    },
    async actualizar(id, itemIds) {
      const l = buscar(db.listas, id);
      l.secciones = seccionesDe(itemIds);
      l.version += 1; // las inspecciones anteriores conservan la versión que respondieron
      return esperar(l);
    },
    async eliminar(id) {
      const l = buscar(db.listas, id);
      if (registros.inspecciones.some((i) => i.checkin && registros.checkins.some((c) => c.id === i.checkin && db.equipos.some((e) => e.codigo === c.codigoEquipo && e.tipo === l.tipo)))) {
        throw new ApiError(400, { detail: ["No se puede eliminar porque tiene registros asociados."] });
      }
      db.listas = db.listas.filter((x) => x.id !== id);
      await esperar(null);
    },
  },

  banco: {
    listar: async () => esperar(banco),
    async crear(d) {
      if (banco.some((b) => b.categoria.toLowerCase() === d.categoria.trim().toLowerCase() && b.texto.toLowerCase() === d.texto.trim().toLowerCase())) throw new ApiError(400, { texto: ["Ese ítem ya está en el banco."] });
      const nuevo = { id: `ITM-${banco.length + 1}`, texto: d.texto.trim(), categoria: d.categoria.trim(), critico: d.critico };
      banco.push(nuevo);
      return esperar(nuevo);
    },
  },

  operacion: {
    equiposDisponibles: async () => {
      const ocupados = new Set(registros.checkins.filter((c) => !c.finalizadoEn).map((c) => c.codigoEquipo));
      return esperar(db.equipos.filter((e) => e.estado === "Disponible" && !ocupados.has(e.codigo)));
    },
    checkins: async () => {
      const id = db.usuarios.find((u) => u.nombre === sesionActual)?.id;
      return esperar(registros.checkins.filter((c) => c.operador === id).map(({ operador: _operador, ...c }) => conInspeccion(c)));
    },
    async iniciarCheckin(codigo, horometroInicial) {
      const equipo = db.equipos.find((e) => e.codigo === codigo);
      if (!equipo || equipo.estado !== "Disponible") throw new ApiError(400, { equipo: ["El equipo no está disponible."] });
      if (registros.checkins.some((c) => c.codigoEquipo === codigo && !c.finalizadoEn)) {
        throw new ApiError(400, { equipo: ["El equipo ya tiene un check-in abierto."] });
      }
      const lista = db.listas.find((l) => l.tipo === equipo.tipo);
      const operador = db.usuarios.find((u) => u.nombre === sesionActual)?.id ?? 0;
      const checkin: CheckIn = {
        id: ++siguienteRegistro,
        equipo: codigo,
        codigoEquipo: codigo,
        horometroInicial: String(horometroInicial),
        horometroFinal: "0",
        iniciadoEn: new Date().toISOString(),
        finalizadoEn: null,
        listaId: lista?.id ?? null,
        inspeccion: null,
      };
      registros.checkins.push({ ...checkin, operador });
      return esperar(checkin);
    },
    async cerrarCheckin(id, horometroFinal, _observacionGeneral) {
      const checkin = registros.checkins.find((c) => c.id === id);
      if (!checkin || checkin.finalizadoEn) throw new ApiError(400, { detail: ["El check-in no está abierto."] });
      const final = Number(horometroFinal);
      if (!Number.isFinite(final) || final < Number(checkin.horometroInicial)) {
        throw new ApiError(400, { horometroFinal: ["La lectura final debe ser igual o mayor a la inicial."] });
      }
      checkin.horometroFinal = String(final);
      checkin.finalizadoEn = new Date().toISOString();
      registros.inspecciones.forEach((i) => { if (i.checkin === id) i.pendiente = false; }); // se envía al cerrar
      return esperar(conInspeccion(checkin));
    },
    async equipo(codigo) {
      const e = db.equipos.find((x) => x.codigo === codigo);
      if (!e) throw new ApiError(404, { detail: ["No encontrado."] });
      return esperar(e);
    },
    async listaParaEquipo(codigo): Promise<ListaOperativa> {
      const equipo = db.equipos.find((e) => e.codigo === codigo);
      const lista = equipo && db.listas.find((l) => l.tipo === equipo.tipo);
      if (!lista) throw new ApiError(404, { detail: ["Este equipo no tiene una lista de inspección activa."] });
      return esperar({
        id: lista.id,
        nombre: `Lista de ${lista.tipo}`,
        version: lista.version,
        secciones: lista.secciones.map((s, si) => ({
          titulo: s.titulo,
          items: s.items.map((item, ii) => ({ id: `${lista.id}-${si}-${ii}`, texto: item.texto, critico: !!item.critico })),
        })),
      });
    },
    async inspeccionParaCheckin(checkin) {
      const registro = registros.inspecciones.find((i) => i.checkin === checkin.id);
      return registro ? esperar({
        id: registro.id,
        resultadoGlobal: registro.resultadoGlobal,
        esCritica: registro.esCritica,
      }) : esperar(null);
    },
    async registrarInspeccion(datos) {
      const lista = db.listas.find((l) => l.id === datos.lista);
      if (!lista) throw new ApiError(404, { lista: ["No se encontró la lista de inspección."] });
      const itemIds = lista.secciones.flatMap((s, si) => s.items.map((_, ii) => `${lista.id}-${si}-${ii}`));
      if (itemIds.length !== datos.respuestas.length || itemIds.some((id) => !datos.respuestas.some((r) => r.item === id))) {
        throw new ApiError(400, { respuestas: ["Debes responder todos los ítems."] });
      }
      const criticos = new Set(lista.secciones.flatMap((s, si) => s.items.flatMap((item, ii) => item.critico ? [`${lista.id}-${si}-${ii}`] : [])));
      const esCritica = datos.respuestas.some((r) => criticos.has(r.item) && r.resultado === "does_not_comply");
      const resultado: ResultadoInspeccion = { id: ++siguienteRegistro, resultadoGlobal: esCritica ? "critical_failure" : "completed", esCritica };
      registros.inspecciones.push({ ...resultado, equipo: datos.equipo, checkin: datos.checkin, respuestas: datos.respuestas.map((r) => r.item), pendiente: !!datos.pendiente });
      return esperar(resultado);
    },
    async registrarNovedad(datos) {
      if (!db.equipos.some((e) => e.codigo === datos.equipo)) throw new ApiError(400, { equipo: ["El equipo no existe."] });
      if (!datos.descripcion.trim()) throw new ApiError(400, { descripcion: ["Escribe la descripción de la novedad."] });
      const r: RegistroOperativo = { id: ++siguienteRegistro, estado: "reported", creadoEn: new Date().toISOString() };
      registros.novedades.push({ ...r, ...datos });
      return esperar(r);
    },
    async registrarIncidente(datos) {
      if (!db.equipos.some((e) => e.codigo === datos.equipo)) throw new ApiError(400, { equipo: ["El equipo no existe."] });
      if (!datos.descripcion.trim() || !datos.ocurridoEn) throw new ApiError(400, { descripcion: ["Completa los datos obligatorios del incidente."] });
      const r: RegistroOperativo = { id: ++siguienteRegistro, estado: "reported", creadoEn: new Date().toISOString() };
      registros.incidentes.push({ ...r, ...datos });
      return esperar(r);
    },
    async subirEvidencia(tipo: TipoRegistroOperativo, idRegistro: number, archivo: File) {
      const cantidad = registros.evidencias.filter((e) => e.tipoRegistro === tipo && e.idRegistro === idRegistro).length;
      if (cantidad >= 5) throw new ApiError(400, { file: ["Un registro puede tener máximo 5 archivos."] });
      const url = URL.createObjectURL(archivo);
      const evidencia: EvidenciaAdjunta = { id: ++siguienteRegistro, tipoRegistro: tipo, idRegistro, url, nombre: archivo.name };
      registros.evidencias.push(evidencia);
      return esperar(evidencia);
    },
  },
};
