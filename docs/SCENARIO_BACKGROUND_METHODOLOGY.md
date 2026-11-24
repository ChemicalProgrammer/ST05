# Metodología de escenarios en segundo plano

## Propósito y alcance

La política `MATCHED_CAPEX_V11` incorpora una cadena de evidencia para los escenarios existentes: resultado numérico completo, diagnóstico compatible, hipótesis de intervención, experimentos, selección escalonada, confirmación independiente y revisión pendiente en planta. La lógica trabaja detrás de las tarjetas y los controles actuales. No cambia la organización de la interfaz. En esta etapa, los presupuestos, montos de inversión y cálculos financieros quedan fuera del estudio normal; CAPEX clasifica el tipo de intervención.

El resultado es un estudio trazable del paquete de cambios evaluado. Una mejora reproducida en el modelo no demuestra por sí misma la causa física de una falla, la posibilidad de alcanzar un MTBF propuesto, la conveniencia de comprar una máquina o el resultado futuro en planta.

Las implementaciones de referencia son:

| Responsabilidad | Fuente |
|---|---|
| Procedencia de resultados y diagnóstico de pérdidas | [ScenarioReadiness.js](../src/analysis/ScenarioReadiness.js), [ScenarioPlanner.js](../src/analysis/ScenarioPlanner.js), [SimulationProvenance.js](../src/simulation/SimulationProvenance.js) |
| Capacidad nominal y pérdidas observadas | [LinePerformanceAnalysis.js](../src/analysis/LinePerformanceAnalysis.js) |
| Diseño factorial y análisis | [ScenarioDOE.js](../src/analysis/ScenarioDOE.js) |
| Estadística de réplicas y tamaño de confirmación | [ScenarioStatistics.js](../src/analysis/ScenarioStatistics.js), [ScenarioSearch.js](../src/analysis/ScenarioSearch.js) |
| Estudio técnico compacto y API económica separada | [ScenarioMethodology.js](../src/analysis/ScenarioMethodology.js) |
| Ejecución y guardado de la evaluación | [ScenarioExplorer.html](../apps-script/ScenarioExplorer.html) |
| Creación del escenario y reconstrucción del estudio | [ScenarioService.gs](../apps-script/ScenarioService.gs) |
| Contexto resumido para el asistente | [GeminiContext.gs](../apps-script/GeminiContext.gs) |
| Exportación de APIs a navegador y Apps Script | [build-browser-engine.mjs](../scripts/build-browser-engine.mjs) |

## 1. Secuencia de trabajo

| Etapa | Información utilizada | Resultado y alcance |
|---|---|---|
| Requisito de entrada | Corrida numérica al 100%, con las réplicas solicitadas, semillas únicas, duración y firma actuales | Habilita búsqueda y creación; resultados incompletos, históricos o desactualizados se rechazan. |
| Diagnóstico | Resultados completos compatibles con el equipo, configuración, motor y procedencia actuales | Tiempos, frecuencias registradas, rankings y oportunidades; las causas permanecen como hipótesis. |
| Intervención | Cambios seleccionados, límites y fuentes reportadas | Diferencia entre ajuste operativo, mantenimiento, retrofit, reemplazo y sensibilidad exploratoria. |
| Exploración y DOE | Factores acotados, cambios fijos y réplicas con semillas pareadas | Comparaciones dentro del dominio ensayado; identifica efectos e interacciones. |
| Selección escalonada | Finalistas de exploración comparados a 30 minutos, si el programa temporal permite el filtro | Reduce los finalistas enviados al horizonte completo; no certifica una mejora. |
| Plan de confirmación | Diferencias entre réplicas del piloto de selección de finalistas | Número de réplicas fijado antes de observar la confirmación, con objetivo de precisión y tope. |
| Confirmación independiente | Base y candidato con iguales condiciones y semillas nuevas respecto del piloto | Evidencia de mejora práctica dentro del modelo, con precisión observada y protección frente a regresión media de OEE. |
| Clasificación CAPEX | Tipo de intervención y alcance físico | Cero: recursos existentes/mantenimiento; medio: retrofit; alto: reemplazo o rediseño mayor. No utiliza presupuesto. |
| Validación en planta | Fuentes de ingeniería, cotizaciones, pruebas piloto y seguimiento | Se conserva lo reportado; el programa no certifica automáticamente esos documentos ni resultados. |

