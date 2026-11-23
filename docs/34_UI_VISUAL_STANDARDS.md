# Guía de interfaz de SimuLine

Esta guía aplica a las pantallas, diálogos y gráficas de Apps Script, en Basic y Advance. Antes de crear un control, busca un componente equivalente. Usa [DesignTokens.html](../apps-script/DesignTokens.html) para los valores compartidos, [UiStandards.html](../apps-script/UiStandards.html) para las reglas transversales y el módulo de estilos de cada pantalla para su distribución.

## Tipografía

La escala objetivo tiene **cinco tamaños**. Los valores están expresados en `rem`, con equivalencia en píxeles para una raíz de 16 px al 100 %. El tamaño normal ocupa el centro. Básico y avanzado usan los mismos niveles. La preferencia de escala se aplica una sola vez en la raíz del documento.

| Nivel | Tamaño base | Uso |
| --- | --- | --- |
| 1 | 11 px · 0.6875 rem | Pies, marcas secundarias y leyendas compactas |
| 2 | 12 px · 0.75 rem | Ayuda, notas y etiquetas secundarias |
| 3 · Normal | 14 px · 0.875 rem | Cuerpo, etiquetas, botones, inputs y celdas |
| 4 | 18 px · 1.125 rem | Subtítulos, encabezados de tarjetas y títulos de diálogo |
| 5 | 24 px · 1.5 rem | Título principal y cifras KPI destacadas |

Usa `--font-ui` en la interfaz y `--font-mono` para código o JSON. Distingue jerarquías del mismo tamaño con peso, color semántico o posición. Usa 400 para cuerpo, 500 para controles, 600 para encabezados y 700 para énfasis. Usa interlineado 1.5 para texto y 1.25 para títulos. Alinea valores numéricos a la derecha y usa cifras tabulares. Los alias por rol pueden compartir nivel. Toda migración debe mapear el componente a estos cinco niveles sin añadir tamaños locales.

## Espaciado

| Relación | Espacio base | Aplicación |
| --- | --- | --- |
| Entre secciones principales | 24 px · `--space-6` | Un único `gap` o margen lógico del contenedor |
| Entre Subsecciones | `--workspace-gutter` (24 px; 12 px en pantallas estrechas) | Mismo token que los márgenes superior y laterales |
| Encabezado a contenido | 12 px · `--space-3` | Dentro de una misma sección |
| Entre controles del mismo grupo | 12 px · `--space-3` | Filas y grillas |
| Etiqueta a campo o checkbox | 8 px · `--space-2` | Controles verticales o en línea |
| Icono y texto estrechamente relacionados | 4 px · `--space-1` | Elementos compactos |
| Interior de tarjeta o panel | 20 px · `--space-5` | 12 px en pantallas estrechas |
| Interior de diálogos | 20 px · `--space-5` | 12 px en pantallas estrechas |
| Celda de tabla | 8 px vertical · 12 px horizontal | Usa un contenedor con desplazamiento para tablas anchas |
| Margen lateral de página | 24 px · `--space-6` | 12 px en pantallas estrechas |

Prefiere `gap` en grillas y contenedores flexibles. Usa márgenes lógicos para bloques independientes y padding para interiores. Quita márgenes duplicados del primer y último hijo cuando el contenedor ya aporta espacio. Un bloque oculto o vacío debe ceder su espacio. Reutiliza la altura de controles, los radios y los bordes del sistema.

## Componente reutilizable: Subsección (Subsection)

**Nombre oficial: «Subsección».** En solicitudes y revisiones de interfaz, «Subsección» se refiere al bloque reutilizable, habitualmente plegable, compuesto por el recuadro, encabezado, control de expandir/colapsar, barra de herramientas y contenido. **No** significa una pestaña ni una sección principal de navegación.

| Parte | Selector / componente | Función |
| --- | --- | --- |
| Recuadro | `.fold-card` | Superficie, borde, padding interior y ritmo exterior |
| Variante nativa | `.fold-card.fold-native` | Misma Subsección utilizando `<details>` y `<summary>` |
| Encabezado | `.fold-heading` o `.fold-native > summary` | Título, estado, descripción y herramientas |
| Colapso | `.fold-toggle` y `data-subsection-toggle` | Activación accesible de la Subsección |
| Herramientas | `.fold-tools` | Botones/iconos alineados a la derecha |
| Contenido | `.fold-content` | Contenedor con separación uniforme respecto al encabezado |

### Constructor con parámetros

La implementación vive en [`Subsection.html`](../apps-script/Subsection.html). Una lista de clases CSS por sí sola no construye un componente: el constructor controla la estructura, y los estilos/tokens compartidos controlan su apariencia.

```js
const bloque = STSubsection.create({
  title: 'Equipment performance',
  description: 'Review machine and conveyor performance.',
  tools: [
    { id: 'export-example', label: 'Export', icon: 'upload', onClick: exportResults }
  ],
  open: true,
  className: 'comparison-section'
});
contenedor.append(bloque.section);
bloque.body.append(tabla);
```

`title`, `description` y `tools` son los tres parámetros visuales. `description` y `tools` son opcionales. Las opciones `id`, `titleId`, `contentId`, `className`, `open`, `native` y `content` conservan la identidad, variante semántica y contenido de cada instancia. `native` es `true` por defecto (`details/summary`); `native:false` crea la variante con botón que usa el plegado compartido de `ClientCore`. La función devuelve `{section, body, header, title, description, tools}`.

