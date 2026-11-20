// Reglas con las que el backend genera códigos. Se repiten aquí solo para mostrar
// una vista previa en los formularios; el valor definitivo siempre lo da el backend.

const soloLetras = (texto: string) => texto.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");

/** Prefijo del código de equipo: las 3 primeras letras del tipo (Cargadores → CAR). */
export const prefijoTipo = (tipo: string) => soloLetras(tipo).slice(0, 3);

/** Código de equipo: prefijo del tipo y número de 3 cifras (CAR-020). */
export function codigoEquipo(tipo: string, numero: number | string) {
  const prefijo = prefijoTipo(tipo);
  const n = Number(numero);
  if (prefijo.length < 3 || !Number.isInteger(n) || n < 1 || n > 999) return "";
  return `${prefijo}-${String(n).padStart(3, "0")}`;
}

/** Usuario: inicial del nombre + cédula + inicial del último apellido (Carlos Rodríguez, 167… → c167…r). */
export function usuarioGenerado(nombre: string, documento: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2 || !documento.trim()) return "";
  return `${partes[0][0]}${documento.trim()}${partes[partes.length - 1][0]}`.toLowerCase();
}
