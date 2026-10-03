# Proyecto Darrian — Editor de páginas de evento por bloques

> Documento vivo. Línea de trabajo **paralela** a las mejoras de la plataforma.
> Estado: **propuesta** (2026-10-03). Nada implementado todavía.

## 1. Objetivo

Que cada promotor diseñe la página pública de su evento **sin saber de diseño ni de
código**: una lista de bloques (portada, entradas, line-up, galería, preguntas frecuentes…)
que se **arrastran**, se **reordenan** y se **configuran** en un panel lateral, viendo el
resultado al momento en móvil y escritorio.

Principio rector: **libertad con barandillas**. El promotor elige y ordena bloques y un
tema visual; no coloca píxeles libremente. Así cualquier combinación se ve bien, carga
rápido en el móvil y no rompe la compra.

## 2. Qué existe hoy y qué cambia

Hoy la ficha del evento (`web-compra/app/[slug]/event/[eventId]`) es un diseño fijo:
imagen, datos, selector de entradas, descripción y condiciones. Darrian lo sustituye **por
evento y de forma opcional**:

- Un evento sin página Darrian sigue usando la ficha actual (que pasará a ser la
  plantilla «Clásica»).
- Un evento con página Darrian publicada se pinta con sus bloques.

Así ambas líneas avanzan en paralelo sin pisarse.

## 3. Opciones para el motor del editor

| Opción | Qué es | A favor | En contra | Viabilidad |
|---|---|---|---|---|
| **A. Puck** (recomendada) | Editor visual de código abierto para React (licencia MIT): defines tus componentes y sus campos, y Puck da el lienzo de arrastrar y soltar, el panel de propiedades y guarda **JSON** | Encaja con el stack (React/Next); los bloques son **nuestros componentes**; datos en nuestra BD; ahorra semanas de editor | Dependencia externa (mitigable: el JSON es nuestro y el renderizado también); hay que adaptar su interfaz al estilo de la consola | **Alta** |
| B. Editor propio con dnd-kit | Construir el editor con `@dnd-kit` (librería de arrastrar y soltar estándar en React, accesible por teclado) | Control total de la experiencia | Más trabajo: lienzo, selección, panel, deshacer/rehacer, previsualización… | Alta, pero ~2–3× más esfuerzo |
| C. GrapesJS | Editor web genérico que produce **HTML/CSS** | Muy completo y maduro | Genera HTML libre: difícil integrar bloques vivos (entradas, plano) y **peligroso** en una web donde se paga (XSS) | Baja para este caso |
| D. Builder.io / Plasmic (SaaS) | Constructores visuales de pago | Rapidísimo de arrancar | Coste por uso, datos fuera, dependencia del proveedor, multi-tenant complejo | Baja |

**Recomendación:** A (Puck). Si en la prueba inicial no encaja, plan B (dnd-kit): el
catálogo de bloques, el JSON y el renderizado se diseñan igual en ambos casos, así que
cambiar de motor no tira el trabajo.

## 4. Catálogo de bloques

**Imprescindibles (conectados a los datos del evento)**
- **Portada (hero):** imagen o vídeo de fondo, título, fecha, recinto y botón «Comprar».
  Variantes: imagen completa, partida, solo texto.
- **Entradas:** el selector actual (cantidades o plano de asientos, contador de reserva y
  pago). **Obligatorio y no se puede borrar**: garantiza que siempre se pueda comprar.
- **Información práctica:** fecha, puertas, recinto, mapa, edad mínima.
- **Botón de compra fijo** en el móvil.
- **Cuenta atrás** hasta el evento o hasta el fin del precio anticipado.

**Contenido**
- Texto enriquecido, imagen, galería, vídeo (YouTube/Vimeo), cita/testimonio, separador.
- **Preguntas frecuentes** (acordeón).
- **Columnas** (2–3) para combinar bloques sencillos.

**Específicos de eventos**
- **Line-up / artistas:** foto, nombre, bio, redes y hora de actuación.
- **Programa / horario:** línea de tiempo por escenarios o franjas.
- **Patrocinadores:** rejilla de logos.
- **Música:** reproductor de Spotify, Apple Music o SoundCloud.
- **Cómo llegar:** transporte, parking, accesibilidad.
- **Condiciones:** política de devoluciones y normas.
- **Organizador:** perfil del promotor y otros eventos suyos.
- *(Futuro)* Lista de espera / newsletter, alojamiento cercano, merchandising.

Cada bloque tiene **variantes de diseño** predefinidas (en lugar de decenas de ajustes
sueltos) y opciones comunes: fondo (normal/destacado/imagen), espaciado y «ocultar en
móvil/escritorio».