Los títulos/descripciones de tipo string se insertan con texto seguro, nunca como HTML. `tools` acepta una barra DOM existente o un array de nodos/descriptores `{id, label, icon, text, pressed, disabled, onClick}`. Cada botón mantiene su nombre accesible. `pressed` define el estado inicial y su callback controla los cambios posteriores. `content` acepta nodos, arrays o texto.

`STSubsection.init(root)` adapta las subsecciones estáticas existentes al mismo contrato mediante `enhance(section)` y el mismo constructor interno de encabezados. Es idempotente y conserva IDs, valores, listeners, contenido y estado abierto/cerrado. En el arranque se adaptan las 27 subsecciones estáticas; las secciones dinámicas de Comparación/Resultados se crean directamente con `create()`. No hay un observador que recorra el DOM en cada cuadro de simulación. Para nuevos controles dinámicos usa `create()`; para incorporar un fragmento heredado, llama `init(fragmento)` explícitamente.

Todos los encabezados adaptados usan una rejilla común con dos columnas: el bloque de título y descripción a la izquierda y las herramientas a la derecha. Ambos bloques se centran verticalmente entre sí. La copia usa una columna flex con `--subsection-description-gap` (4 px); el título conserva su altura de texto, sin adoptar los 34 px de los botones. La descripción se ajusta dentro de su columna y el grupo de herramientas puede envolver sus botones. Sin descripción, la barra se centra respecto al título; sin herramientas, el texto ocupa todo el ancho. El chevron y la sangría textual se derivan de `--subsection-marker-size` y `--subsection-text-inset`, tanto en la variante nativa como en la de botón. Cambiar estos tokens o la implementación central actualiza todas las instancias; los casos específicos no deben redefinir el margen.

### Regla única de espaciado y superficie de Subsecciones

- **Lienzo exterior eliminado:** las secciones principales del workspace (`.workspace-content > section.card`) funcionan como contenedores de distribución transparentes, sin tarjeta, borde ni sombra propios. El fondo original `--surface` se traslada a la superficie de cada Subsección (`.fold-card` y `.fold-native`). **No cambies todavía** los colores de las tarjetas de datos, inputs o controles internos.
- **Primera Subsección de una pantalla:** no suma margen superior propio. El workspace aporta el **mismo margen arriba, a la izquierda y a la derecha**, controlado **exclusivamente por `--workspace-gutter` en `apps-script/DesignTokens.html`** (24 px escritorio; 12 px en pantallas estrechas). `--page-padding` es un alias de compatibilidad, no una segunda fuente de configuración. El fondo alrededor de cada Subsección es `--page`.
- **Entre Subsecciones consecutivas:** `--subsection-gap = var(--workspace-gutter)` (24 px escritorio, 12 px pantallas estrechas); el mismo valor que los márgenes exterior superior y laterales, sin sumar márgenes de cada bloque.
- **Contenedores con `gap`:** Formats organiza `.product-subsection` dentro de un contenedor flex que ya usa `--subsection-gap`; por lo tanto, sus Subsecciones deben tener `margin:0` y no heredar márgenes de `.settings-section` ni del selector general de Subsecciones. En Conveyors, `#basic-run-options` se oculta con CSS y no debe dejar un margen fantasma delante de Equipment.
- **Título a descripción:** `--subsection-description-gap = --space-1` (4 px) dentro de la columna de texto, con márgenes a cero y sin altura mínima de botón en el título. La barra de herramientas comparte el centro vertical del bloque completo de título y descripción. No se aplican excepciones locales de alineación superior/inferior.
- **Interior de la Subsección:** `--subsection-padding = --space-4` (16 px) en los cuatro lados.
- **Encabezado al contenido:** `--space-3` (12 px). Subsecciones colapsadas u ocultas no deben reservar espacio.
- **Herramientas del encabezado:** por defecto todos los controles de `.fold-tools` y `.button-row` se mantienen **en una sola fila**, incluidos selector y botones de Registro. Solo cuando el espacio es insuficiente se permite dividir el grupo en otra fila; nunca deben aparecer columnas de herramientas por defecto.
- **What-if:** dispone de una Subsección `#whatif-subsection` con encabezado plegable y contenido persistente, independientemente de si la simulación tiene resultados.
- **Pantallas sin tarjeta externa**, como Simulation 2D: el contenedor debe aportar el inset superior equivalente; no debe compensarse duplicando `margin-top` en cada Subsección.
- **Temas Classic y Elegant, Basic y Advance:** se aplica el mismo contrato. Ningún tema debe restaurar el lienzo exterior ni duplicar márgenes. Los cambios futuros de paleta deben separarse de la estructura del componente.

Implementación central: [UiStandards.html](../apps-script/UiStandards.html), sección **«Subsección / Subsection · ritmo compartido de pantallas»**. La adaptación de `workspace-content` del tema Elegant vive en [ElegantStyles.html](../apps-script/ElegantStyles.html). Al agregar una nueva Subsección, usa `STSubsection.create()`; conserva los tokens globales y documenta cualquier variante que requiera una diferencia de comportamiento.

## Catálogo de componentes reutilizables

Para consultar las muestras directamente en la aplicación, abre el diálogo **Sistema de diseño · SimuLine** con **Ctrl + Shift + S** (en Mac también Cmd + Shift + S), cuando el foco esté dentro de la aplicación de Apps Script. El catálogo y su interacción viven en [DesignReference.html](../apps-script/DesignReference.html), con pestañas **Controles**, **Navegación**, **Tipografía**, **Márgenes** y **Tarjetas**. **Todas las pestañas muestran exactamente tres columnas:** **Control o diseño** (vista previa), **Explicación** (cuándo usarlo) y **Nombre del control** (nombre oficial y selector/token para pedir cambios). En pantallas estrechas, las tres columnas se mantienen mediante desplazamiento horizontal. Los estilos de tarjetas y botones reutilizables viven en [ComponentStyles.html](../apps-script/ComponentStyles.html), incluidos en el encabezado de la aplicación después de los estilos de tema. No modifica casos ni resultados. Los controles de ejemplo son independientes del motor.

