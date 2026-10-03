# Proyecto Raquel — Motor de creación de mapas de asientos

> Documento vivo. Línea de trabajo **paralela** (como [Darrian](DARRIAN.md)).
> Estado: **decidido, pendiente de empezar** (2026-10-03). Rama git: `raquel`.

## 1. Objetivo

Que el promotor dibuje el plano real de su recinto —**filas rectas y curvas, anfiteatros,
palcos, mesas, gradas, zonas de pie**— de forma **fácil e intuitiva**: un lienzo vacío
donde arrastra piezas, las ajusta con tiradores y asigna precios pintando por colores.

## 2. Punto de partida

Hoy el plano es una **rejilla de celdas enteras** (`seat.pos_x/pos_y`): cada asiento ocupa
una casilla. Sirve para un ejemplo, pero no para una curva, un palco ni una mesa redonda.

Lo que **se conserva**: la tabla `seat` sigue siendo la fuente de verdad de la venta, con la
anti-sobreventa por asiento, la reserva con contador y el tiempo real. Raquel es la capa de
**diseño** que **genera** esos asientos; no cambia cómo se venden.

## 3. La idea clave: generadores, no asientos sueltos

Colocar 800 butacas de una en una no es «fácil e intuitivo». El promotor coloca **piezas**
y cada pieza **genera** sus asientos:

| Pieza | Qué genera | Ajustes |
|---|---|---|
| **Fila** | N asientos en línea | número, separación, recta o **curva** (arrastrando el centro) |
| **Bloque / sección** | filas × asientos | curvatura, desplazamiento entre filas («al tresbolillo»), pasillos |
| **Anfiteatro** | filas en **arcos concéntricos** | radio, ángulo de apertura, filas, crecimiento por fila |
| **Mesa** | mesa redonda o rectangular con sillas alrededor | nº de sillas, venta por silla o mesa entera |
| **Palco** | grupo pequeño con nombre propio | asientos, «se vende entero» |
| **Zona de pie** | polígono con aforo (sin asientos) | aforo → usa la entrada general que ya existe |
| **Elementos** | escenario, barra, pasillo, puerta, aseos, texto, forma | color, etiqueta (no se venden) |

Todo pieza se puede **mover, girar, duplicar, alinear y borrar**; con zoom, desplazamiento,
selección múltiple (arrastrar un rectángulo), **ajuste a rejilla**, deshacer/rehacer.

**Fondo de calco:** subir una foto o PDF del plano del recinto y dibujar encima (la forma
más rápida de reproducir un recinto real).

## 4. Numeración y precios (donde suele doler)

- **Numeración automática** por fila: letras o números, con el sentido elegido, y la
  convención habitual de los teatros españoles **impares a un lado y pares al otro**.
  Prefijos por sección («Platea», «Anfiteatro», «Palco 3»).
- **Precios pintando:** se elige una categoría (cada una con su color) y se «pinta» con la
  brocha o seleccionando asientos, filas o secciones enteras. Leyenda de colores siempre
  visible.
- **Atributos de asiento:** silla de ruedas / acompañante, visibilidad reducida, asiento
  **bloqueado** (protocolo, producción, prensa) que no sale a la venta.
- **Validación:** asientos repetidos o superpuestos, sin categoría, filas sin nombre.

## 5. Recintos reutilizables y venta mixta

- El plano pertenece al **recinto** (una sala se dibuja una vez). Cada evento hace una
  **copia** en la que puede cambiar precios, bloquear asientos o retocar sin afectar al
  original. Varias configuraciones por sala («con pista», «todo sentado»).
- **Venta mixta:** pista de pie + gradas numeradas en el mismo plano (lo normal en
  conciertos). Hoy un evento es *o* numerado *o* general; Raquel añade el modo **mixto**.

## 6. Lo que ve el comprador

- El mismo plano con colores por precio, **zoom con los dedos** en el móvil y disponibilidad
  **en vivo** (ya existe).
- En recintos grandes: primero las **secciones**, al acercarse los asientos.
- **«Mejor disponible»**: el comprador pide N entradas de una categoría y el sistema elige
  asientos juntos, sin tener que buscarlos en el plano. También es la alternativa accesible
  para quien no puede usar un plano visual.

## 7. Opciones de tecnología

