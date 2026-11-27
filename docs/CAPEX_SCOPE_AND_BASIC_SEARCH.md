# Alcance CAPEX y búsqueda automática de Basic

Política vigente: `MATCHED_CAPEX_V12`. Aplica a Basic (`MINIMAL` internamente), Standard (`BASIC`) y Advance.

## Categorías independientes

| Categoría | Intervenciones evaluadas | Límites |
|---|---|---|
| Zero | Posiciones y tiempos de sensores existentes, velocidades de conveyors y reducción de downtime mediante operación/mantenimiento. | Sin nueva capacidad de acumulación ni sustitución de máquinas. Las sensibilidades de MTBF/MTTR siguen siendo hipótesis `analysisOnly` hasta disponer de evidencia de intervención. |
| Medium | Capacidad de acumulación antes y/o después de máquinas críticas; uno, dos o hasta tres sitios cuando tienen una hipótesis física útil. | Se representa mediante la geometría del conveyor existente y los ajustes geométricos acoplados necesarios. No incorpora optimizaciones operativas de Zero ni fiabilidad o reemplazos de High. |
| High | Reemplazo completo de máquinas, con los parámetros de capacidad y/o confiabilidad de cada sustitución tratados como un paquete. | Los objetivos documentados conservan su fuente. Los niveles automáticos conservan `analysisOnly`; no son capacidades garantizadas por un proveedor ni demuestran que deba comprarse una máquina. |

Cada categoría parte de la misma simulación original. No existe una opción para incluir otras categorías ni una búsqueda conjunta de todas ellas. Por ejemplo, un resultado High no contiene el buffer ganador de Medium ni los sensores ganadores de Zero.

La ubicación de un buffer parte del diagnóstico de capacidad y pérdidas compatibles con la base. Un sitio representa capacidad adicional en un conveyor del modelo lineal existente; no crea una rama paralela, inventa una ubicación de planta ni certifica espacio libre. La factibilidad física sigue pendiente de revisión.

Los cambios de un mismo buffer comparten `packageId: ACCUMULATION:<equipmentId>`. Los cambios de una sustitución automática comparten `packageId` y `targetId: REPLACEMENT:<equipmentId>:AUTO`. `packagePaths` declara los campos inseparables de cada paquete. Las combinaciones deben preservar esos paquetes: no se presenta el incremento aislado de un MTBF como una sustitución completa.

## Basic decide el experimento

En Basic, iniciar la búsqueda basta para que el algoritmo:

1. Compruebe que la base numérica terminó y corresponde a los datos actuales.
2. Utilice el diagnóstico para priorizar variables y máquinas dentro de cada categoría.
3. Forme una selección acotada de objetivos, respetando los paquetes físicos de buffers y reemplazos.
4. Elija automáticamente factores y niveles; el DOE tiene hasta tres factores y ocho combinaciones. Cuando no hay factores numéricos elegibles, conserva la comparación de paquetes pertinente.
5. Reutilice comparaciones completas únicamente cuando coinciden exactamente entradas, horizonte, semillas y motor.
6. Compare los finalistas físicamente y confirme el seleccionado en el horizonte de validación registrado, con semillas independientes.
7. Presente el resultado de cada categoría con su estado de confirmación y revisión de ingeniería.

Las preferencias manuales ocultas de DOE, profundidad o selección de variables de otros modos no deciden el estudio Basic. Standard y Advance conservan sus controles de selección y DOE dentro del alcance independiente de la categoría.

Basic utilizaba el perfil automático FAST progresivo V2 con un límite duro de 24 candidatos de exploración. La exploración se limita a 5–15 minutos virtuales por réplica según el MTBF. Las combinaciones DOE se reutilizan en ANOVA; una comparación negativa sin señales de efectos tardíos puede terminar la categoría sin una simulación de horizonte completo. Se conservan hasta dos candidatos para una selección intermedia, y solo uno pasa a la comparación de horizonte completo (tres réplicas). El plan de confirmación independiente se limita a 3–6 réplicas de cada alternativa, con la misma duración y criterios de aceptación. La búsqueda automática tiene cinco minutos de tiempo real por categoría, incluyendo confirmación; la cancelación de los workers es cooperativa y el límite no es una garantía exacta de latencia. Si se agota, se conserva evidencia preliminar, sin habilitar la creación como escenario confirmado. Los candidatos omitidos podrían aportar mejoras fuera de la exploración; Standard/Advance conservan sus configuraciones y el alcance independiente. La selección principal admite tres paquetes (hasta ocho puntos DOE); la exploración opcional de downtime limita su diagnóstico a tres máquinas, un objetivo y cuatro niveles conjuntos, con hasta nueve lotes. Omite el diagnóstico adicional sin fallas al horizonte completo. La confirmación final conserva su horizonte completo, semillas nuevas y criterios estadísticos; Basic limita el tamaño de muestra y registra si el tope impide alcanzar la precisión solicitada.