| Nombre oficial | Clase/módulo | Función y alcance |
| --- | --- | --- |
| **Subsección** | `STSubsection.create({title, description, tools})`, `STSubsection.init(root)` | Contenedor plegable de información con una sola barra de herramientas |
| **Título de subsección** | `.subsection-heading-title` | Título seminegrita en color primario; se mantiene legible al plegar |
| **Descripción de subsección** | `.subsection-description`, `.subsection-heading-copy` | Texto en una línea independiente, debajo del título. Se ajusta al ancho disponible sin ocultar líneas; nunca comparte renglón con el título |
| **Separador interno de subsección** | `.subsection-fieldset`, `.subsection-divider` | Agrupa controles interiores con una línea fina y una leyenda seminegrita en color primario |
| **Pestaña de navegación principal** | `.app-section-tab`, `#basic-navigation` | Botones de Equipo/Conveyors/Simulation/Results en el header, con `aria-current=page` para la vista activa |
| **Pestañas de cuadro de diálogo** | `.settings-tabs [role=tab]` | Navegación interna de Settings y del selector de tema, con `aria-selected` |
| **Selector de idioma** | `#settings-language`, `STLanguage.setLanguage()` | Idioma de la interfaz (English predeterminado / Español), persistido localmente sin afectar el caso |
| **Pestaña de simulación** | `.simulation-navigation .workspace-tab` | Cambia entre escenarios guardados y comparación |
| **Selector de simulación** | `.simulation-picker`, `#simulation-selector` | Desplegable de simulaciones del header |
| **Ruta del caso (breadcrumb)** | `.breadcrumb` | Nombre del caso y sección actual |
| **Pestañas del catálogo** | `.design-reference-tabs [role=tab]` | Variante propia del diálogo de sistema de diseño |
| **Botón principal** | `button` | Acción de mayor prioridad |
| **Botón secundario** | `button.secondary` | Acción alternativa |
| **Botón discreto** | `button.ghost` | Acción de menor énfasis |
| **Botón de peligro** | `button.danger` | Acción destructiva |
| **Botón de errores** | `#header-error-button`, `.error-details-trigger` | Alerta global con fondo rojo, icono contrastante y contador visible de errores activos; el clic abre detalles |
| **Botón deshabilitado** | `button:disabled` | Acción temporalmente no disponible |
| **Menú desplegable de acciones** | `.export-menu` | Agrupa opciones de importación/exportación en toolbar |
| **Campo de texto / Campo numérico / Campo de búsqueda** | `input[type=text]`, `input[type=number]`, `.search-field` | Captura de datos y búsqueda en catálogo |
| **Área de texto** | `textarea` | Contenido multilinea |
| **Opción única (radio)** | `input[type=radio]` | Selección exclusiva de filtros |
| **Control deslizante** | `input[type=range]` | Selección de valores graduables |
| **Valor manual activable** | `.switchable-value` | Casilla junto a override editable |
| **Valor calculado** | `.calculated-value` | Output no editable con estilo distinto |
| **Selector circular de color** | `.vgraph-color-trigger` | Muestra el color de la serie y permite abrir su editor |
| **Encabezado y pie de diálogo** | `.dialog-heading`, `.dialog-actions` | Estructura compartida de ventanas modales |
| **Subsección nativa** | `.fold-native`, `summary` | Control plegable semántico con título/descripcion |
| **Aviso contextual** | `.notice` | Advertencia no modal |
| **Indicador de progreso** | `progress` | Porcentaje de ronda, cálculo o importación |
| **Estado vacío** | `.empty` | Lista sin datos |
| **Botón/Icono** | `.icon-button` | Acción sin texto visible con `aria-label` y `title`. Igual estilo en Header, Subsecciones y herramientas |
| **Filtro de visibilidad por equipo** | `.equipment-filter-toggle`, `aria-pressed` | Dos iconos independientes en Equipment performance: Machines y Conveyors; selección visual con semántica de checkbox, sin modificar la simulación |
| **Valor–unidad** | `STTimeControls.output()`, `STTimeControls.setOutput()`, `STTimeControls.syncInputs()`, `.time-value-control` | Input: conserva la cifra y el ancho total; la unidad ocupa su ancho natural y la caja numérica toma el resto, con `--input-unit-gap` (8 px). Output: convierte la cifra y conserva sus reservas de espacio, con `--time-unit-gap` (2 px) |
| **Etiqueta de estado** | `.badge`, clases semánticas | RUNNING, PASS, FAIL y otros estados sin depender solamente del color |
| **Tarjeta de resultado** | `.metric-card.metric-card--result` | Las **diez** tarjetas de Simulation Playback (Virtual time, Output, Effective Runtime, Runtime Losses y demás) y resultados secundarios. `STTimeControls.output()` hereda el tamaño del valor del contenedor |
| **KPI destacado** | `.metric-card.metric-card--featured` | Dentro de Simulation Playback, **solo** Theoretical equipment efficiency y Simulated efficiency. Valor grande y borde superior grueso en color primario |
| **Tarjeta de escenario** | `.metric-card.metric-card--scenario` | Alternativas de What-if/CAPEX, con un borde lateral semántico y acciones del escenario |
| **Tarjeta de estado** | `.metric-card.metric-card--status` | Resultado de validación, estado o diagnóstico; compacta y con etiqueta semántica |
| **Tarjeta de equipo** | `.live-equipment-card` | Encabezado, estado, OEE y gráfico, con subsecciones internas configurables; el tag de estado en Equipment performance se alinea siempre a la derecha, tanto en máquinas como conveyors |
| **KPI de resultado** | `.result-kpi`, `.metric-card--result` | Indicadores KPI en Results, no equivalentes a los KPI destacados de eficiencia |
| **Panel de gráfica** | `.chart-panel` | Contenedor de gráficos y sus títulos |
| **Tabla de datos** | `.table-scroll`, `table` | Tabla con columnas optimizadas y scroll horizontal |
| **Fila de caso** | `.case-row` | Vista de un caso en el catálogo |
| **Tarjeta de configuración de equipo** | `.equipment-card` | Formulario/tarjeta de máquina o conveyor, distinto de resultado en vivo |