El estudio permite conservar una etapa como `NOT_EVALUATED` sin sustituir información faltante por cero, certeza o supuestos de factibilidad.

## 2. Resultado completo y diagnóstico compatible

`scenarioSourceReadiness(simulation)` se aplica antes de buscar o crear escenarios tanto en navegador como en servidor. Exige estado `COMPLETE`, las réplicas previstas, semillas únicas correspondientes al caso, métricas finitas y finalización del horizonte calendario o del objetivo de tiempo efectivo/límite configurado. Un indicador visual del 100% no sustituye esa evidencia. Las propuestas estáticas internas siguen disponibles como catálogo de variables e hipótesis; no autorizan a generar un escenario sin la corrida numérica completa.

`diagnoseScenarioLosses(simulation)` reutiliza ese mismo requisito y revisa que exista un resultado completo con firma de entrada válida y versión de procedencia compatible. Compara los equipos, el motor, la unidad de flujo y la configuración de corrida con los datos actuales. Los resultados históricos o desactualizados conservan motivos explícitos, como `PROVENANCE_VERSION_MISMATCH`, `EQUIPMENT_CHANGED` o `RUN_CONFIGURATION_CHANGED`; no se convierten en un diagnóstico vigente.

En resultados con varias réplicas, el diagnóstico utiliza medias por equipo cuando están disponibles. No sustituye silenciosamente una media faltante por la observación de la primera réplica. La base temporal se identifica como duración media real de las réplicas o duración registrada del resultado.

Los rankings distinguen:

- Duración de paros propios y fallas MTBF/MTTR, con categorías `MINOR`, `MAJOR` y `GENERAL`.
- Duración del proceso independiente `MICRO_STOP`, sin confundirlo con `MINOR`.
- Duración de falta de suministro y bloqueo.
- Frecuencia de fallas y microparos, solamente cuando los eventos fueron registrados.

Un conteo ausente permanece desconocido. No se obtiene la frecuencia dividiendo tiempo detenido entre MTTR.

La estructura `attribution` declara que los estados de equipos no son pérdidas globales aditivas. Una falla puede causar falta de suministro aguas abajo y bloqueo aguas arriba; sumar esos minutos atribuiría varias veces el mismo episodio de línea. El equipo más detenido puede estar recibiendo la consecuencia de otra restricción.

`opportunities` conserva hipótesis como reducción de paros internos, revisión de suministro o buffer aguas arriba y capacidad o buffer aguas abajo. No elige automáticamente entre mantenimiento y reemplazo. El diagnóstico de capacidad nominal también es una referencia de diseño: excluye restricciones adicionales de transporte, arranques y paros, y no demuestra por sí solo el cuello de botella dinámico.

### Desglose de paradas y alcance de los ajustes

`scenarioStopDataCoverage(simulation, equipment)` declara el origen y la cobertura de los datos. No utiliza un umbral de duración para inventar clases.

| Datos del caso | Lectura del algoritmo | Alcance disponible |
|---|---|---|
| Solo MTBF/MTTR general | `GENERAL`, sin división inferida | Simulación y comparación de flujo; no atribuye los beneficios a minor o major. |
| `stopInputs.minor` y `stopInputs.major` válidos | `SPLIT`; conserva sus frecuencias, duraciones y categorías declaradas | Diagnóstico por clase; la causa física aún necesita evidencia. |
| `noiseProfile.microStop` | Proceso `MICRO_STOP` independiente | Se mantiene separado de los eventos MTBF/MTTR minor. |
| Réplicas sin métricas por categoría | La métrica faltante queda `null` | No se sustituye por la primera réplica, por cero ni por una proporción supuesta. |

Se recomienda medir el desglose cuando la pregunta consiste en recuperar microparadas o decidir una intervención por tipo de paro. Las frecuencias minor/major deben referirse a la misma exposición operativa. Un MTBF y MTTR agregados no permiten reconstruir de manera única las dos frecuencias y las dos duraciones; clases con la misma media pueden producir consecuencias de acumulación diferentes. Por eso el desglose es necesario para atribución específica, pero no bloquea un experimento honesto de flujo con datos generales.

