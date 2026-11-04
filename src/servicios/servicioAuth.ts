/**
 * @file servicioAuth.ts
 * @description Autenticación local sobre SQLite (RF-01, RF-03, RF-05, RF-06).
 *
 *  - Contraseñas con scrypt + sal aleatoria (RNF-04), nunca en texto plano.
 *  - Bloqueo temporal tras intentos fallidos (RF-05).
 *  - Registro de inicio y cierre de cada sesión (RF-06).
 */
import Database from "better-sqlite3";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";

const USUARIO_INICIAL = {
  nombre: "Ejecutivo",
  apellido: "CarteraX",
  email: "ejecutivo@carterax.cl",
  password: "CarteraX123!",
};

/** Intentos fallidos permitidos antes de bloquear. */
export const MAX_INTENTOS = 5;
/** Minutos de bloqueo. */
export const MINUTOS_BLOQUEO = 5;

/** Id con el que el prototipo guardaba las importaciones antes del login. */
const USUARIO_LEGADO = "ejecutivo-local";

function crearHash(password: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(password, sal, 64);
  return `scrypt:${sal.toString("hex")}:${hash.toString("hex")}`;
}

function verificarHash(password: string, almacenado: string): boolean {
  const [algoritmo, salHex, hashHex] = almacenado.split(":");
  if (algoritmo !== "scrypt" || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const calculado = scryptSync(password, Buffer.from(salHex, "hex"), esperado.length);
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

/** Crea el usuario de prueba sólo si no existe ningún usuario real. */
export function asegurarUsuarioInicial(db: Database.Database): void {
  const total = db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE id <> ?").get(USUARIO_LEGADO) as { total: number };
  if (total.total > 0) return;
  db.prepare(
    `INSERT INTO usuarios (id, nombre, apellido, email, password_hash, activo) VALUES (?, ?, ?, ?, ?, 1)`
  ).run(randomUUID(), USUARIO_INICIAL.nombre, USUARIO_INICIAL.apellido, USUARIO_INICIAL.email, crearHash(USUARIO_INICIAL.password));
}

/** Valida contraseñas nuevas: mínimo 8 caracteres, con letra y número. */
export function validarPasswordNueva(password: string): void {
  if (typeof password !== "string" || password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) {
    throw new Error("La contraseña debe combinar letras y números.");
  }
}

interface FilaUsuario {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  password_hash: string;
  activo: number;
  intentos_fallidos: number;
  bloqueado_hasta: string | null;
}

/**
 * Valida credenciales. Tras {@link MAX_INTENTOS} fallos seguidos bloquea la
 * cuenta {@link MINUTOS_BLOQUEO} minutos.
 */
export function iniciarSesion(db: Database.Database, email: string, password: string): Phoenix.UsuarioSesion {
  const correo = String(email ?? "").trim().toLowerCase();
  if (!correo || !password) throw new Error("Ingresa correo y contraseña.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error("El correo no tiene un formato válido.");

  const u = db
    .prepare(
      `SELECT id, nombre, apellido, email, password_hash, activo, intentos_fallidos, bloqueado_hasta
         FROM usuarios WHERE lower(email) = ?`
    )
    .get(correo) as FilaUsuario | undefined;

  if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta).getTime() > Date.now()) {
    const minutos = Math.ceil((new Date(u.bloqueado_hasta).getTime() - Date.now()) / 60_000);
    throw new Error(`Cuenta bloqueada por intentos fallidos. Intenta de nuevo en ${minutos} min.`);
  }

  if (!u || u.activo !== 1 || !verificarHash(password, u.password_hash)) {
    if (u) {
      const intentos = (u.intentos_fallidos ?? 0) + 1;
      const bloqueo = intentos >= MAX_INTENTOS ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString() : null;
      db.prepare("UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?").run(
        bloqueo ? 0 : intentos,
        bloqueo,
        u.id
      );
      if (bloqueo) throw new Error(`Demasiados intentos fallidos. La cuenta queda bloqueada ${MINUTOS_BLOQUEO} minutos.`);
      const quedan = MAX_INTENTOS - intentos;
      throw new Error(`Correo o contraseña incorrectos. Te quedan ${quedan} intento${quedan === 1 ? "" : "s"}.`);
    }
    throw new Error("Correo o contraseña incorrectos.");
  }

  const ahora = new Date().toISOString();
  db.prepare(
    "UPDATE usuarios SET ultimo_acceso = ?, updated_at = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?"
  ).run(ahora, ahora, u.id);

  return { id: u.id, nombre: u.nombre, apellido: u.apellido, email: u.email };
}

/** RF-06: registra el inicio de sesión. Devuelve el id del registro. */
export function registrarInicioSesion(db: Database.Database, usuarioId: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO sesiones_log (id, usuario_id) VALUES (?, ?)").run(id, usuarioId);
  return id;
}

/** RF-06: registra el cierre de sesión (manual, inactividad o salida). */
export function registrarFinSesion(db: Database.Database, sesionId: string, motivo: string): void {
  db.prepare("UPDATE sesiones_log SET fin = CURRENT_TIMESTAMP, motivo_fin = ? WHERE id = ? AND fin IS NULL").run(motivo, sesionId);
}

/** Cambia la contraseña verificando la actual. */
export function cambiarPassword(db: Database.Database, usuarioId: string, actual: string, nueva: string): void {
  const u = db.prepare("SELECT password_hash FROM usuarios WHERE id = ?").get(usuarioId) as { password_hash: string } | undefined;
  if (!u || !verificarHash(String(actual ?? ""), u.password_hash)) throw new Error("La contraseña actual no es correcta.");
  validarPasswordNueva(nueva);
  if (actual === nueva) throw new Error("La nueva contraseña debe ser distinta a la actual.");
  db.prepare("UPDATE usuarios SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(crearHash(nueva), usuarioId);
}

/**
 * Bases del prototipo: las importaciones quedaban a nombre de un usuario
 * genérico. El primer ejecutivo que inicia sesión adopta esas carteras
 * (sólo los meses que él todavía no tenga).
 */
export function adoptarCarterasLegado(db: Database.Database, usuarioId: string): number {
  return db
    .prepare(
      `UPDATE carteras SET usuario_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE usuario_id = ?
          AND periodo_id NOT IN (SELECT periodo_id FROM carteras WHERE usuario_id = ?)`
    )
    .run(usuarioId, USUARIO_LEGADO, usuarioId).changes;
}