### Cobertura de muestras
El catálogo mantiene los nombres oficiales en la **tercera columna de todas las pestañas**. Incluye navegación real del Header, pestañas de diálogos, navegación entre simulaciones, variantes de botones, campos, menús, estado/progreso, tablas, gráficas y las familias de tarjetas. Los ejemplos interactivos están aislados: cambiar la pestaña o el color de un ejemplo no modifica el caso, su simulación, ni el selector de colores real. Los estilos viven en sus módulos propietarios; `DesignReference.html` incluye sólo la vista previa y su interacción.

- **Simulación > Configuración de duración:** `Initial format` → **Formato inicial**, `Base equipment settings` → **Configuración base de equipos**, `Duration method` → **Método de duración**, además de tiempo transcurrido, número de turnos, intervalo de fechas, objetivo de tiempo efectivo, límite anterior y mensajes derivados de días/horas/turnos. La traducción es sólo de presentación, no cambia códigos internos como `FIXED`, `DATES` ni `EFFECTIVE_RUNTIME`.
- **Simulation 2D en español:** se traducen los encabezados, la fuente de simulación, las casillas, las cinco tarjetas (tiempo, botellas, inventario, máquinas activas y Back-up), los selectores de vistas, las leyendas, las etiquetas de los controles y el cuadro de apariencia. Las etiquetas técnicas dibujadas en canvas usan el idioma activo sin traducir nombres de equipos ni identificadores. Los estados y los totales dinámicos se traducen sólo para su visualización; los cálculos continúan usando estados internos invariables.
- **Idioma de la interfaz:** `Settings > Appearance > Language` ofrece **English** (predeterminado) y **Español**. Se guarda como preferencia local del navegador con `STPreferences`, sin modificar datos, cálculos ni casos. Las traducciones del módulo [`Language.html`](../apps-script/Language.html) se aplican a textos estáticos y a componentes generados posteriormente; se mantienen sin traducir los identificadores, entradas y nombres definidos por el usuario. El control de calidad de idioma (test/SpanishUiCoverage.test.js) revisa las 819 entradas de TextResources y los textos y atributos estáticos de WebApp. Para añadir un campo o aviso, registra su traducción en Language.html; conserva en inglés los nombres de las claves JSON, los identificadores y las unidades técnicas. Los mensajes generados con números deben construirse con segmentos localizados, como el resumen de duración en RunOptions.html. **Reset app** vuelve a inglés.

### Reglas de comportamiento y aspecto

