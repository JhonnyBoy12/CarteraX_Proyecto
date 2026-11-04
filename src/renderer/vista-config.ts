/**
 * @file vista-config.ts
 * @description Preferencias (RF-27), contraseña y respaldo (RNF-12).
 */

async function cargarConfig(): Promise<void> {
  try {
    App.config = await Api.config();
    $input("cfg-meta").value = App.config.metaMensual ? numero(App.config.metaMensual) : "";
    $input("cfg-dias").value = String(App.config.diasSinGestion);
    $input("cfg-inactividad").value = String(App.config.inactividadMinutos);
    $("cfg-version").textContent = `CarteraX Phoenix ${App.contexto?.version ?? ""}`;
  } catch {
    /* sin sesión */
  }
}

function prepararConfig(): void {
  $("form-config").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const meta = leerMonto($input("cfg-meta").value) ?? 0;
    const c = await intentar(() =>
      Api.guardarConfig({ metaMensual: meta, diasSinGestion: Number($input("cfg-dias").value), inactividadMinutos: Number($input("cfg-inactividad").value) })
    );
    if (!c) return;
    App.config = c;
    reiniciarInactividad();
    aviso("Preferencias guardadas.", "ok");
    void cargarConfig();
  });
  $("form-password").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nueva = $input("pwd-nueva").value;
    if (nueva !== $input("pwd-repetir").value) return aviso("Las contraseñas nuevas no coinciden.", "error");
    if (await intentar(() => Api.cambiarPassword($input("pwd-actual").value, nueva))) {
      (ev.target as HTMLFormElement).reset();
      aviso("Contraseña actualizada.", "ok");
    }
  });
  $("btn-respaldar").addEventListener("click", async (ev) => {
    const r = await intentar(() => Api.respaldar(), ev.currentTarget as HTMLButtonElement);
    avisoArchivo(r ?? null, "Respaldo guardado");
  });
  $("btn-restaurar").addEventListener("click", async (ev) => {
    const ok = await confirmar(
      "Restaurar un respaldo",
      "La base actual se reemplaza por la del respaldo y la aplicación se reinicia. Antes se guarda una copia automática de la base actual.",
      "Elegir respaldo",
      true
    );
    if (ok) await intentar(() => Api.restaurar(), ev.currentTarget as HTMLButtonElement);
  });
}
