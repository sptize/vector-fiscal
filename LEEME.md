# Mi Vector Fiscal (PWA)

App sencilla para llevar tus pagos a la ONAT y que no se te pase ninguno.

## Cómo publicarla (GitHub Pages)
1. Crea un repositorio y sube **todos** los archivos de esta carpeta a la raíz.
2. En Settings → Pages, elige la rama `main` y la carpeta `/ (root)`.
3. Abre la dirección que te da GitHub desde el teléfono (Chrome) y usa «Instalar app» / «Agregar a pantalla de inicio».
4. Dentro de la app, toca **Activar avisos** y acepta el permiso.

Funciona sin internet una vez abierta la primera vez. Tus datos se guardan solo en tu teléfono.

## Primer uso
1. **Ajustes**: pon el código RC-04A (5 dígitos, segunda columna de tu vector fiscal) de cada pago, el monto de la seguridad social y el día límite que dice tu hoja.
2. **10% y 5%**: anota lo que pagas del 10% (no tus ingresos). La app deduce tus ingresos (el 10% es una décima parte) y te dice cuánto toca del 5%: por ejemplo 300 → 0; 380 → 27; 392 → 33 (se descuentan 3 260 de ingresos al mes).
3. **Pagos**: cuando pagues, toca «Ya pagué», pega el mensaje de Transfermóvil (con el código de la transferencia) y guarda. Ese pago deja de avisarte. El mensaje queda en **Historial**.

## Resumen del año
En la pestaña **Resumen** elige el año y toca «Imprimir o guardar como PDF». Sale una hoja con el total pagado por mes, los recargos y el detalle de cada pago con su mensaje de Transfermóvil.

## Avisos
Salen 2 días antes, 1 día antes, el mismo día y, si ya venció, cada día hasta que lo marques pagado.
Una web instalada solo puede avisar con la app cerrada en Android/Chrome (el sistema decide cada cuánto la despierta). Para tener un respaldo seguro, en **Ajustes** descarga los recordatorios para el calendario del teléfono.

## Importante
- Verifica los datos de ejemplo (día límite 10, mínimo exento de 3 260 CUP en el 5%) con tu vector fiscal; son editables.
- Guarda un respaldo de vez en cuando (Ajustes → Guardar respaldo).