El dimensionamiento de recuperación usa el **MTTR minor declarado**. Un MTTR agregado corto no se convierte automáticamente en microparada; una clase minor larga tampoco se reclasifica por duración. La existencia de paradas major solicita revisión de causa e intervención, sin concluir que sean externas ni que el equipo deba reemplazarse.

Los candidatos de sensores, balanceo y recuperación reciben prioridad por exposición minor, `MICRO_STOP` y propagación de falta de suministro/bloqueo. Los tiempos propios major o generales no incrementan esa prioridad. Los ajustes de sensores/velocidad mantienen intactos los parámetros de ambos tipos de falla: buscan cambiar la propagación y recuperación del flujo. El número observado de eventos puede variar por la exposición productiva, sin demostrar una mejora física de confiabilidad.

Una modificación agregada de MTBF/MTTR, cuando se aporta como intervención documentada o sensibilidad explícita, afecta proporcionalmente **todas las clases de confiabilidad configuradas**; no se presenta como una mejora exclusiva de minor y no cambia el proceso `MICRO_STOP`. La búsqueda de confiabilidad prioriza fallas MTBF/MTTR, excluyendo ese proceso independiente. El estudio conserva `targetScope`, `stopDataCoverage` y `modeledStopEffect` para que ese alcance sea visible en la evidencia interna.

## 3. Hipótesis y clasificación de las intervenciones

El estudio relaciona los cambios de cada equipo con sus observaciones de pérdida y, cuando existe, su evidencia de limitación nominal. Se pueden añadir fuentes y una descripción mediante `simulation.whatIf.methodology.interventions`.

| Tipo reportado | Categoría de escenario | Naturaleza cualitativa | Interpretación |
|---|---|---|---|
| `OPERATIONAL` | `ZERO` | `NONE` | Recursos existentes o prácticas de operación. |
| `MAINTENANCE` | `ZERO` | `OPEX` | Actividades de mantenimiento sin nueva inversión de capital. |
| `RETROFIT` | `MEDIUM` | `CAPEX` | Rehabilitación o modificación localizada. |
| `REPLACEMENT` | `HIGH` | `CAPEX` | Reemplazo completo del equipo, cualquiera que sea su costo. |
| `SENSITIVITY` o cambio `analysisOnly` | `UNASSIGNED` | `UNASSIGNED` | Objetivo exploratorio del modelo; falta establecer la intervención realizable. |

Los alcances de las categorías de escenario siguen siendo `ZERO`, `MEDIUM` y `HIGH`. No se clasifican por un porcentaje obligatorio de mejora o por una cantidad monetaria inventada. Una sustitución puede aportar una mejora pequeña; esa mejora no establece que la sustitución sea rentable.

Si falta una intervención documentada, el estudio conserva clasificaciones como `INTERVENTION_UNSPECIFIED` u `OPERATING_PARAMETER_ADJUSTMENT`; la ampliación geométrica se registra como `LINE_REDESIGN`. Una descripción o cotización reportada no cambia `rootCauseVerified` ni `targetAchievabilityVerified` a verdadero. Los objetivos exploratorios conservan su condición aun cuando exista una descripción de reemplazo.

## 4. DOE factorial, semillas pareadas y multiplicidad

`createScenarioDOE(factors)` admite de uno a cuatro factores a dos niveles, con hasta 16 combinaciones. Los niveles deben ser numéricos, distintos y compatibles con las reglas de cada variable. Una combinación no evaluada o no factible impide presentar un diseño completo.

Las combinaciones comparten semillas: cada semilla constituye un bloque del experimento. El análisis de inferencia trabaja con un contraste factorial por semilla. Una muestra registrada cada pocos segundos durante una corrida no es una réplica independiente; tampoco lo es volver a ejecutar exactamente la misma semilla.

`analyzeScenarioDOE()` conserva efectos principales e interacciones de dos factores para su presentación. Cuando existen réplicas pareadas completas, incorpora estadística de los contrastes. `analyzeScenarioANOVA()` conserva además la descomposición del diseño factorial completo, incluidos términos de orden superior.

