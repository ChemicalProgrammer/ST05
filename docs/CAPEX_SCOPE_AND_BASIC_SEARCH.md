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
6. Compare los finalistas al horizonte configurado y confirme el seleccionado con semillas independientes.
7. Presente el resultado de cada categoría con su estado de confirmación y revisión de ingeniería.

Las preferencias manuales ocultas de DOE, profundidad o selección de variables de otros modos no deciden el estudio Basic. Standard y Advance conservan sus controles de selección y DOE dentro del alcance independiente de la categoría.

Basic utiliza el perfil automático FAST con un límite duro de 24 candidatos de exploración. La selección principal admite tres paquetes (hasta ocho puntos DOE); la exploración opcional de downtime limita su diagnóstico a tres máquinas, un objetivo y cuatro niveles conjuntos, con hasta nueve lotes. Omite el diagnóstico adicional sin fallas al horizonte completo. La confirmación final conserva su horizonte y plan estadístico.

La reducción de trabajo procede de acotar variables, combinar paquetes relevantes y evitar búsquedas de categorías mezcladas o evaluaciones duplicadas. No se obtiene acortando arbitrariamente la confirmación, cambiando el resultado de la base o afirmando que la combinación encontrada es el óptimo global. Un caso largo con fallas poco frecuentes todavía puede requerir trabajo considerable.

## Confirmación y reutilización

La confirmación compara base y candidato con el mismo horizonte y bloque de semillas independientes de la exploración. El tamaño de muestra se fija desde un piloto antes de observar el resultado de confirmación. La política de precisión, ganancia práctica y protección frente a regresión media de OEE se conserva.

La política V12 invalida como evidencia vigente los resultados guardados con la clasificación anterior. El historial puede conservarse, pero una selección o marca de inclusión antigua no autoriza a mezclar categorías ni a reutilizar una confirmación anterior bajo una etiqueta nueva.

La categoría conocida se conserva también en las simulaciones exploratorias: downtime en Zero y reemplazo completo en High. `analysisOnly` y el estado de factibilidad permanecen explícitos; clasificar la intervención no certifica sus metas.

El servidor vuelve a validar cada cambio contra la categoría de la propuesta. Rechaza `originTier` de otra categoría, la eliminación de la marca exploratoria y los paquetes incompatibles. Para reconstruir un estudio confirmado exige la misma fuente, `searchScope`, política V12, configuración técnica (incluido el perfil automático para `uiMode: minimal`) y cambios exactos, incluida su identidad de paquete.

## Mantenimiento

Las reglas compartidas viven en `src/analysis/ScenarioPlanner.js`, la búsqueda en `src/analysis/ScenarioSearch.js` y `apps-script/ScenarioExplorer.html`, y la frontera de creación en `apps-script/ScenarioService.gs`. La guía y los criterios de Gemini siguen la misma clasificación; los prompts personalizados no reemplazan la validación del servidor.

Después de modificar módulos compartidos, ejecutar `npm run build:apps-script` para regenerar **ambos** artefactos: `apps-script/SimulationEngine.html` y `apps-script/ScenarioEngine.gs`. Desplegar los módulos Apps Script relacionados juntos.