| Opción | Qué es | A favor | En contra | Viabilidad |
|---|---|---|---|---|
| **A. Konva** (react-konva) — recomendada | Librería de dibujo sobre *canvas* para React, MIT | Pensada para editores (selección, tiradores de girar/escalar, arrastrar); maneja 10.000+ elementos optimizada; gratis | Hay que construir encima toda la lógica de piezas y numeración (que de todas formas es nuestra) | **Alta** |
| B. SVG propio | Dibujar con SVG y React | Simple, nítido, accesible | Se vuelve lento al editar varios miles de asientos | Alta hasta ~3.000 asientos |
| C. PixiJS (WebGL) | Motor gráfico de alto rendimiento | Estadios de 50.000+ asientos | Muy bajo nivel para la parte de edición | Para una fase posterior (solo vista del comprador) |
| D. tldraw | Lienzo infinito con muy buena experiencia | Interfaz excelente | Desde la v4 (sept. 2025) el uso comercial exige **licencia de pago** (≈6.000 $/año) | Baja |
| E. Comprar: **seats.io** | El servicio de planos de referencia del sector (diseñador + vista + bloqueos) | Listo ya, muy completo | **Pago por asiento vendido**, datos y plano fuera de la plataforma, dependencia total en la pieza central de la venta | Posible, pero contrario al producto |

**Recomendación:** **Konva** para el editor y la vista del comprador, con el **modelo de datos y
los generadores propios** (en un paquete `packages/raquel`, independiente de la librería de
dibujo). seats.io sirve como **referencia de funcionalidades**, no como dependencia: el plano
es el corazón de una ticketera.

## 8. Arquitectura propuesta

- **`packages/raquel`**: modelo del plano (piezas con sus parámetros, en coordenadas
  decimales con giro), **generadores** puros (pieza → asientos con posición y etiqueta),
  numeración y validación. Sin interfaz: se prueba con tests y lo usan la consola, la tienda
  y la API.
- **Datos**: `venue_map` (plano del recinto, JSON versionado) y `event_map` (copia por
  evento). Al **publicar** el plano, se «compila» a filas de `seat` con un identificador
  estable por asiento (sección+fila+número) para poder re-publicar sin perder ventas.
- **Reglas de cambios con ventas** (ya existen para el editor actual): un asiento vendido o
  reservado no se puede borrar ni mover de sección; sí recolorear la parte no vendida.
- **Cambios en `seat`**: posición decimal, giro, sección, atributos (accesible, bloqueado…).
  La rejilla actual se migra a piezas «fila».
- **Darrian**: su bloque «Entradas» pintará los planos de Raquel.

## 9. Fases y esfuerzo estimado

| Fase | Contenido | Esfuerzo (sesiones) |
|---|---|---|
| **0. Prueba técnica** | Konva: generador de fila recta/curva, arrastrar y girar, prueba de rendimiento con 5.000 asientos en editor y en móvil | 1–2 |
| **1. MVP** | Lienzo con zoom; piezas fila, bloque y anfiteatro; escenario y textos; numeración (incl. pares/impares); pintar precios; fondo de calco; publicar → `seat`; vista del comprador con zoom | 4–6 |
| **2. Completo** | Mesas, palcos, zonas de pie (**venta mixta**), atributos de asiento, recintos reutilizables con copias por evento, plantillas (teatro, auditorio, sala de conciertos, banquete) | 4–5 |
| **3. Grandes recintos** | Vista por secciones, «mejor disponible», WebGL para estadios, vista desde el asiento | a definir |

## 10. Riesgos

- **Rendimiento en móviles modestos** con miles de asientos → prueba en la fase 0.
- **Re-publicar un plano con ventas** sin perder ni duplicar asientos → identificadores
  estables y reglas estrictas (fase 1, con tests).
- **Usabilidad**: es la parte más difícil de acertar. Conviene probar con un promotor real
  pronto (fin de la fase 1).
- Mismo aviso que Darrian: el proyecto **no está en git**; hay que inicializarlo antes de
  llevar líneas en paralelo.

## 11. Decisiones (tomadas el 2026-10-03)

1. **Motor de dibujo: Konva** (react-konva).
2. **Recintos propios del promotor:** cada promotor crea sus recintos con su plano y los
   guarda para reutilizarlos; cada evento usa una copia que puede retocar.
3. **Venta mixta** (pista de pie + gradas numeradas): **fase 2**.
4. **Mesas: de las dos formas** — por silla o por mesa entera, a elección del promotor.