La inferencia principal se identifica como `PAIRED_CONTRASTS_ACROSS_INDEPENDENT_SEED_BLOCKS`:

- Los errores e intervalos se calculan a partir de los contrastes entre réplicas de semillas independientes.
- Los valores p se ajustan con Holm sobre la familia conjunta de efectos factoriales de OEE y throughput. La familia prevista incluye las hipótesis sin p calculable.
- Los intervalos Student son marginales. El ajuste Holm de valores p no los convierte en intervalos simultáneos.
- Los valores F y p del ANOVA bloqueado tradicional se conservan como información exploratoria; la covarianza inducida por números aleatorios comunes puede incumplir sus supuestos de error agrupado.
- Los diagnósticos de residuos son descriptivos. No se declara normalidad, independencia ni igualdad de varianzas demostradas por unas pocas réplicas.

Si la variación observada del contraste es cero, se conserva el efecto descriptivo con `inferenceAvailable: false`. No se inventa un p igual a cero ni un intervalo de certeza.

Los efectos se interpretan **condicionados a `doe.fixedChanges`, a la base y al rango de factores ensayado**. Por ejemplo, una mejora de sensor ensayada junto con una hipótesis fija de MTBF no demuestra el mismo efecto sin esa mejora de confiabilidad. Tampoco demuestra un óptimo global.

Los controles existentes conservan su alcance: `metadata.includeDOE` habilita DOE en el caso; profundidad, selección de variables, casilla DOE, límites bajo/alto y límite factible se guardan en la configuración del escenario. `LIGHT` omite DOE, `MEDIUM` admite hasta tres factores y `HIGH` hasta cuatro, también en la selección automática. Se evalúan las `2^k` combinaciones con tres réplicas pareadas por combinación. El ANOVA se calcula sobre esas mismas observaciones en `MEDIUM` y `HIGH`, sin añadir corridas.

`methodology.replications.confidenceLevel` se utiliza ahora en el screening, DOE/ANOVA y confirmación, con 0.95 por defecto. Las APIs aceptan `options.confidenceLevel`, `options.alpha` o el alias `options.confidence`; parámetros contradictorios se rechazan y `alpha = 1 - confidenceLevel`. No se añade un formulario nuevo. La ampliación exploratoria de tres a seis semillas sigue siendo selección preliminar; no se confunde con la confirmación independiente de tamaño fijado por anticipado.

## 5. Horizontes comparables y plan fijo de confirmación

La exploración utiliza los perfiles existentes:

| Perfil | Horizonte de exploración | Factores máximos del perfil |
|---|---:|---:|
| `LIGHT` | 300 s | 0; omite DOE |
| `MEDIUM` | 600 s | 3 |
| `HIGH` | 900 s | 4 |

Para horizontes largos se añade una selección intermedia de 1.800 s antes de invertir el tiempo de cálculo del día completo. Por defecto, se conservan hasta dos finalistas de flujo en `LIGHT`/`MEDIUM` y tres en `HIGH`; los finalistas retenidos que incluyen cambios de confiabilidad se protegen porque una falla rara puede no aparecer en treinta minutos, por lo que el total puede superar ese límite. Esta protección no garantiza que todos los objetivos inicialmente explorados entren a la lista de finalistas. Se omite el filtro corto si existen órdenes o eventos de calendario que realmente se ejecutan, si el horizonte completo es de una hora o menos, o si ya hay pocos candidatos. Un calendario deshabilitado o usado únicamente para contabilidad no obliga a saltarse el filtro.

El filtro es exploratorio y puede omitir una configuración cuya ventaja aparece tarde; no demuestra ausencia de mejora ni un óptimo global. `rankingPlan` y `phaseAudit.finalistScreening` registran horizontes, seleccionados, omitidos y candidatos protegidos. La instantánea compacta conserva esos datos en `study.evidence.finalistSelection`.

### Costo de cálculo y comprobación de rendimiento