La reducción de trabajo procede de acotar variables, combinar paquetes relevantes y evitar búsquedas de categorías mezcladas o evaluaciones duplicadas. No se obtiene acortando arbitrariamente la confirmación, cambiando el resultado de la base o afirmando que la combinación encontrada es el óptimo global. Un caso largo con fallas poco frecuentes todavía puede requerir trabajo considerable.

## Confirmación y reutilización

La confirmación compara base y candidato con el mismo horizonte, motor físico preciso y bloque de semillas independientes de la exploración. Standard/Advance conservan su horizonte original. El tamaño de muestra se fija desde un piloto antes de observar el resultado de confirmación. La política de precisión, ganancia práctica y protección frente a regresión media de OEE se conserva.

La política V12 invalida como evidencia vigente los resultados guardados con la clasificación anterior. El historial puede conservarse, pero una selección o marca de inclusión antigua no autoriza a mezclar categorías ni a reutilizar una confirmación anterior bajo una etiqueta nueva.

La categoría conocida se conserva también en las simulaciones exploratorias: downtime en Zero y reemplazo completo en High. `analysisOnly` y el estado de factibilidad permanecen explícitos; clasificar la intervención no certifica sus metas.

El servidor vuelve a validar cada cambio contra la categoría de la propuesta. Rechaza `originTier` de otra categoría, la eliminación de la marca exploratoria y los paquetes incompatibles. Para reconstruir un estudio confirmado exige la misma fuente, `searchScope`, política V12, configuración técnica (incluido el perfil automático para `uiMode: minimal`) y cambios exactos, incluida su identidad de paquete.

## Mantenimiento

Las reglas compartidas viven en `src/analysis/ScenarioPlanner.js`, la búsqueda en `src/analysis/ScenarioSearch.js` y `apps-script/ScenarioExplorer.html`, y la frontera de creación en `apps-script/ScenarioService.gs`. La guía y los criterios de Gemini siguen la misma clasificación; los prompts personalizados no reemplazan la validación del servidor.

Después de modificar módulos compartidos, ejecutar `npm run build:apps-script` para regenerar **ambos** artefactos: `apps-script/SimulationEngine.html` y `apps-script/ScenarioEngine.gs`. Desplegar los módulos Apps Script relacionados juntos.

Basic actualiza las métricas de una estimación prometedora durante la exploración, con su horizonte y número de réplicas. La barra general identifica categoría, etapa y tiempo transcurrido. El botón Stop search detiene la categoría activa y no inicia la siguiente; las categorías terminadas se conservan. Solo se habilita la creación con las condiciones de confirmación existentes. Se comparte el diagnóstico inicial de Basic y se usa una copia física ligera de cada modelo de prueba (sin replay ni historial de evaluaciones); Standard/Advance también aprovechan la copia ligera y la caché exacta de bases.

## Basic multifidelidad V3 (vigente)

- El motor normal y Standard/Advance permanecen intactos. Basic usa un modelo de flujo agregado dirigido por eventos (FLUID_SCREEN_V1), con inventario finito, demora de transporte, relojes de fallas y reparación, microparos, sensores por umbral, arranques equivalentes y números aleatorios comunes. No reproduce posiciones, residencia interna, pulsos ópticos ni overflow físico. La elegibilidad de la fuente excluye topologías complejas, eventos programados, modos no AUTO, scrap y conveyors dinámicos; esas fases usan PHYSICAL_FAST_V1 para base y candidatos. La caché conserva la fidelidad en la firma exacta. Las observaciones de DOE y ANOVA son exploratorias, incluso si sus efectos son significativos.
- Exploración DOE: 30 min × 3 (o el horizonte disponible); sensibilidad: 5–15 min × 3. Se conserva un candidato de precaución si el modelo agregado no muestra ganancia; hasta dos pasan a comprobación física FAST de 15 min. Un finalista y su base pasan al piloto físico FAST a un horizonte de comparación de 60 min, con mínimo de 30 min para una fuente corta. Eventos programados conservan el horizonte original; un modo de falla con MTBF >60 min y una indisponibilidad teórica >=2% puede ampliar el horizonte hasta el MTBF redondeado a horas, sin superar el horizonte original. La elección se fija antes de la confirmación. El piloto FAST planifica 3–6 réplicas; la confirmación usa PRECISE y semillas independientes en el mismo horizonte, sin certificar el día completo cuando se evaluó solo una ventana.
- No se mezclan métricas de distintos motores en un contraste. Un candidato sin mejora física no se confirma. Los resultados preliminares, la precisión alcanzada y la duración/fidelidad de cada etapa se registran. Una firma Basic V3 nueva impide reutilizar resultados V2 como confirmaciones actuales. Las categorías y tarjetas no cambian. La concordancia ordinal y las diferencias de throughput deben verificarse con casos de planta antes de confiar en el ranking agregado; el modelo puede omitir alternativas y no demuestra factibilidad de ingeniería.
