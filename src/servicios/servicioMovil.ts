/**
 * @file servicioMovil.ts
 * @description Une Phoenix Mobile con la cartera:
 *  - Guarda la IP del teléfono en `configuracion` (persiste entre sesiones).
 *  - Ordena llamadas a los teléfonos importados desde Excel/CSV.
 *  - Registra cada intento de llamada en la tabla existente `gestiones`
 *    (categoría `'llamada'`), dejando trazabilidad por cliente.
 *
 * @since 0.2.0
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { CLAVES, guardarConfig, leerConfig } from "../db/configuracion";
import { historialLlamadas } from "../db/consultas";
import { llamarDesdeMovil, normalizarIp, pingMovil, PUERTO_MOVIL } from "../movil/clienteMovil";

/**
 * IP del teléfono guardada (o `null` si nunca se configuró).
 * @param db Conexión SQLite.
 */
export function obtenerIpMovil(db: Database.Database): string | null {
  return leerConfig(db, CLAVES.MOVIL_IP);
}

/**
 * Guarda la IP del teléfono (normalizada).
 * @param db Conexión SQLite.
 * @param ip IP tal como la escribió el usuario.
 * @returns IP normalizada que quedó guardada.
 */
export function guardarIpMovil(db: Database.Database, ip: string): string {
  const limpia = normalizarIp(ip);
  guardarConfig(db, CLAVES.MOVIL_IP, limpia || null);
  return limpia;
}

/**
 * Prueba la conexión con el teléfono. Si se entrega una IP nueva y la
 * prueba es exitosa, la guarda como IP por defecto.
 *
 * @param db Conexión SQLite.
 * @param ip IP a probar; si se omite se usa la guardada.
 */
export async function probarMovil(db: Database.Database, ip?: string): Promise<Phoenix.EstadoMovil> {
  const objetivo = ip ?? obtenerIpMovil(db) ?? "";
  const estado = await pingMovil(objetivo);
  if (estado.conectado && ip) guardarIpMovil(db, ip);
  return estado;
}

/**
 * Inserta una gestión de tipo llamada.
 * @returns id de la gestión creada.
 */
function registrarGestionLlamada(
  db: Database.Database,
  clienteId: string | null,
  texto: string,
  resultado: string
): string {
  const gestionId = randomUUID();
  db.prepare(
    `INSERT INTO gestiones (id, cliente_id, usuario_id, texto_libre, categoria, resultado)
     VALUES (?, ?, NULL, ?, 'llamada', ?)`
  ).run(gestionId, clienteId, texto, resultado);
  return gestionId;
}

/**
 * Ordena a Phoenix Mobile llamar a un número y lo registra en `gestiones`.
 * Si la llamada falla, también se registra (resultado `"error"`) y luego
 * se relanza el error para mostrarlo en pantalla.
 *
 * @param db Conexión SQLite.
 * @param numero Número a llamar (de la ficha del cliente o escrito a mano).
 * @param clienteId Cliente asociado (opcional, para trazabilidad).
 * @returns Número enviado, acción y id de la gestión registrada.
 * @example
 * await llamar(db, "+56912345678", 42);
 */
export async function llamar(
  db: Database.Database,
  numero: string,
  clienteId: string | null = null
): Promise<Phoenix.ResultadoLlamada> {
  const ip = obtenerIpMovil(db);
  if (!ip) throw new Error("Primero configura la IP de Phoenix Mobile en la sección «Teléfono».");

  try {
    const r = await llamarDesdeMovil(ip, numero);
    const gestionId = registrarGestionLlamada(
      db,
      clienteId,
      `Llamada a ${r.numero} vía Phoenix Mobile (${ip}:${PUERTO_MOVIL})`,
      "enviada"
    );
    return { numero: r.numero, accion: r.accion, gestionId };
  } catch (e) {
    registrarGestionLlamada(db, clienteId, `Llamada a ${numero} fallida: ${(e as Error).message}`, "error");
    throw e;
  }
}

/**
 * Últimas llamadas registradas.
 * @param db Conexión SQLite.
 * @param limite Máximo de filas.
 */
export function obtenerLlamadas(db: Database.Database, limite = 30): Phoenix.LlamadaRegistrada[] {
  return historialLlamadas(db, limite);
}