Con residencia de máquinas habilitada, el motor conserva un paso físico de 1/120 s. Un día representa 10.368.000 pasos por réplica; seis finalistas con tres réplicas representan 186.624.000 pasos, antes de sumar base, exploración y confirmación. `summaryOnly` y los workers evitan tareas de presentación y mantienen la interfaz disponible, pero no eliminan ese trabajo físico.

Ejemplo de trabajo virtual en la clasificación de seis finalistas de flujo, sin eventos que impidan el filtro, con horizonte de 1.440 minutos y profundidad `MEDIUM`:

| Trabajo | Antes | Con selección intermedia |
|---|---:|---:|
| Base y seis finalistas a 30 min × 3 réplicas | 0 min virtuales | 630 min virtuales |
| Clasificación a 1.440 min × 3 réplicas | 7 configuraciones: 30.240 min virtuales | Base y dos finalistas: 12.960 min virtuales |
| Total de esta fase | 30.240 min virtuales | 13.590 min virtuales |

La reducción es aproximadamente 55 % del trabajo virtual de esta fase. No es una promesa del mismo porcentaje de reducción en el tiempo total; exploración, DOE, confirmación y costos de ejecución permanecen. La confirmación no se acorta.

El motor además omite el paso de transporte en conexiones internas sin cinta física; la transferencia directa sigue calculándose. Benchmark local con Node 24.22.3, cuatro variantes demo de 19 equipos, dos semillas y 600 s por corrida: 13,574 s acumulados antes frente a 12,508 s después (aproximadamente 7,9 % menos). Se comparó la respuesta completa con igualdad exacta en modo resumen y también en corridas detalladas con eventos y replay. No se modificaron el paso, las semillas ni los resultados físicos. Es una medición local, no la latencia del navegador del usuario ni una ejecución de su caso de 24 horas.

Comando reproducible con una copia del motor anterior en `BASELINE_DIR`:

```bash
node scripts/benchmark-simulation.mjs --baseline BASELINE_DIR --duration 600 --rounds 2 --output benchmark.json
```

Los finalistas retenidos y la confirmación siguen utilizando el horizonte completo previsto por What-If: al menos 1.800 s y, cuando es mayor, la duración configurada. `scenarioSearchRun()` prepara una copia con duración calendario fija. Retira el objetivo de tiempo efectivo de esa copia porque detener cada alternativa al alcanzar el mismo tiempo efectivo produciría exposiciones calendario diferentes. La configuración original del usuario permanece como fuente y el estudio registra esa base de comparación.

La exploración y el DOE utilizan sus propias réplicas, normalmente tres. La confirmación tiene un tamaño calculado por separado; no debe describirse un DOE de tres réplicas como un DOE de 12 porque su candidato luego se confirmó con 12.

`planScenarioConfirmation()` utiliza el piloto de selección de finalistas para llamar a `planScenarioReplications()`. Los valores predeterminados son:

| Parámetro | Valor predeterminado | Significado |
|---|---:|---|
| `minimum` | 3 | Mínimo de réplicas de confirmación. |
| `maximum` | 30 | Tope de réplicas de confirmación. |
| `confidenceLevel` | 0.95 | Confianza nominal del intervalo de la diferencia media. |
| `relativePrecision` | 0.005 | Semiancho objetivo como fracción del throughput medio de la base del piloto. |
| `absolutePrecision` | Ausente | Cuando se proporciona, reemplaza la precisión relativa y se expresa en unidades de flujo/min. |

El cálculo usa la desviación de las diferencias pareadas del piloto y el cuantil Student correspondiente al tamaño propuesto. Fija el tamaño antes de examinar los resultados independientes. No añade réplicas hasta conseguir un p favorable.

El plan conserva semillas del piloto, desviación del piloto, throughput base, semiancho previsto, tamaño requerido, tamaño permitido y condición de tope. Si la variación observada del piloto es cero, utiliza `min(maximum, max(minimum, 6))` réplicas, sin declarar que la variabilidad real sea nula. Si la precisión exigiría más que el máximo, conserva `capped: true` y la limitación explícita.

## 6. Confirmación y criterio de mejora

