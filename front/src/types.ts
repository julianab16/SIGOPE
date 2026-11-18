// Modelos del front. El backend usa nombres en inglés; la traducción entre
// ambos formatos se hace solo en services/api.ts.

export type Usuario = {
  id: number;
  nombre: string;
  documento: string;
  usuario: string;
  rol: string; // nombre del rol
  activo: boolean;
};

/** Respuesta al crear un usuario: si el backend generó la contraseña, la devuelve una sola vez. */
export type UsuarioCreado = Usuario & { claveTemporal?: string };

export const MODULOS = [
  "Inspecciones",
  "Novedades e incidentes",
  "Mantenimientos",
  "Seguimiento SST",
  "Documentos",
  "Reportes y tableros",
  "Usuarios y roles",
  "Catálogos y listas",
] as const;
export type Modulo = (typeof MODULOS)[number];

export const NIVELES = ["Sin acceso", "Solo ver", "Ver y gestionar"] as const;
export type Nivel = (typeof NIVELES)[number];

export type Rol = {
  id: number;
  nombre: string;
  base: boolean; // true para Operario, Jefe de Taller, SST y Administrador
  permisos: Record<Modulo, Nivel>;
};

export type TipoEquipo = {
  id: number;
  nombre: string;
  descripcion: string;
  activo: boolean;
};

export const ESTADOS_EQUIPO = ["Disponible", "En mantenimiento", "Fuera de servicio"] as const;
export type EstadoEquipo = (typeof ESTADOS_EQUIPO)[number];

export type Equipo = {
  id: string; // es el mismo código: identifica al equipo y no se puede cambiar
  codigo: string;
  placa: string;
  tipo: string; // nombre del tipo de equipo
  marca: string;
  serie: string;
  anio: string;
  horometro: string;
  estado: EstadoEquipo;
  modificado: string; // "usuario · fecha" de la última modificación (lo llena el backend)
};

export type Item = { texto: string; critico?: boolean };
export type Seccion = { titulo: string; items: Item[] };

export type ListaInspeccion = {
  id: string;
  tipo: string; // tipo de equipo: cada tipo tiene una sola lista
  version: number; // el backend la sube en cada actualización
  secciones: Seccion[];
};

export type Sesion = {
  token: string;
  nombre: string;
  usuario: string;
  rol: string;
  esAdmin: boolean; // rol Administrador o superusuario
  debeCambiarClave: boolean; // tiene una contraseña temporal
  permisos: Record<Modulo, Nivel>;
};

export type CheckIn = {
  id: number;
  equipo: string;
  codigoEquipo: string;
  horometroInicial: string;
  horometroFinal: string;
  iniciadoEn: string;
  finalizadoEn: string | null;
  listaId: string | null;
};

export type ListaOperativa = {
  id: string;
  nombre: string;
  version: number;
  secciones: {
    titulo: string;
    items: { id: string; texto: string; critico: boolean }[];
  }[];
};

export type ResultadoInspeccion = {
  id: number;
  resultadoGlobal: string;
  esCritica: boolean;
};

export type TipoRegistroOperativo = "inspection" | "news" | "incident";

export type EvidenciaAdjunta = {
  id: number;
  tipoRegistro: TipoRegistroOperativo;
  idRegistro: number;
  url: string;
  nombre: string;
};

export type RegistroOperativo = {
  id: number;
  estado: string;
  creadoEn: string;
};

export type TipoNovedad =
  | "mechanical_failure"
  | "unsafe_condition"
  | "damage"
  | "environmental";

export type SeveridadIncidente = "leve" | "media" | "grave";
