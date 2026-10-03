import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carga el `.env` de la raíz del monorepo en dev. Se importa PRIMERO en main.ts
 * para que las variables existan antes de evaluar módulos que las leen al importar
 * (p.ej. el cliente de BD). En prod las variables llegan del entorno y no hay fichero.
 */
const envPath = resolve(__dirname, "../../../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