`assessScenarioConfirmation()` exige condiciones comparables: horizonte calendario, unidades, duración de cada réplica, métricas finitas y concordancia de las medias agregadas con esas réplicas. Empareja por identificador de semilla, exige identificadores únicos y rechaza el solapamiento entre semillas de confirmación y piloto. Los identificadores únicos son una condición de integridad; no prueban por sí solos independencia de los generadores.

Con inferencia disponible, el límite inferior del intervalo de la diferencia de throughput debe superar el umbral práctico. El umbral es el máximo entre 0.001 unidades/min, 0.1% del throughput base y el mínimo práctico indicado para throughput. Adicionalmente, no debe existir regresión observada en el OEE medio.

La protección de OEE se conserva en `oeeGuard`. Es una comprobación de la diferencia media observada; `statisticalNonInferiorityEstablished` permanece falso. No equivale a un estudio estadístico de no inferioridad con margen previamente definido.

Cuando las réplicas presentan la misma diferencia sin variación estimable, puede existir `DESCRIPTIVE_REPRODUCTION`. El resultado identifica expresamente que no existe un intervalo inferencial ni certeza estadística. Los otros tipos principales son `PAIRED_CONFIDENCE_INTERVAL` e `INFERENCE_UNAVAILABLE`.

`precision.met` informa si el intervalo obtenido alcanzó la precisión solicitada. Un plan con tope o una precisión no alcanzada no se disfraza como precisión lograda. El criterio de mejora y la precisión son campos separados: la implementación puede establecer una ganancia práctica mediante el límite inferior aunque el semiancho solicitado no se haya alcanzado.

La meta opcional `objective.target` se compara después con el candidato confirmado. No es una promesa de que la búsqueda encontrará esa meta. Una meta de OEE conserva sus unidades de porcentaje/puntos porcentuales; no se transforma en un umbral de botellas/min. La aceptación de escenarios continúa exigiendo mejora de throughput y protección de OEE.

## 7. Metadatos opcionales

El punto de extensión es `simulation.whatIf.methodology`. Sus secciones son opcionales. La omisión conserva los valores predeterminados de búsqueda y deja sin evaluar los apartados que necesitan datos adicionales.

Ejemplo ilustrativo de estructura; los valores y referencias no representan un caso aprobado:

```js
simulation.whatIf.methodology = {
  objective: {
    metric: "throughput",              // "throughput" u "oee"
    target: 180,
    unit: "bottles/min",               // "bpm" también para bottles; "%" para OEE
    minimumPracticalGain: 0.5,
    description: "Meta documentada del estudio"
  },
  replications: {
    minimum: 3,
    maximum: 30,
    confidenceLevel: 0.95,
    relativePrecision: 0.005
    // absolutePrecision: 0.5          // Si existe, prevalece sobre relativePrecision.
  },
  interventions: [{
    id: "retrofit-filler-01",
    equipmentId: "filler",
    paths: ["noiseProfile.reliability.mtbfMinutes"],
    type: "RETROFIT",
    description: "Intervención propuesta sobre el componente identificado",
    targetSource: "Fuente técnica reportada",
    sourceReference: "Identificador del documento de soporte",
    feasibility: { description: "Revisión de ingeniería reportada" },
    pilot: { date: "2026-11-24", result: "Resultado reportado; verificar en planta" }
  }]
};
```

`paths` limita los cambios cubiertos por una intervención. Sin `paths`, la coincidencia se realiza por equipo. Si varias intervenciones coinciden con el mismo equipo y ruta, se utiliza la primera; conviene evitar registros ambiguos.

Las metas requieren unidad y magnitud coherentes para que el estudio las declare comparables. Para OEE, el objetivo se expresa de 0 a 100 y el mínimo práctico en puntos porcentuales. Para throughput, se utiliza la unidad de flujo por minuto. `minimum` y `maximum` son enteros, el mínimo debe ser al menos tres y el máximo no puede ser menor. La confianza es una fracción estrictamente entre cero y uno; la precisión debe ser positiva.

Las fuentes, factibilidad y piloto son datos reportados. Incluso un campo proporcionado con el nombre `verified` o `validated` queda dentro de `REPORTED_NOT_VERIFIED`; no altera la validación del estudio.

## 8. Presupuestos fuera del estudio técnico