- **Un componente, una responsabilidad.** Las dos eficiencias de Simulation Playback son **KPI destacado**; las otras diez tarjetas son **Tarjeta de resultado**. No debe trasladarse automáticamente la jerarquía destacada a otros resultados secundarios, escenarios o estados.
- **Propiedad de estilos:** modificar las variantes `.metric-card` y la apariencia compartida de los botones de Header en `ComponentStyles.html`, no en el archivo del diálogo. `DesignReference.html` contiene solamente la galería, sus ejemplos y el atajo.
- **Color de fondo:** `--surface-soft` para Tarjeta de resultado y KPI destacado; `--surface` como superficie normal de Subsección. Evita mezclas de blancos sin contraste entre contenedores anidados.
- **Texto e iconos en botones sólidos:** el fondo primario o de error usa texto e iconos blancos (`#fff`) incluso en tema oscuro; los botones ghost, secundarios, suaves y deshabilitados conservan su semántica visual.
- **V-Graph:** la leyenda `.vgraph-legend` está en la barra de herramientas `.vgraph-toolbar` del encabezado, no encima del gráfico. Los botones circulares `.vgraph-color-trigger` conservan el diálogo `#series-color-dialog`, actualizan `metadata.vgraphColors` y respetan la paleta del caso.
- **Combobox elegante:** el elemento `option:checked:not(:disabled)` mantiene texto blanco y la marca `::checkmark` blanca sobre el color primario en temas claro y oscuro; la opción no seleccionada y el selector cerrado conservan sus colores.
- **Equipo numérico sin resultados:** el encabezado `#simulation-equipment` permanece fuera de `#simulation-results`. Después de agregar, eliminar o reordenar equipos, se invalidan el replay y las tarjetas anteriores, se limpian los KPI y aparece `#simulation-equipment-empty` hasta ejecutar otra simulación. En `Summary only` no se muestran tarjetas detalladas sin muestras; una advertencia informa por qué. Los IDs y el orden de los equipos en las muestras deben coincidir con el caso actual antes de pintar tarjetas.
- **Fluidez de Equipment Performance:** las tarjetas leen *Flow, Processed e Inside* de las muestras numéricas realmente registradas, incluso durante el refresco ligero de 250 ms, sin reconstruir gráficas ni inventar producción entre muestras. El resumen sólo cambia cuando existe una muestra nueva. La velocidad de diseño es fija; con una parada Back-up, el flujo puede ser cero y los acumulados permanecer invariables mientras disminuye el OEE. Para distinguir esa situación de una interfaz inmóvil, cada tarjeta muestra `Time in state` calculado a partir de la última transición exacta y del reloj virtual; si se truncó el registro de transiciones se oculta el contador en vez de extrapolarlo.
- **Corrección de sincronización Live (video del 22/nov):** una captura mostraba 6,401 unidades y 317.17 unidades/min (muestra numérica ≈20.18 min) mientras el reloj indicaba ≈27.55 min y retrocedía en segundos posteriores. La reproducción ahora conserva el reloj entre objetos nuevos de una muestra transmitida, hace avanzar el índice cuando el reloj alcanza una muestra registrada y alinea las muestras parciales nuevas con el tiempo virtual visible. Los KPI y valores del resumen se actualizan en un paso ligero de cada nueva muestra incluso si la gráfica pesada está limitada por FPS. Los temporizadores de 250 ms y de muestras ligeras no crean unidades ni estiman el flujo entre muestras. Las pruebas cubren streaming, reloj monótono, pausa/reanudación y render ligero. Si el cálculo aún no produce una muestra más reciente, los contadores permanecen en la última disponible; eso representa el límite real del cálculo y no debe maquillarse con interpolación.
- **Protección de datos del editor:** al abrir un caso se restaura su nombre y se montan las tarjetas antes del cambio de presentación Equipment/Conveyors. Si durante una simulación o guardado las tarjetas de Equipment no están montadas, se conserva el modelo de máquinas/conveyors del caso (no se interpreta como eliminación), y las vistas previas usan una copia de ese modelo. Sólo se rechaza una lista **parcialmente** montada para evitar pérdida de equipos; Settings sigue pudiendo cerrarse sin perder el nombre original.
- **Indicador global de errores:** `#header-errors` muestra un botón rojo sólido `#header-error-button` con contador y etiqueta accesible mientras existan errores activos. La prioridad visual se mantiene en modo claro y oscuro, incluso frente a estilos genéricos del encabezado. El botón continúa abriendo el detalle del error.
- **Valor–unidad de entrada:** `.time-value-control` usa dos columnas: caja numérica flexible y unidad de ancho natural. El ancho exterior permanece constante; una unidad más larga reduce la caja y una más corta la amplía, conservando `--input-unit-gap` (8 px). Se mantienen el número escrito, el selector nativo, el foco y los nodos existentes. Un texto auxiliar oculto y excluido de accesibilidad mide la opción seleccionada mediante el propio layout, sin medir píxeles ni reservar el ancho de la opción más larga. `STTimeControls.syncInputs(root)` prepara controles nuevos dentro de un contenedor o el control recibido; se ejecuta al iniciar, cambiar de unidad o idioma y restaurar opciones de simulación. Las unidades fijas siguen su ancho natural sin JavaScript.
- **Valor–unidad de salida:** se conserva `--time-unit-gap` (2 px) y `--time-unit-slot` (3.25 ch) en outputs generales. Los contadores de estados mantienen su reserva numérica por horizonte y su ancho de unidad específico. Los cambios deliberados de unidad animan el ajuste durante 180 ms; los contadores compactos conservan su reserva y usan una transición sutil. Las actualizaciones de cifras durante la reproducción no disparan animaciones. La preferencia de movimiento reducido desactiva esas transiciones. El menú común muestra abreviatura, nombre traducido y selección, con teclado y soporte de diálogos.
- **Subsección y descripción:** el título ocupa una línea independiente; la descripción comienza debajo, alineada al **texto del título después del chevron**, no al borde exterior del icono. En Simulation Playback, la **descripción, el estado y el porcentaje** comparten el segundo renglón cuando hay espacio suficiente; únicamente envuelven cuando falta ancho. En pantallas estrechas, la descripción ocupa las líneas necesarias sin truncarse. Las herramientas permanecen a la derecha y no alteran la jerarquía del título.
- **Equipment performance:** dos iconos reutilizables con `aria-pressed` muestran u ocultan **Machines** y **Conveyors** de forma independiente. Su estado no elimina equipos del caso, no cambia los resultados y se mantiene mientras se recorre una simulación. El filtrado de tarjetas reduce también el trabajo visual de equipos ocultos.
- **Estados fluidos y muestras acotadas:** el motor conserva el límite de unas 1001 muestras completas para evitar archivos enormes, pero registra separadamente hasta **4000 cambios exactos de estado** (tiempo virtual, índice y estado). Las etiquetas de estado se reproducen según ese historial al ritmo ligero de **250 ms** aunque la muestra completa anterior siga vigente. No se inventan estados: son transiciones calculadas. Si se alcanza el límite, `detailCoverage.stateTransitionsOmitted` lo indica y el resto se visualiza con las muestras disponibles. `Visual refresh rate` regula el redibujo pesado; `Display sample interval` afecta las muestras completas (y su intervalo efectivo puede aumentar por el límite de 1001). Los resultados de simulaciones anteriores sin ese historial siguen mostrando estados según sus muestras. En esos casos se requiere recalcular para obtener las transiciones precisas.
- **Simulation Playback:** en su encabezado sólo se muestran el estado de ejecución (Ready/Playing/Paused/Completed) y el porcentaje de avance; los frames, la frecuencia FPS y los tiempos de renderizado/cálculo no se muestran al usuario final. Durante la reproducción, una actualización ligera de los indicadores se ejecuta cada **250 ms** (más frecuente que el mínimo pedido de 500 ms), independiente de la actualización pesada de gráficas y equipos. El tiempo virtual y el porcentaje avanzan según el reloj de reproducción. Output, Runtime Losses, Effective Runtime y demás contadores muestran **únicamente los valores de muestras calculadas**, nunca unidades interpoladas o inventadas. La frecuencia y el contenido de muestreo del motor no cambian.
- **KPI destacado (eficiencias):** además de la clase `.metric-card--featured`, los selectores de `#simulation-playback-efficiencies #basic-efficiencies` tienen precedencia sobre estilos antiguos de Basic, para garantizar el borde superior primario, fondo y tamaño KPI de las dos tarjetas.
- **Separador interno:** reutilizar `<fieldset class="subsection-fieldset"><legend class="subsection-divider">…</legend>` sólo cuando el grupo requiera un separador visible; la pestaña **Controles** del Sistema de diseño contiene el ejemplo. **Simulation 2D > Settings** utiliza un grupo de casillas sin el encabezado ni la línea `Options`, por petición de diseño. El título de subsección usa `.subsection-heading-title`.
- **Relieve al pasar el mouse:** solamente en subtarjetas de resultados, escenarios y KPI. Se usa una sombra ligera sin `will-change`, exclusivamente si existe `hover`; nunca modificar producción ni ejecutar un recálculo.
- **Herramientas de What-if:** `Scenario options` y la exportación están en la misma barra de la Subsección. Los controles se mantienen fuera del contenido plegable para permanecer accesibles.
- **Iconos del Header:** usan dimensiones, fondo, borde y estados de foco compatibles con `.icon-button`. No suprimir atributos accesibles ni convertir acciones en elementos sin botón.
- **Tipografías:** seguir la escala de cinco niveles de `DesignTokens.html`; un valor que representa la misma jerarquía no debe tener tamaño distinto por utilizar el selector `STTimeControls`.
- **Márgenes:** `--workspace-gutter`, `--subsection-gap` y `--subsection-padding` se ajustan en `DesignTokens.html`; cualquier excepción necesita justificar por qué el componente no puede usar el token global.

