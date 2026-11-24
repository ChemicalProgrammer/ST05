# Caso E — importación JSON como borrador

## Archivo y alcance

`examples/case-e.configuration.json` usa el contrato existente
`st-line-configuration-v1` y la opción explícita `importMode: "DRAFT"`.
Es una configuración editable de los nueve elementos documentados en
[CASE_E_DATA.md](CASE_E_DATA.md), no una corrida validada ni una mejora CAPEX.

El archivo anterior, con `schema: "st-documented-case-transcription-v1"`, era una
transcripción documental. Ese formato no pertenece al importador de configuración
y no se incorpora como alias: los datos se convierten a los campos reales del modelo.

## Contrato de borrador

- La importación normal conserva la validación física estricta.
- Un borrador debe declarar el esquema canónico, `importMode: "DRAFT"` y una
  configuración de corrida completa. No mezcla su corrida con los parámetros de
  la simulación que estaba seleccionada.
- Se conservan los controles de estructura, nombres, identificadores, topología,
  tasas nominales, confiabilidad, tipos y parámetros de corrida. Los valores
  físicos declarados deben tener tipos y rangos básicos válidos.
- Sólo se difieren errores de geometría física de acumulación que necesitan
  completar datos o revisar relaciones entre parámetros. Se muestran en el área
  de mensajes existente antes de aplicar el archivo.
- Importar el borrador permite editarlo y guardarlo. El motor sigue aplicando la
  misma validación física completa antes de ejecutar; la búsqueda CAPEX sigue
  requiriendo resultados numéricos completos y vigentes.
- La identidad y el nombre del caso abierto se conservan. Para trabajar con este
  caso independiente, crear un caso vacío llamado **Caso E** y después importar
  el JSON en **Line Setup → Import JSON → Validate and Apply**.

## Fidelidad de los datos

Se mantienen nombres, orden, velocidades publicadas, MTBF/MTTR generales,
geometría, tiempos de arranque/rampa y parámetros de sensores. No se inventa un
desglose de paros minor/major. Los conveyors conservan la hipótesis de ausencia
de fallas propias empleada por el importador de Sheets.

El parser existente de Sheets genera los campos del modelo. La tasa nominal de
cada conveyor hereda la referencia de su máquina anterior cuando la fuente no
aporta una tasa; esto no constituye una velocidad física medida de la banda.
La procedencia y los valores originales se guardan en
`processData.sourceEvidence` para sobrevivir a la importación y al guardado.

Pace se representa provisionalmente como `CUSTOM`, manteniendo su nombre.
Filler/Capper es la única máquina crítica. Las 12 botellas por caja se conservan
como dato documental; no se activa una conversión física sin confirmar la base
de velocidad del Case Packer/Palletizer y el significado de los paquetes.

El archivo propone un día y una ronda como ajustes iniciales de trabajo; la
fuente corresponde a 43,200 minutos. Ese preajuste no reproduce ni valida el
período mensual. Los agregados de downtime, UPDT y rate loss quedan como datos
de referencia, sin convertirse en eventos que duplicarían pérdidas.

## Pendientes físicos comprobados

| Tramo | Dato conservado | Resultado del modelo actual |
| --- | --- | --- |
| ETI - FIL | Siete campos de Speed & Sensors no visibles en la fuente; se conservan como `null` | El factor de descarga faltante impide resolver velocidad, pitch y Back-up. |
| FIL-EMP | Lact = 2,000 mm; Lp = 1,999 mm | Prime = 1 mm; Back-up automático = 1,243.5625 mm, posterior a Prime. |
| EMP-PAL | Lact = 8,430 mm; Lp = 7,700 mm | Prime = 730 mm; Back-up automático = 952.75 mm, posterior a Prime, sin conversión de empaque. |

Los valores de Back-up son cálculos del motor con las entradas documentadas,
no posiciones de sensores medidas. Se conserva además la observación sobre
infeed pitches de 120 y 125 mm frente a paquete de 130 mm.

No se cambian longitudes, posiciones ni factores para eliminar los avisos.
Cuando se completen o concilien los datos, una nueva ejecución del validador
determinará si la configuración puede simularse.

## Despliegue

Actualizar **`apps-script/ConfigurationEditor.html`** y
**`apps-script/Language.html`**. No cambia el motor ni la
distribución de tarjetas. La documentación y el JSON de ejemplo no se copian a
Apps Script. Tras actualizar la implementación, recargar la aplicación antes
de importar el nuevo archivo.