El estudio normal devuelve `economics.status: "NOT_EVALUATED"`, `reason: "OUT_OF_SCOPE"` y `monetaryInputsRequired: false`. No solicita montos, no calcula rentabilidad y no usa presupuestos para ordenar o clasificar escenarios. Una sustitución completa es `HIGH` por el tipo de intervención; una optimización de sensores con los recursos existentes es `ZERO` por su alcance.

`scenarioTechnicalMethodology(methodology)` prepara los metadatos técnicos para la identidad de la búsqueda: crea una copia canónica con claves ordenadas y excluye únicamente los campos monetarios de primer nivel `economics`, `budget`, `capexBudget` e `investmentBudget`. Conserva las hipótesis, fuentes, objetivos, parámetros estadísticos y `costClass` cualitativo. Cambiar un presupuesto no obliga a repetir la simulación técnica.

La función separada `evaluateScenarioEconomics(simulation, evaluation, config?)` se conserva como API de uso explícito para trabajos futuros. No se ejecuta al construir un estudio CAPEX normal. Si se llama deliberadamente, exige datos suficientes asociados al paquete exacto y evidencia de confirmación; la ausencia de datos nunca se sustituye por costo cero. Su resultado separado no constituye un requisito de búsqueda, criterio de selección ni validación de inversión.

## 9. Guardado y trazabilidad

Una evaluación conserva `searchPolicyVersion: "MATCHED_CAPEX_V11"`, `sourceSimulationId`, `sourceSignature`, metadatos técnicos canónicos y `methodologySignature`. Al guardarse, incluye su `study`; `lastResult` conserva el estudio del resultado anterior cuando se necesita mostrarlo junto a una configuración posterior todavía no evaluada.

Al crear un clon, el servidor busca una evaluación guardada del paquete exacto, la misma fuente, la política actual y los mismos metadatos. La fuente debe seguir teniendo una corrida numérica completa y vigente. No acepta un estudio redactado por el cliente o por un agente como evidencia autoritativa. Recalcula la confirmación usando las réplicas conservadas y reconstruye el estudio. Sin evaluación actual coincidente, conserva el escenario como propuesta pendiente de evaluación.

El clon guarda la instantánea en `scenario.study`. Sus resultados de simulación se reinician y su `whatIf` no hereda el historial de búsqueda de la fuente. El estudio conserva el contexto de la decisión aunque luego se sustituya o elimine la evaluación fuente; no convierte la corrida de la base en una nueva corrida del clon.

La instantánea contiene:

- Fuente, identidad canónica del paquete, objetivo y base de comparación.
- Diagnóstico y motivos de compatibilidad, hipótesis, fuentes reportadas y límites de atribución.
- Factores DOE, cambios fijos, efectos, ANOVA, horizonte, semilla y réplicas por combinación.
- Respuestas DOE por réplica con solo `{seed, oee, throughput}`: hasta 16 combinaciones y 100 réplicas, con contadores explícitos de omisiones.
- Plan de confirmación, piloto, semillas, precisión, métricas e intervalos resumidos; el plan se etiqueta `CONFIRMATION_NOT_DOE` donde corresponde.
- Política de selección escalonada, horizontes, candidatos retenidos/omitidos y limitación del filtro corto.
- Clasificación por intervención y exclusión explícita de presupuestos del estudio técnico.
- Estado separado de factibilidad y validación en planta.

Las copias generales están acotadas y excluyen replay, historiales completos de pruebas y estudios recursivos. El estudio compacto no pretende sustituir un archivo completo del modelo y de todas las corridas para reproducir cada detalle. El contexto de Gemini utiliza un resumen aún menor y conserva las limitaciones para no confundir fuentes reportadas con verificadas.

## 10. Estados y límites de interpretación