## Color y estados

- Usa `--page`, `--surface` y `--surface-soft` para superficies, `--ink` y `--muted` para texto y `--line` para bordes.
- Usa `--accent` con `--on-accent` para acciones principales y los tokens de selección y foco para estados interactivos. Los colores por defecto son **boat blues** y **astronomicon grey**. Las paletas elegidas por el usuario tienen prioridad. [Paletas](../apps-script/ThemeResources.html)
- Usa los tokens de estado para éxito, advertencia, error y estados de equipos. Acompaña el color con texto o icono. Para gráficas, usa `--series-*`, `--chart-grid` y `--chart-axis`. Revisa contraste, foco y legibilidad en claro y oscuro.
- Conserva colores literales en las definiciones de paletas, recursos de marca y exportables autónomos que necesitan declarar su propia paleta.

## Comentarios del código

- Documenta cada función que se agregue o modifique con un comentario en español que explique su propósito. Indica entradas, unidades, salida y efectos laterales cuando no sean evidentes. Documenta también errores, condiciones de carrera o supuestos que afecten el resultado.
- Aplica el mismo criterio a los callbacks que tengan lógica propia. Para callbacks cortos que solo delegan, describe el propósito del bloque que los registra.
- Delimita las secciones funcionales de HTML con comentarios en español. Indica qué controlador llena un contenedor vacío si resulta útil para encontrar su implementación.
- En archivos generados, documenta el código fuente y regenera la salida. En Apps Script usa comentarios HTML en el marcado y comentarios JavaScript dentro de los scripts. Actualiza comentarios junto con el comportamiento que describen.

## Auditoría inicial

| Prioridad | Hallazgo | Acción |
| --- | --- | --- |
| Alta | [DesignTokens.html](../apps-script/DesignTokens.html) define siete tamaños base distintos, de 11 a 24 px, contando KPI. La guía previa enumeraba seis. Una revisión estática de 19 módulos de estilos encontró 192 declaraciones de tamaño, 11 literales directos y 10 valores literales distintos. | Migrar los tokens y alias a los cinco niveles y revisar primero los overrides de Assistant, BrandConveyor y UiStandards. Estos conteos son del código fuente y no equivalen a tamaños computados en pantalla. |
| Alta | [Results.html](../apps-script/Results.html) inserta impacto, atribución, balance por equipo y rampas bajo el mismo contenedor. Sus encabezados no comparten una separación explícita. | Primera corrección en UiStandards. Aplicar el espaciado de subsección a los títulos y bloques de Rate Loss. |
| Alta | Los checkboxes de Rate Loss en Settings estaban en una grilla cuyos estilos generales también afectan a las etiquetas de campos. | Primera corrección en WebApp. Reutilizar la grilla de interruptores que alinea checkbox y etiqueta. |
| Media | [RealDataStyles.html](../apps-script/RealDataStyles.html) aplica 16 px a bloques y paneles y 12 px a grillas. | Revisar el límite entre sección y subsección, y migrar el padding de panel a la regla compartida al ajustar esta vista. |
| Media | [RunOptions.html](../apps-script/RunOptions.html) tenía funciones sin documentación en español y [RealDataPanel.html](../apps-script/RealDataPanel.html) no señalaba sus bloques principales. | Documentados en esta primera pasada. Continuar por Simulación, Resultados, Real Data y Settings. |

