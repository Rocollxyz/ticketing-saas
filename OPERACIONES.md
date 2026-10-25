# Operación en producción: seguridad, vulnerabilidades y defensa

> Qué vigilar y hacer con la plataforma en producción y eventos activos (acordado
> 2026-10-25). Lo que aún no existe está marcado con ⏳ y apuntado en PENDIENTES.md.

## 1. Vigilancia continua (alertas automáticas ⏳)

**Dinero**
| Señal | Posible causa |
|---|---|
| Cobro sin plaza (`order.refund_required` en `outbox`) | Fallo en reservas/pagos: revisar cada caso |
| Devoluciones `FAILED` acumuladas | Problema con la pasarela; comprador sin su dinero |
| Webhooks con firma inválida | Alguien suplanta a Stripe/Redsys |
| Importe cobrado ≠ pedido (log «no se emite») | Manipulación (ya bloqueada) |
| Muchos pagos rechazados seguidos | *Card testing* con tarjetas robadas |
| Contracargos | Fraude o reventa |

**Ataques y abusos**
| Señal | Posible causa |
|---|---|
| Pico de 429 (límite de peticiones) | Bots o fuerza bruta |
| Logins fallidos en consola/admin | Robo de cuentas |
| Reservas masivas sin pagar | Bots bloqueando aforo |
| Pico de escaneos DUPLICATE/INVALID | QR copiados o falsificados |

**Salud técnica**: `/health` de la API y las webs; Postgres (conexiones, disco, lentitud);
`outbox` pendiente creciendo (emails, facturas, devoluciones atascados); sweeper de
reservas; caducidad del certificado HTTPS y del dominio.

## 2. Antes de una salida a la venta importante
- Avisar al equipo técnico (fecha y hora).
- Prueba de carga si se esperan miles de compradores a la vez.
- CDN/WAF delante (p. ej. Cloudflare) y límites de peticiones más estrictos; cola virtual ⏳.
- Límite de entradas por persona ⏳ y vigilancia de compras sospechosas.
- Stripe Radar activo.

## 3. El día del evento
- App de acceso: móviles cargados, manifest descargado (sin conexión), solo porteros.
- Vigilar rechazos por puerta (pico de «ya usada» = QR copiados).
- Al terminar: cerrar sesión en los móviles y comprobar que se sincronizó todo lo escaneado offline.
- Plan B: validación manual con la lista de asistentes.

## 4. Cada semana
- `npm audit` y parches de seguridad (automático con GitHub cuando el repo esté allí).
- Actualizaciones del sistema operativo e imágenes Docker (Postgres, Redis).
- Revisar logs: accesos raros al admin de plataforma, errores repetidos.

## 5. Cada mes
- **Probar a restaurar una copia de seguridad.**
- Revisar accesos: usuarios de promotores, porteros que ya no trabajan, claves de API.
- Revisar contracargos y devoluciones.
- Comprobar el borrado automático de datos personales (RGPD).

## 6. Cada año o al cambiar algo importante
- Rotar secretos: `JWT_SECRET`, claves de Stripe/Redsys, contraseñas de BD. La
  `MASTER_KEY` con procedimiento propio (si se pierde o cambia mal, los QR dejan de validar).
- Auditoría externa (pentest), sobre todo antes de crecer.
- Repasar SECURITY_AUDIT.md entero.

## 7. Plan de incidentes
| Situación | Qué hacer |
|---|---|
| Ataque o fallo durante una venta | Parar ventas: de un evento, cerrándolo; de toda la plataforma, interruptor general ⏳ |
| Fuga de datos personales | RGPD: avisar a la AEPD en 72 h y, según el caso, a los afectados. El promotor es el responsable: avisarle |
| Cuenta de promotor robada | Bloquearla, cerrar sesiones, revisar su historial de cambios |
| Clave de firma de QR comprometida | Rotar la clave del evento y reemitir las entradas |
| Caída de la pasarela | Aviso en la tienda y, si hay alternativa, activar la otra pasarela |
