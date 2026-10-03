# Líneas de trabajo

Tres líneas en paralelo, cada una en su rama y en su propia carpeta (git worktree), para
abrirlas a la vez sin cambiar de rama.

| Línea | Rama | Carpeta | Qué es | Destino |
|---|---|---|---|---|
| **Plataforma** | `main` | `~/vscode/ticket` | El sistema actual: venta, gestión, taquilla, acceso, admin | **Producción** (con su propio sistema de despliegue) |
| **Darrian** | `darrian` | `~/vscode/ticket-darrian` | Editor por bloques de la página de cada evento ([DARRIAN.md](DARRIAN.md)) | Se integrará cuando esté madura |
| **Raquel** | `raquel` | `~/vscode/ticket-raquel` | Editor de planos de asientos ([RAQUEL.md](RAQUEL.md)) | Se integrará cuando esté madura |

## Reglas

1. **`main` es la prioridad** y lo único que llega a producción. Nunca recibe trabajo a medias
   de Darrian o Raquel.
2. **Darrian y Raquel se desarrollan como laboratorios aislados**: un paquete propio
   (`packages/darrian`, `packages/raquel`) y una web de pruebas propia en su puerto. **No
   modifican las apps de `main`**, para que integrarlas después sea «enchufar el paquete».
3. **Las mejoras de `main` llegan a las ramas laterales** con `git merge main` cuando
   convenga (sobre todo antes de integrar), para que no se queden atrás.
4. **Integración** de una línea lateral: solo cuando esté madura y probada, con una
   decisión explícita sobre cómo introducirla (p.ej. activable por evento o por promotor).

## Puertos

| Puerto | Uso |
|---|---|
| 3000 | API (`main`) |
| 3001 / 3002 / 3004 / 3005 | Webs de compra / gestión / taquilla / admin (`main`) |
| 3010 | Laboratorio de Darrian |
| 3011 | Laboratorio de Raquel |

Los laboratorios pueden leer datos reales de la API de `main` (puerto 3000) cuando haga
falta; la base de datos y Redis de Docker son compartidos.

## Notas

- Cada carpeta tiene sus propias dependencias (`npm ci` dentro de cada una).
- `.env` no se versiona: solo existe en la carpeta de `main`. Si alguna vez hiciera falta
  arrancar la API desde otra carpeta, se copia a mano.
- Repositorio solo **local** de momento (sin remoto). Conviene añadir un remoto privado
  (GitHub, GitLab…) como copia de seguridad.