| Estado o campo | Significado |
|---|---|
| `source.status: RECORDED` | Identificadores y valores iniciales registrados coherentes; el llamador conserva la responsabilidad de verificar la firma vigente. |
| `MODEL_REPRODUCED` | El paquete conserva confirmación válida dentro del modelo. |
| `DESCRIPTIVE_REPRODUCTION` | La mejora se repitió sin varianza observada estimable; no hay garantía estadística. |
| `NOT_REPRODUCED` | La confirmación registrada no aprobó el criterio. |
| `INVALID_OR_INCOMPLETE_CONFIRMATION` | Una afirmación de aprobación no está respaldada por métricas completas y coherentes. |
| `REQUIRES_ENGINEERING_REVIEW` | La factibilidad y la capacidad de alcanzar los objetivos requieren revisión. |
| `economics.reason: OUT_OF_SCOPE` | Presupuestos y cálculo financiero no intervienen en el estudio técnico normal. |
| `REPORTED_NOT_VERIFIED` | Documento, piloto o factibilidad proporcionados, sin verificación automática. |
| `plantValidated: false` / `plantValidation.verified: false` | El resultado de la simulación no certifica una mejora en planta. |

La incertidumbre de las réplicas no corrige un modelo incompleto. Si la relación entre velocidad y calidad, MTBF y esfuerzo, disponibilidad de personal, obsolescencia o costos no está modelada, ningún DOE sobre ese modelo demuestra esas relaciones físicas. Esta etapa genera hipótesis y compara desempeño técnico; no toma una decisión monetaria de inversión. La intervención requiere revisión de factibilidad y confirmación posterior en planta.

## 11. Fundamento cualitativo de los manuales

El Manual Green Belt V28 aportado al proyecto respalda el orden del trabajo: la página 39 sitúa medición y línea base antes del análisis de causas, y luego incluye pruebas de hipótesis, ANOVA, DOE y piloto en sus etapas correspondientes. Las secciones de AMEF, comparación de alternativas y finanzas apoyan la separación entre problema, intervención y caso económico; el ejemplo de la página 78 distingue reparaciones, cambios de producto y variables de operación como problemas que requieren análisis diferentes.

Estas referencias se usan como fundamento cualitativo. Los manuales no se incorporan como datos de planta ni como garantía de que un objetivo técnico sea alcanzable. Las reglas exactas de pareamiento, control de procedencia, multiplicidad y conservación de evidencia son las especificadas y verificadas en el código de este proyecto.

## 12. APIs y verificación de mantenimiento

| Entorno | API |
|---|---|
| Módulos ESM | `scenarioSourceReadiness`, `scenarioStopDataCoverage`, `scenarioTechnicalMethodology`, `buildScenarioStudy`, `evaluateScenarioEconomics`, `planScenarioConfirmation`, `assessScenarioConfirmation`, `scenarioPairedSummary`, `planScenarioReplications`, `createScenarioDOE`, `analyzeScenarioDOE`, `analyzeScenarioANOVA` |
| Navegador | `STScenarios.study`, `STScenarios.economics`, `STScenarioSearch.planConfirmation`, `STScenarioSearch.confirm`, `STScenarioSearch.pairedSummary`, `STScenarioDOE.design/analyze/anova` |
| Apps Script | `STScenarioEngine_.study`, `.economics`, `.confirm`, `.pairedSummary`, junto a las APIs existentes de diagnóstico y escenarios |

Las funciones de estudio y economía no mutan sus argumentos. Los bundles del navegador y de Apps Script se regeneran desde los módulos fuente:

```bash
npm run build:apps-script
```

La cobertura pertinente incluye valores estadísticos conocidos, pareamiento de semillas, contrastes con interacción, Holm, planificación del tamaño, rechazo de evidencia incompatible, cálculo financiero conocido, demanda limitada, costos faltantes, firma de paquete, snapshots, creación de escenarios y contexto del asistente. Las pruebas de `ScenarioStatistics.js` están incluidas en `ScenarioDOE.test.js`. Los siguientes archivos de prueba sirven como referencia de mantenimiento:

```bash
node --test test/ScenarioDOE.test.js test/ScenarioSearch.test.js test/ScenarioMethodology.test.js test/ScenarioService.test.js test/ScenarioStopClasses.test.js test/GeminiService.test.js
```

Una modificación de las reglas de búsqueda, la procedencia o el contrato de metadatos debe revisar también la política de reutilización. Las evaluaciones históricas pueden conservar su valor documental sin adquirir automáticamente la condición de evaluación vigente bajo una política posterior.