Antes de cerrar una migración, revisa Basic y Advance en claro y oscuro, una ventana estrecha, escala al 125 %, controles con foco y estados vacíos, cargados y colapsados. Para cambios de espaciado, comprueba que la separación venga de una sola regla y que los contenedores ocultos cedan su espacio. La auditoría inicial fue estática. Falta verificar visualmente la aplicación desplegada.

## Notas históricas de la interfaz

Estas notas conservan decisiones de comportamiento y distribución anteriores. Para tamaños, colores y espacios de cambios nuevos, aplica las reglas de esta guía.

Views start with subsection headings; the header navigation identifies the main
section. Subsection controls align right. Equipment and Conveyors share one file
menu (Google Sheet / JSON import); Equipment has a separate icon button for JSON export. JSON field actions
use labeled icon buttons. V-Graph uses its speed-profile heading. Main header gaps are 16px;
panel padding is 20px (12px on small screens). Checkboxes remain 16px.

Basic simulation settings use separate efficiency and control boxes with prominent
percentages. Navigation moves the existing controls, preserving listeners and run
locks. Conveyor worksheets grow with their content and use the page scrollbar.

Basic What-If cards show evaluated OEE, throughput and changes from the matching
baseline; Advance retains the detailed comparison table. Both presentations use
the same evaluation, independent validation and creation gate. No ROI or production
estimates are fabricated. Design checks and Results suggestions are Advance-only.
Warning and analysis panels share padding, borders and typography, preserving
severity colors. Accent names remain available through swatch tooltips only.

Verification: modular Apps Script and Settings contracts, targeted jsdom tests for
JSON import isolation, conveyor worksheets, scenario rejection/stop controls,
subsection navigation and mode font scaling. Real-browser visual review is still
needed on the deployed Apps Script page.

Basic CAPEX overview: Current, Zero, Medium, High in a single four-column row.
The current card reads the saved result (batch means when available), has no
calculation actions and displays a dash when no result exists. Narrow containers
scroll horizontally instead of wrapping the four cards. Advance retains its
existing detailed categories, including All CAPEX. File-menu summaries and icon
buttons share dimensions and have no extra bottom margin; subsection headings
share typography, minimum height and spacing.

Basic scenario cards hide technical status/progress paragraphs and show an
indeterminate progress bar only while evaluating or validating. The OEE delta is
labeled in percentage points, not relative percent. Error diagnostics remain in
the header, and required engineering acknowledgements remain available. Medium
CAPEX uses the semantic info color, including cards with no eligible targets.
Export triggers use an upward arrow; Import uses a downward arrow and text-only
menu choices. Conveyor cards hide their unused Basic data container.

Comparison appears after What-If in Advance navigation only. Basic omits the
Comparison utility. Gallery account email is untruncated and Settings/Sign out
use labeled icons. Settings removes category titles already named in the tabs;
the Case name field spans the content width.

Simulation: Basic aligns Run simulation with Simulation settings. Run controls
is no longer displayed. Playback actions are icons, and the right-aligned percent
uses displayed virtual time / configured duration, clamped to 0–100%, preserving
streaming playback and pause/reset behavior. Background replication has its own
progress indicator. Scenario activity is a 9px themed animated bar; all four Basic
cards share the lateral border and a padded title background.

Results export offers JSON (the existing bounded AI summary), HTML and PDF. Full
replay JSON export is removed from that menu. Native result storage is unchanged.
Basic presents generic units; Advance displays the specified flow unit. New demo
cases use units. Import dropdown options share the same menu style as exports.

What-If mode changes rebuild the view immediately. Evaluation keys and saved
controls include the originating Basic/Advance mode so selections and metrics
restore independently. Legacy evaluations without a mode can be adopted by the
first mode that saves them; no old record is deleted. Basic keeps Current/Zero/
Medium/High and colors the lateral borders green/blue/violet by CAPEX tier.
Individual hypotheses are removed from both modes; category searches remain.

Scenario configuration uses one adjustable-parameter table. DOE adds selection,
Low and High columns to each eligible row (maximum four factors), shown when DOE
is enabled. Units appear in one column; parameter labels omit the duplicate unit
suffix. Physical limits and DOE range validation are unchanged. Settings groups
JSON fields and Include DOE checkboxes without a repeated title; Appearance uses
adjacent label/control columns instead of opposite edges of the dialog.


## Revisión de pendientes del 23 de noviembre de 2026

Las peticiones de las 09:06 y 09:27 (America/Mexico_City) eran posteriores a `main` `13231d2818e94b7b6327eb66ee1a367aa67c3189` (08:45). Había avances en una copia de trabajo que todavía no estaban publicados. Esta revisión completa el constructor de Subsección, retira las excepciones locales de geometría y conecta tanto los encabezados estáticos como Products, Basic y Real Data generados dinámicamente al contrato común.

- **Unidades:** inventario/derrame mezclado muestra cantidades separadas de botellas y cajas. La unidad registrada en el resultado tiene prioridad sobre una configuración editada después. El formateo conserva las cantidades.
- **Menú y transición:** menú único de unidades, nombres traducidos, selección, teclado y soporte de diálogos; transición de 180 ms sólo al cambiar deliberadamente la unidad. Restaurar preferencias y actualizar números en vivo no dispara animaciones de ancho.
- **Velocidades:** `PlaybackSpeedOptions.html` alimenta ambos selectores con la misma lista de 1× a 50 000×, incluidos 10 000×, 20 000× y 50 000×. La velocidad es una solicitud de reproducción y depende de la capacidad de cálculo del equipo.
- **Resultados pendientes:** Advance conserva nueve KPI y tres tarjetas de rate loss; Basic conserva su selección de cinco KPI. Las cifras pendientes son `—`, las unidades seleccionadas y los nodos se conservan; se limpian datos anteriores y se deshabilitan las exportaciones hasta obtener resultados completos.
- **Comparación:** usa Subsección, tarjetas y tablas compartidas; los valores y las unidades son nodos separados y las filas modificadas quedan identificadas.
- **Rendimiento:** la programación del cálculo es independiente del límite de FPS. El worker aprovecha su presupuesto acotado sin esperas de temporizador innecesarias; el fallback del hilo principal conserva las pausas necesarias para responder. El motor evita recorridos repetidos de colas discretas inmóviles, conservando los pasos físicos, sensores y contadores.

