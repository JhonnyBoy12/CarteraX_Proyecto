# CarteraX

Sistema de Gestión de Cartera desarrollado como aplicación de escritorio con Electron y TypeScript.

## Tecnologías

- Node.js 22 o superior
- npm 10+
- Electron
- TypeScript
- SQLite (próximamente)
- Android (módulo móvil de llamadas)

---

## Inicio rápido — computador nuevo

Esta sección permite preparar rápidamente CarteraX en un computador nuevo o en un notebook de la universidad.

### 1. Clonar el repositorio

```powershell
git clone https://github.com/JhonnyBoy12/CarteraX_Proyecto.git
cd CarteraX_Proyecto
```

### 2. Permitir scripts en la terminal actual

PowerShell puede bloquear la ejecución de archivos `.ps1`.

Ejecutar:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Este cambio solamente afecta a la terminal actual y desaparece al cerrar PowerShell.

### 3. Preparar el computador

Ejecutar:

```powershell
.\scripts\bootstrap.ps1
```

El script comprobará automáticamente:

- Git
- Node.js
- npm
- Dependencias de CarteraX

Si Node.js no está instalado y `winget` está disponible, el script intentará instalar Node.js LTS.

Después de instalar Node.js puede ser necesario cerrar PowerShell y abrirlo nuevamente.

### 4. Ejecutar CarteraX

```powershell
npm run dev
```

Si todo está correctamente configurado, se abrirá la aplicación de escritorio CarteraX.

---

##  Preparar solamente las dependencias

Si Git, Node.js y npm ya están instalados, también se puede utilizar:

```powershell
.\scripts\setup.ps1
```

Este script comprobará el entorno e instalará las dependencias mediante:

```powershell
npm install
```

---

##  Solución de problemas

### PowerShell bloquea los scripts

Si aparece un error indicando que la ejecución de scripts está deshabilitada:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Luego ejecutar nuevamente:

```powershell
.\scripts\bootstrap.ps1
```

### Node.js o npm no son reconocidos

Comprobar:

```powershell
node --version
npm --version
```

Si Node.js acaba de ser instalado, cerrar PowerShell y abrirlo nuevamente.

También se puede comprobar si Node existe en la ubicación habitual:

```powershell
Test-Path "C:\Program Files\nodejs\node.exe"
```

---

##  Flujo de trabajo con Git

No trabajar directamente sobre `main`.

La estructura recomendada es:

```text
main
└── develop
    ├── feature/database
    ├── feature/login
    ├── feature/clientes
    ├── feature/dashboard
    └── feature/sync
```

Para comenzar una nueva funcionalidad:

```powershell
git switch develop
git pull
git switch -c feature/nombre-funcionalidad
```

Después de realizar cambios:

```powershell
git add .
git commit -m "feat: descripcion del cambio"
git push -u origin feature/nombre-funcionalidad
```

