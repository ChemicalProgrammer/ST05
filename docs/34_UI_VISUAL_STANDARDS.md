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

### Regla única de espaciado y superficie de Subsecciones

- **Lienzo exterior eliminado:** las secciones principales del workspace (`.workspace-content > section.card`) funcionan como contenedores de distribución transparentes, sin tarjeta, borde ni sombra propios. El fondo original `--surface` se traslada a la superficie de cada Subsección (`.fold-card` y `.fold-native`). **No cambies todavía** los colores de las tarjetas de datos, inputs o controles internos.
- **Primera Subsección de una pantalla:** no suma margen superior propio. El workspace aporta el **mismo margen arriba, a la izquierda y a la derecha**, controlado **exclusivamente por `--workspace-gutter` en `apps-script/DesignTokens.html`** (24 px escritorio; 12 px en pantallas estrechas). `--page-padding` es un alias de compatibilidad, no una segunda fuente de configuración. El fondo alrededor de cada Subsección es `--page`.
- **Entre Subsecciones consecutivas:** `--subsection-gap = var(--workspace-gutter)` (24 px escritorio, 12 px pantallas estrechas); el mismo valor que los márgenes exterior superior y laterales, sin sumar márgenes de cada bloque.
- **Contenedores con `gap`:** Formats organiza `.product-subsection` dentro de un contenedor flex que ya usa `--subsection-gap`; por lo tanto, sus Subsecciones deben tener `margin:0` y no heredar márgenes de `.settings-section` ni del selector general de Subsecciones. En Conveyors, `#basic-run-options` se oculta con CSS y no debe dejar un margen fantasma delante de Equipment.
- **Interior de la Subsección:** `--subsection-padding = --space-4` (16 px) en los cuatro lados.
- **Encabezado al contenido:** `--space-3` (12 px). Subsecciones colapsadas u ocultas no deben reservar espacio.
- **Herramientas del encabezado:** por defecto todos los controles de `.fold-tools` y `.button-row` se mantienen **en una sola fila**, incluidos selector y botones de Registro. Solo cuando el espacio es insuficiente se permite dividir el grupo en otra fila; nunca deben aparecer columnas de herramientas por defecto.
- **What-if:** dispone de una Subsección `#whatif-subsection` con encabezado plegable y contenido persistente, independientemente de si la simulación tiene resultados.
- **Pantallas sin tarjeta externa**, como Simulation 2D: el contenedor debe aportar el inset superior equivalente; no debe compensarse duplicando `margin-top` en cada Subsección.
- **Temas Classic y Elegant, Basic y Advance:** se aplica el mismo contrato. Ningún tema debe restaurar el lienzo exterior ni duplicar márgenes. Los cambios futuros de paleta deben separarse de la estructura del componente.

Implementación central: [UiStandards.html](../apps-script/UiStandards.html), sección **«Subsección / Subsection · ritmo compartido de pantallas»**. La adaptación de `workspace-content` del tema Elegant vive en [ElegantStyles.html](../apps-script/ElegantStyles.html). Al agregar una nueva Subsección, reutiliza estas clases y **evita** márgenes superiores particulares salvo una excepción justificada y documentada.

## Catálogo de componentes reutilizables

Para consultar las muestras directamente en la aplicación, abre el diálogo **Sistema de diseño · SimuLine** con **Ctrl + Shift + S** (en Mac también Cmd + Shift + S), cuando el foco esté dentro de la aplicación de Apps Script. El catálogo y su interacción viven en [DesignReference.html](../apps-script/DesignReference.html), con pestañas **Controles**, **Navegación**, **Tipografía**, **Márgenes** y **Tarjetas**. **Todas las pestañas muestran exactamente tres columnas:** **Control o diseño** (vista previa), **Explicación** (cuándo usarlo) y **Nombre del control** (nombre oficial y selector/token para pedir cambios). En pantallas estrechas, las tres columnas se mantienen mediante desplazamiento horizontal. Los estilos de tarjetas y botones reutilizables viven en [ComponentStyles.html](../apps-script/ComponentStyles.html), incluidos en el encabezado de la aplicación después de los estilos de tema. No modifica casos ni resultados. Los controles de ejemplo son independientes del motor.

| Nombre oficial | Clase/módulo | Función y alcance |
| --- | --- | --- |
| **Subsección** | `.fold-card`, `.fold-heading`, `.fold-toggle`, `.fold-content`, `.fold-tools` | Contenedor plegable de información con una sola barra de herramientas |
| **Título de subsección** | `.subsection-heading-title` | Título seminegrita en color primario; se mantiene legible al plegar |
| **Descripción de subsección** | `.subsection-description`, `.subsection-heading-copy` | Texto en una línea independiente, debajo del título. Se ajusta hasta dos líneas cuando el espacio es reducido; nunca comparte renglón con el título |
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
| **Valor–unidad** | `STTimeControls.output()`, `STTimeControls.setOutput()`, `.time-value-control` | Input: conserva la cifra. Output: convierte la cifra. Ambos usan `--time-unit-gap` (2 px) y `--time-unit-slot` (3.25 em) para que el ancho de la unidad no desplace el valor |
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
- **Protección de datos del editor:** al abrir un caso se restaura su nombre y se montan las tarjetas antes del cambio de presentación Equipment/Conveyors. Si durante una simulación o guardado las tarjetas de Equipment no están montadas, se conserva el modelo de máquinas/conveyors del caso (no se interpreta como eliminación), y las vistas previas usan una copia de ese modelo. Sólo se rechaza una lista **parcialmente** montada para evitar pérdida de equipos; Settings sigue pudiendo cerrarse sin perder el nombre original.
- **Indicador global de errores:** `#header-errors` muestra un botón rojo sólido `#header-error-button` con contador y etiqueta accesible mientras existan errores activos. La prioridad visual se mantiene en modo claro y oscuro, incluso frente a estilos genéricos del encabezado. El botón continúa abriendo el detalle del error.
- **Valor–unidad:** el valor y la unidad usan el mismo tamaño, grosor, interlineado y alineación de baseline. Inputs y outputs comparten un espacio fijo de 2 px y un slot de unidad de anchura fija (3.25 em), sin flecha visible. Los cambios de unidad no desplazan el input ni el inicio del output.
- **Subsección y descripción:** el título ocupa una línea independiente; la descripción comienza debajo, alineada al **texto del título después del chevron**, no al borde exterior del icono. En Simulation Playback, la **descripción, el estado y el porcentaje** comparten el segundo renglón cuando hay espacio suficiente; únicamente envuelven cuando falta ancho. En pantallas estrechas, la descripción puede ocupar hasta dos líneas. Las herramientas permanecen a la derecha y no alteran la jerarquía del título.
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
