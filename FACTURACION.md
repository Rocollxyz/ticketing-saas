# Facturación e IVA de las entradas

> Cómo factura la plataforma y por qué. Pensado para revisarlo con la gestoría: todo lo
> marcado como **decisión** se puede cambiar. Estado a 2026-10-04.

## Modelo: quién factura

- **Vende el promotor.** La plataforma intermedia en su nombre, así que las facturas de las
  entradas las emite **el promotor** con sus datos fiscales (pestaña «Facturación» de la
  consola). Es el modelo habitual en el sector: el organizador es el responsable fiscal
  de la entrada y la plataforma solo factura sus comisiones. *(Decisión.)*
- Hoy la plataforma no cobra comisiones ni gastos de gestión. Cuando lo haga, tributarán
  al **21 %** como servicio de intermediación y la plataforma tendrá que facturárselos al
  promotor (o al comprador si se cobran como gastos de gestión, que deben mostrarse
  desglosados antes de pagar). Está pendiente.

## Tipo de IVA

- **10 %** por defecto: entradas a teatros, conciertos y demás espectáculos culturales en
  vivo (art. 91.Uno.2.6º de la Ley 37/1992), y también competiciones deportivas.
- **21 %** para lo que no es la entrada en sí (parking, merchandising, consumiciones).
- **Exenta** con motivo obligatorio, que sale impreso en la factura (p. ej. servicios
  culturales de entidades públicas o culturales sin ánimo de lucro, art. 20.Uno.14º).
- **Canarias:** el promotor elige IGIC en sus datos fiscales; el tipo se escoge igual.
- Se configura **por tipo de entrada**. Los precios se muestran siempre con el impuesto
  incluido (obligatorio con consumidores); la base y la cuota se calculan al facturar.

## Qué factura se emite

| Caso | Factura | Tipo VERI*FACTU |
|---|---|---|
| Compra normal (hasta 400 € con IVA) | Simplificada, serie `T2026-…` | F2 |
| El comprador da sus datos (empresa o autónomo) | Completa, serie `F2026-…` | F1 |
| Compra de más de 400 € | **Completa obligatoria**: la tienda exige los datos | F1 |
| El comprador pide la completa después | Completa que sustituye a la simplificada (canje) | F3 |
| Devolución (total o parcial) | Rectificativa por diferencias, serie `R2026-…` | R5 si rectifica una simplificada, R1 si rectifica una completa |
| Invitación o entrada gratuita | Ninguna (no hay contraprestación) | — |

- **Límite de 400 €:** el art. 4 del RD 1619/2012 eleva el límite a 3.000 € solo para una
  lista cerrada de actividades, y las entradas a espectáculos no están en ella.
- **Rectificativas:** van en serie propia (arts. 6 y 15 del RD 1619/2012) e indican la
  factura que rectifican. Se emiten solas cuando se completa una devolución (online, al
  confirmarla Stripe; en taquilla, al marcarla como devuelta).
- **Cuándo se emite:** al cobrar (las entradas se pagan por adelantado, así que el IVA se
  devenga en el cobro). Se envía en PDF al comprador.
- **Sin datos fiscales** no se emite nada: las ventas quedan «pendientes de factura» y el
  promotor las emite desde la consola al completarlos. Las devoluciones que hubo mientras
  tanto generan su rectificativa en ese momento.

## Requisitos técnicos ya cubiertos

- **Numeración correlativa sin huecos** por serie y año, con contador bloqueado al emitir.
- **Inalterabilidad:** la base de datos no permite a la API modificar ni borrar facturas;
  una corrección siempre es otra factura.
- **Registro encadenado con huella SHA-256** según la especificación de la AEAT para
  VERI*FACTU (8 campos, huella del registro anterior y fecha y hora con huso horario).
  Comprobado con el ejemplo oficial de la AEAT y verificable de punta a punta.
- **Libro registro de facturas expedidas** en CSV (una fila por factura y tipo de IVA),
  para la gestoría y el modelo 303.
- Validación de NIF, NIE y CIF (y NIF-IVA europeo en las facturas completas).

## Pendiente (antes de que sea obligatorio)

- **VERI*FACTU** es obligatorio desde el **1-1-2027** para sociedades y desde el
  **1-7-2027** para autónomos (Real Decreto-ley 15/2025). Falta:
  - enviar cada registro a la AEAT (alta y anulación) con certificado electrónico, o bien
    el modo «no VERI*FACTU», que exige firma electrónica y registro de eventos;
  - el **código QR** de cotejo y la leyenda «VERI*FACTU» en cada factura (no se imprimen
    hasta que el envío funcione, para no inducir a error);
  - la **declaración responsable** del sistema informático de facturación.
- **TicketBAI** (País Vasco) y **SII** (grandes empresas) tienen sistemas propios: si
  hay promotores allí, habrá que tratarlos aparte.
- La taquilla no pide datos para factura completa (por encima de 400 € avisa la consola
  y se canjea después).
- El comprador no puede pedir por sí mismo la factura completa después de comprar: lo
  hace el promotor (canje). Llegará con el área del comprador.