## 5. Diseño visual (tema)

- **Paletas** predefinidas + el color de marca del perfil del promotor. Contraste
  comprobado automáticamente (accesibilidad).
- **Tipografías:** 6–8 combinaciones curadas (título + texto), no cualquier fuente.
- **Estilo:** botones redondeados/rectos, modo claro/oscuro, densidad.
- **Plantillas de inicio** rellenadas con los datos del evento: Concierto, Festival,
  Teatro, Conferencia, Fiesta y Clásica (la actual).

## 6. Gestión (para que sea fácil)

- **Borrador y publicado:** se edita sin tocar la página en vivo; «Publicar» la sustituye.
- **Guardado automático**, deshacer/rehacer e **historial de versiones** con restaurar.
- **Vista previa** móvil/escritorio y enlace de vista previa privado.
- **Comprobaciones antes de publicar:** imágenes sin texto alternativo, bloques vacíos,
  bloque de entradas presente.
- **Reutilizar:** duplicar la página de otro evento o guardarla como plantilla propia.
- *(Futuro)* **Asistente con IA**: «crea mi página a partir de la descripción y el cartel».

## 7. Arquitectura propuesta

- **Paquete compartido `packages/darrian`:** registro de bloques. Cada bloque declara su
  tipo, **versión**, esquema de propiedades (validado con zod), valores por defecto,
  campos del editor y componente de renderizado. Lo usan la consola (editor) y la tienda
  (renderizado), así que nunca se desincronizan.
- **Datos:** tabla `event_page` (evento, borrador JSON, publicado JSON, tema, versión) +
  `event_page_version` (historial) + `page_template`. Con `tenant_id` y RLS como el resto.
- **API:** guardar borrador, publicar, versiones, plantillas. El servidor **valida el
  JSON** contra los esquemas de bloque (y limita tamaño y número de bloques).
- **Renderizado en la tienda:** bloques estáticos en el servidor (rápidos y buenos para
  SEO); solo los vivos (entradas, cuenta atrás, plano) se hidratan en el navegador.
- **SEO y redes:** metadatos y datos estructurados `Event` de schema.org (JSON-LD), que
  Google usa para mostrar eventos.
- **Imágenes:** el módulo de subidas actual (`uploads`).

## 8. Seguridad (no negociable)

La página de evento es donde se paga, así que:

- **Nada de HTML, CSS ni JavaScript libre** del promotor. El texto enriquecido se guarda
  como estructura (no HTML) o se sanea con lista blanca.
- **Vídeos y reproductores solo de una lista de servicios permitidos**; la URL del embed
  la construimos nosotros a partir del enlace (nunca un `<iframe>` pegado), más una
  política CSP `frame-src`.
- Validación del JSON en el servidor y límites de tamaño.

## 9. Fases y esfuerzo estimado

| Fase | Contenido | Esfuerzo (sesiones como las de hoy) |
|---|---|---|
| **0. Prueba técnica** | Puck con 3 bloques (portada, texto, entradas) + renderizado en la tienda; decidir motor | 1 |
| **0b. Preparación** | Extraer el selector de entradas/pago de `EventClient` (780 líneas) a componentes reutilizables; necesario para el bloque «Entradas» y mejora el código actual | 1 |
| **1. MVP** | Modelo + API borrador/publicar, ~10 bloques, tema básico, editor con arrastrar y panel, vista previa, publicar | 3–5 |
| **2. Completo** | Plantillas, historial/deshacer, resto de bloques, JSON-LD, duplicar/plantillas propias | 3–4 |
| **3. Avanzado** | Columnas anidadas, multi-idioma, analítica por bloque, asistente IA, misma herramienta para la página del promotor | a definir |

## 10. Riesgos

- **Crecer sin control** («hagamos un Wix»): mantener las barandillas y el catálogo curado.
- **Compatibilidad**: al cambiar un bloque, las páginas guardadas deben seguir
  funcionando → bloques versionados con migraciones de su JSON.
- **Rendimiento en móvil** con muchos bloques e incrustados → carga diferida.
- **Trabajo en paralelo**: el proyecto **no está bajo control de versiones (git)**.
  Antes de empezar conviene inicializarlo y desarrollar Darrian en su propia rama.

## 11. Decisiones pendientes

1. Motor: Puck (recomendado) o editor propio.
2. Nivel de libertad: bloques + tema con barandillas (recomendado) o posicionamiento libre.
3. ¿Solo página de evento o también la página del promotor con el mismo motor?
4. ¿Se permite algún día CSS/HTML propio («modo avanzado»)? Recomendación: no.