### Medición reproducible del cálculo

Ejecutar `node scripts/benchmark-numerical-playback.mjs --seconds 3600 --baseline-root /ruta/a/la/base` con la base del commit anterior. El script usa `test/fixtures/ui-demo-case.json` y verifica igualdad de todos los campos del cuadro terminal.

| Medida de esta ejecución | Resultado |
| --- | --- |
| Equipos del demo | 13 |
| Horizonte configurado | 86 400 s |
| Tramo medido | Primeros 3 600 s simulados |
| Paso / cantidad de pasos | 1/120 s / 432 000 |
| Tiempo de cálculo base | 29 464 ms |
| Tiempo de cálculo actualizado | 7 692 ms |
| Aceleración observada | 3.831× |
| Producción en ambas versiones | 10 231 |
| Cuadro terminal completo | Exactamente igual |

SHA-256 del cuadro terminal: `43c007391619cc74fcd225b3b7a8faa96ee3d627337f449d8ef4039df08dd530`.

Es una medición local en Node, sin DOM ni interfaz, de un tramo de una hora; no es una garantía de aceleración del navegador ni una medición del día completo. Adicionalmente se compararon cuadros y muestras de gráficas en 38 puntos de dos trayectorias de bloqueo, liberación y fallas con semilla contra la base. `ConveyorTickReference.test.js` conserva la referencia independiente.

### Validación y límite visual

Se verificaron 141 pruebas enfocadas de componentes, generación dinámica, estilos, unidades, resultados/comparación, velocidades y reproducción numérica. Se analizaron sintácticamente los 52 bloques de JavaScript, 26 hojas de estilo y el código de servidor generados. No se ejecutó la suite completa del repositorio. Las pruebas CSS verifican reglas ganadoras/estructura; no son mediciones de píxeles. Chromium no pudo crear una página porque el entorno denegó su socket de inicio, por lo que la revisión visual del despliegue de Apps Script queda pendiente.


### Corrección de centrado vertical del encabezado

La captura de Productos mostró que centrar la barra respecto a la primera fila y dar al título la altura mínima de los botones dejaba demasiado espacio antes de la descripción. La regla compartida conserva ahora título y descripción como una columna compacta y centra la barra respecto al bloque completo. Esta misma regla cubre encabezados nativos, personalizados y dinámicos. Las pruebas existentes verifican la estructura y las reglas CSS ganadoras en ambos modos/temas; no sustituyen una medición visual del navegador.

### Ajustes de presentación del 23 de noviembre de 2026

El menú Valor–unidad ahora muestra exclusivamente las abreviaturas con selección visual de combobox. El OEE global usa `metric-card--featured` sin concatenar texto traducible a clases CSS. Las barras de Subsección y Registro ocupan una línea en escritorio, con desplazamiento horizontal en vista estrecha. Comparación ya no presenta la nota automática Baseline/Proposed. El catálogo conserva tres columnas y añade el tipo Básico/Compuesto y la composición de cada control bajo su nombre técnico.


### Ajuste visual puntual de 2D y Formats · 23 nov 2026

- La primera tabla de cada equipo de **Simulation 2D** muestra icono, nombre y
  etiqueta de estado de fondo suave, punto y texto semántico, conforme al diseño
  reutilizable `.live-state` de Simulation numérica. La fila **State** usa esa
  misma paleta.
- La etiqueta sobre máquinas y transportadores tiene 20 px en pantalla: su
  escala se compensa con el zoom del canvas para que nunca se convierta en una
  cápsula gigante. Los estados siguen dependiendo del motor, no del tema visual.
- **Conveyor Geometry** mantiene su título y el botón PASS/FAIL de evaluación
  conserva su acción de abrir el análisis. La etiqueta usa los mismos tokens
  semánticos, una altura de 20 px y **no** se escala junto con el zoom.
- La primera Subsección de **Products & Formats** toma el espacio superior del
  `--workspace-gutter` del workspace; el cuerpo del editor no suma un segundo
  padding superior.


### Basic/Advance consolidation — 23 November 2026

The Equipment ID and initial mode selectors are no longer part of the editor.
A stable internal equipment ID is still required for references and saved results;
new edits use the standard `AUTO` initial mode. Critical machine is selectable
on machine cards in both modes, never on conveyors.

The Equipment and Conveyor **Additional options** dialog, the equipment-specific
JSON help dialog, examples and editable JSON textareas have been removed from
the UI source. Only non-visual internal parameter state remains to preserve
saved cases and imported equipment. General case-level export remains available.

The **Show JSON fields** and **Autosave** settings were removed. Automatic case
persistence is disabled, and the existing Save icon continues to perform manual
case saving. The unsaved-changes warning is preserved.

**Real Data** and **Comparison** are available exclusively in Advance.
**Settings > Gemini** exposes the same full Advance personality, engineering
policies and generation controls in both Basic and Advance; the backend uses
the same Advance prompt sections for both.
