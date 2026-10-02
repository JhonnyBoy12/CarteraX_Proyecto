/**
 * @file servicioAuth.ts
 * @description Autenticación local de CarteraX sobre SQLite.
 * La contraseña se almacena con scrypt y una sal aleatoria; nunca en texto plano.
 */
import Database from "better-sqlite3";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "crypto";

const USUARIO_INICIAL = {
  nombre: "Ejecutivo",
  apellido: "CarteraX",
  email: "ejecutivo@carterax.cl",
  password: "CarteraX123!",
};

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

/** Crea un usuario de prueba únicamente cuando la base todavía no tiene usuarios. */
export function asegurarUsuarioInicial(db: Database.Database): void {
  const total = db.prepare("SELECT COUNT(*) AS total FROM usuarios").get() as { total: number };
  if (total.total > 0) return;

  const ahora = new Date().toISOString();
  db.prepare(`
    INSERT INTO usuarios (id, nombre, apellido, email, password_hash, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    randomUUID(),
    USUARIO_INICIAL.nombre,
    USUARIO_INICIAL.apellido,
    USUARIO_INICIAL.email,
    crearHash(USUARIO_INICIAL.password),
    ahora,
    ahora
  );
}

export interface UsuarioSesion {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
}

export function iniciarSesion(db: Database.Database, email: string, password: string): UsuarioSesion {
  const correo = email.trim().toLowerCase();
  if (!correo || !password) throw new Error("Ingresa correo y contraseña.");

  const usuario = db.prepare(`
    SELECT id, nombre, apellido, email, password_hash, activo
    FROM usuarios
    WHERE lower(email) = ?
  `).get(correo) as (UsuarioSesion & { password_hash: string; activo: number }) | undefined;

  if (!usuario || usuario.activo !== 1 || !verificarHash(password, usuario.password_hash)) {
    throw new Error("Correo o contraseña incorrectos.");
  }

  db.prepare("UPDATE usuarios SET ultimo_acceso = ?, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), new Date().toISOString(), usuario.id);

  return { id: usuario.id, nombre: usuario.nombre, apellido: usuario.apellido, email: usuario.email };
}
