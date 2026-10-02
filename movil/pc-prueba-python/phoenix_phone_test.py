import json
import re
import socket
import tkinter as tk
from tkinter import messagebox
from urllib import request, error

PORT = 8765
TIMEOUT = 4


def normalize_ip(value: str) -> str:
    value = value.strip()
    value = re.sub(r"^https?://", "", value, flags=re.I)
    value = value.split("/")[0]
    value = value.split(":")[0]
    return value.strip()


def normalize_phone(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    # Conserva + inicial y solo dígitos después.
    plus = value.startswith("+")
    digits = re.sub(r"\D", "", value)
    return ("+" if plus else "") + digits


def http_json(url: str, method="GET", payload=None):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=headers, method=method)
    with request.urlopen(req, timeout=TIMEOUT) as response:
        raw = response.read().decode("utf-8", errors="replace")
        return response.status, json.loads(raw or "{}")


class PhoenixPhoneTest:
    def __init__(self, root):
        self.root = root
        root.title("Phoenix Phone Test")
        root.geometry("560x470")
        root.resizable(False, False)

        outer = tk.Frame(root, padx=28, pady=24)
        outer.pack(fill="both", expand=True)

        tk.Label(outer, text="PHOENIX PHONE TEST", font=("Segoe UI", 20, "bold")).pack(anchor="w")
        tk.Label(outer, text="PC → Wi‑Fi → Android → marcador", font=("Segoe UI", 11)).pack(anchor="w", pady=(2, 22))

        tk.Label(outer, text="IP que muestra Phoenix Mobile", font=("Segoe UI", 10, "bold")).pack(anchor="w")
        self.ip_entry = tk.Entry(outer, font=("Consolas", 13))
        self.ip_entry.insert(0, "192.168.1.25")
        self.ip_entry.pack(fill="x", pady=(5, 14), ipady=5)

        self.test_button = tk.Button(outer, text="PROBAR CONEXIÓN", command=self.test_connection, height=2)
        self.test_button.pack(fill="x")

        self.status = tk.Label(outer, text="⚪ Sin probar", font=("Segoe UI", 11, "bold"))
        self.status.pack(anchor="w", pady=(12, 20))

        tk.Label(outer, text="Número de prueba", font=("Segoe UI", 10, "bold")).pack(anchor="w")
        self.phone_entry = tk.Entry(outer, font=("Consolas", 13))
        self.phone_entry.insert(0, "+56912345678")
        self.phone_entry.pack(fill="x", pady=(5, 14), ipady=5)

        self.call_button = tk.Button(outer, text="📞 ENVIAR Y ABRIR MARCADOR", command=self.send_call, height=2)
        self.call_button.pack(fill="x")

        tk.Label(
            outer,
            text="La llamada no se confirma automáticamente: Android abrirá el marcador con el número listo.",
            justify="left",
            wraplength=490,
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(18, 0))

        self.details = tk.Label(outer, text="", justify="left", anchor="w", wraplength=490, font=("Segoe UI", 9))
        self.details.pack(fill="x", pady=(12, 0))

    def endpoint(self, path):
        ip = normalize_ip(self.ip_entry.get())
        if not ip:
            raise ValueError("Ingresa la IP que aparece en Phoenix Mobile.")
        return f"http://{ip}:{PORT}{path}"

    def test_connection(self):
        self.status.config(text="🟡 Probando conexión...")
        self.root.update_idletasks()
        try:
            status, data = http_json(self.endpoint("/ping"))
            if status == 200 and data.get("ok"):
                device = data.get("device", "Android")
                self.status.config(text="🟢 Teléfono conectado")
                self.details.config(text=f"Dispositivo: {device}\nPuerto: {PORT}")
            else:
                raise RuntimeError("El teléfono respondió, pero la respuesta no fue válida.")
        except Exception as exc:
            self.status.config(text="🔴 No conectado")
            self.details.config(text=str(exc))
            messagebox.showerror(
                "No se pudo conectar",
                "Phoenix Desktop no pudo contactar al teléfono.\n\n"
                "Verifica que ambos estén en la misma Wi‑Fi, que Phoenix Mobile esté abierto y que la IP sea correcta.\n\n"
                f"Detalle: {exc}",
            )

    def send_call(self):
        phone = normalize_phone(self.phone_entry.get())
        if len(re.sub(r"\D", "", phone)) < 7:
            messagebox.showwarning("Número inválido", "Ingresa un número de prueba válido.")
            return

        self.status.config(text="🟡 Enviando número...")
        self.root.update_idletasks()
        try:
            status, data = http_json(self.endpoint("/call"), method="POST", payload={"phone": phone})
            if status == 200 and data.get("ok"):
                self.status.config(text="🟢 Orden recibida por Android")
                self.details.config(text=f"Número enviado: {phone}\nEl teléfono debería haber abierto el marcador.")
            else:
                raise RuntimeError(data.get("error", "Respuesta inesperada del teléfono."))
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            self.status.config(text="🔴 Error")
            self.details.config(text=body)
            messagebox.showerror("Error desde Android", body or str(exc))
        except Exception as exc:
            self.status.config(text="🔴 Error enviando número")
            self.details.config(text=str(exc))
            messagebox.showerror(
                "No se pudo enviar",
                "El teléfono no recibió la orden.\n\n"
                "Prueba primero el botón 'Probar conexión'.\n\n"
                f"Detalle: {exc}",
            )


if __name__ == "__main__":
    root = tk.Tk()
    PhoenixPhoneTest(root)
    root.mainloop()
