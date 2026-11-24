# Metodología de escenarios en segundo plano

## Propósito y alcance

La política `MATCHED_CAPEX_V10` incorpora una cadena de evidencia para los escenarios existentes: diagnóstico compatible, hipótesis de intervención, experimentos, confirmación independiente, estimación económica y revisión pendiente en planta. La lógica trabaja detrás de las tarjetas y los controles actuales. No añade un formulario de inversión ni cambia la organización de la interfaz.

El resultado es un estudio trazable del paquete de cambios evaluado. Una mejora reproducida en el modelo no demuestra por sí misma la causa física de una falla, la posibilidad de alcanzar un MTBF propuesto, la conveniencia de comprar una máquina o el resultado futuro en planta.

Las implementaciones de referencia son:

| Responsabilidad | Fuente |
|---|---|
| Procedencia de resultados y diagnóstico de pérdidas | [ScenarioPlanner.js](../src/analysis/ScenarioPlanner.js), [SimulationProvenance.js](../src/simulation/SimulationProvenance.js) |
| Capacidad nominal y pérdidas observadas | [LinePerformanceAnalysis.js](../src/analysis/LinePerformanceAnalysis.js) |
| Diseño factorial y análisis | [ScenarioDOE.js](../src/analysis/ScenarioDOE.js) |
| Estadística de réplicas y tamaño de confirmación | [ScenarioStatistics.js](../src/analysis/ScenarioStatistics.js), [ScenarioSearch.js](../src/analysis/ScenarioSearch.js) |
| Estudio compacto y economía | [ScenarioMethodology.js](../src/analysis/ScenarioMethodology.js) |
| Ejecución y guardado de la evaluación | [ScenarioExplorer.html](../apps-script/ScenarioExplorer.html) |
| Creación del escenario y reconstrucción del estudio | [ScenarioService.gs](../apps-script/ScenarioService.gs) |
| Contexto resumido para el asistente | [GeminiContext.gs](../apps-script/GeminiContext.gs) |
| Exportación de APIs a navegador y Apps Script | [build-browser-engine.mjs](../scripts/build-browser-engine.mjs) |

## 1. Secuencia de trabajo

| Etapa | Información utilizada | Resultado y alcance |
|---|---|---|
| Diagnóstico | Resultados completos compatibles con el equipo, configuración, motor y procedencia actuales | Tiempos, frecuencias registradas, rankings y oportunidades; las causas permanecen como hipótesis. |
| Intervención | Cambios seleccionados, límites y fuentes reportadas | Diferencia entre ajuste operativo, mantenimiento, retrofit, reemplazo y sensibilidad exploratoria. |
| Exploración y DOE | Factores acotados, cambios fijos y réplicas con semillas pareadas | Comparaciones dentro del dominio ensayado; identifica efectos e interacciones. |
| Plan de confirmación | Diferencias entre réplicas del piloto de selección de finalistas | Número de réplicas fijado antes de observar la confirmación, con objetivo de precisión y tope. |
| Confirmación independiente | Base y candidato con iguales condiciones y semillas nuevas respecto del piloto | Evidencia de mejora práctica dentro del modelo, con precisión observada y protección frente a regresión media de OEE. |
| Economía | Diferencia de throughput confirmada y presupuesto asociado al paquete exacto | Producción aprovechable, contribución, VPN, recuperación simple y sensibilidad condicionada. |
| Validación en planta | Fuentes de ingeniería, cotizaciones, pruebas piloto y seguimiento | Se conserva lo reportado; el programa no certifica automáticamente esos documentos ni resultados. |

El estudio permite conservar una etapa como `NOT_EVALUATED` sin sustituir información faltante por cero, certeza o supuestos de factibilidad.

## 2. Diagnóstico compatible antes de proponer inversión

`diagnoseScenarioLosses(simulation)` revisa que exista un resultado completo con firma de entrada válida y versión de procedencia compatible. Compara los equipos, el motor, la unidad de flujo y la configuración de corrida con los datos actuales. Los resultados históricos o desactualizados conservan motivos explícitos, como `PROVENANCE_VERSION_MISMATCH`, `EQUIPMENT_CHANGED` o `RUN_CONFIGURATION_CHANGED`; no se convierten en un diagnóstico vigente.

En resultados con varias réplicas, el diagnóstico utiliza medias por equipo cuando están disponibles. No sustituye silenciosamente una media faltante por la observación de la primera réplica. La base temporal se identifica como duración media real de las réplicas o duración registrada del resultado.

Los rankings distinguen:

- Duración de paros propios, fallas y microparos.
- Duración de falta de suministro y bloqueo.
- Frecuencia de fallas y microparos, solamente cuando los eventos fueron registrados.

Un conteo ausente permanece desconocido. No se obtiene la frecuencia dividiendo tiempo detenido entre MTTR.

La estructura `attribution` declara que los estados de equipos no son pérdidas globales aditivas. Una falla puede causar falta de suministro aguas abajo y bloqueo aguas arriba; sumar esos minutos atribuiría varias veces el mismo episodio de línea. El equipo más detenido puede estar recibiendo la consecuencia de otra restricción.

`opportunities` conserva hipótesis como reducción de paros internos, revisión de suministro o buffer aguas arriba y capacidad o buffer aguas abajo. No elige automáticamente entre mantenimiento y reemplazo. El diagnóstico de capacidad nominal también es una referencia de diseño: excluye restricciones adicionales de transporte, arranques y paros, y no demuestra por sí solo el cuello de botella dinámico.

## 3. Hipótesis y clasificación de las intervenciones

El estudio relaciona los cambios de cada equipo con sus observaciones de pérdida y, cuando existe, su evidencia de limitación nominal. Se pueden añadir fuentes y una descripción mediante `simulation.whatIf.methodology.interventions`.

| Tipo reportado | Clase registrada | Interpretación |
|---|---|---|
| `OPERATIONAL` | `NONE` | Recursos existentes o prácticas de operación. |
| `MAINTENANCE` | `OPEX` | Recursos o actividades adicionales de mantenimiento. |
| `RETROFIT` | `CAPEX` | Rehabilitación o modificación localizada. |
| `REPLACEMENT` | `CAPEX` | Reemplazo completo del equipo. |
| `SENSITIVITY` o cambio `analysisOnly` | `UNASSIGNED` | Objetivo exploratorio del modelo; falta establecer la intervención realizable. |

Los alcances de las categorías de escenario siguen siendo `ZERO`, `MEDIUM` y `HIGH`. No se clasifican por un porcentaje obligatorio de mejora o por una cantidad monetaria inventada. Una sustitución puede aportar una mejora pequeña; esa mejora no establece que la sustitución sea rentable.

Si falta una intervención documentada, el estudio conserva clasificaciones como `INTERVENTION_UNSPECIFIED`, `PHYSICAL_CHANGE_UNSPECIFIED` u `OPERATING_PARAMETER_ADJUSTMENT`. Una descripción o cotización reportada no cambia `rootCauseVerified` ni `targetAchievabilityVerified` a verdadero. Los objetivos exploratorios conservan su condición aun cuando exista una descripción de reemplazo.

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

Las APIs de análisis aceptan `options.confidenceLevel`. La integración actual del explorador las llama sin esa opción, de modo que el DOE usa 0.95. El valor opcional `methodology.replications.confidenceLevel` se aplica a la confirmación final; actualmente no modifica la confianza del DOE integrado.

## 5. Horizontes comparables y plan fijo de confirmación

La exploración utiliza los perfiles existentes:

| Perfil | Horizonte de exploración | Factores máximos del perfil |
|---|---:|---:|
| `LIGHT` | 300 s | 0; omite DOE |
| `MEDIUM` | 600 s | 3 |
| `HIGH` | 900 s | 4 |

La selección de finalistas y la confirmación utilizan el horizonte completo previsto por What-If: al menos 1.800 s y, cuando es mayor, la duración configurada. `scenarioSearchRun()` prepara una copia con duración calendario fija. Retira el objetivo de tiempo efectivo de esa copia porque detener cada alternativa al alcanzar el mismo tiempo efectivo produciría exposiciones calendario diferentes. La configuración original del usuario permanece como fuente y el estudio registra esa base de comparación.

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

## 8. Contrato económico

`evaluateScenarioEconomics(simulation, evaluation, config?)` recibe por defecto `simulation.whatIf.methodology.economics`. Utiliza exclusivamente el paquete `evaluation.evaluatedChanges` y los promedios de su `independentCheck` satisfactorio. No utiliza la mejor cifra encontrada durante exploración.

### Datos requeridos

| Campo de `economics` | Unidad o condición |
|---|---|
| `packageSignature` | Firma canónica completa del paquete: `study.evaluatedPackage.signature`. Obligatoria. |
| `packageId` | Identificador corto opcional; si se proporciona, también debe coincidir. |
| `currency` | Tres letras mayúsculas, por ejemplo `MXN` o `USD`. La validación es sintáctica; no hace conversión de monedas. |
| `unitOfFlow` | `bottles`, `cases`, `pallets` o `units`, coherente con la comparación. No hay conversión automática entre botellas y cajas. |
| `investment` | Inversión inicial, en la moneda indicada; valor no negativo. |
| `installationCost` | Costo inicial de instalación; no negativo. |
| `implementationLoss` | Pérdida incremental durante la implementación, monetizada; no negativa. |
| `lifeYears` | Horizonte de vida: entero de 1 a 100 años. |
| `discountRate` | Tasa anual como fracción de 0 a 1; `0.10` equivale a 10%. |
| `annualOperatingMinutes` | Minutos calendario anuales aplicables: mayor que cero y hasta 527.040. |
| `contributionMarginPerUnit` | Contribución incremental por unidad de flujo; no es precio bruto de venta. |
| `annualIncrementalDemand` | Demanda adicional aprovechable por año en la misma unidad de flujo; no es demanda total de planta. |
| `annualAvoidableSavings` | Ahorros anuales evitables adicionales y separados del margen; no negativos. |
| `annualIncrementalOpex` | OPEX anual adicional separado de margen y ahorro; no negativo. |
| `residualValue` | Valor residual al final del último año; no negativo. |
| `benefitBasis` | Literal obligatorio: `INCREMENTAL_NON_OVERLAPPING`. |
| `annualizationBasis` | Literal obligatorio: `REPRESENTATIVE_CONFIRMATION_RATE`. |

Todos los números de la tabla son obligatorios para calcular la economía. Cero es válido donde se indica, pero ausencia, `null` y cadena vacía no significan cero. Los valores numéricos deben ser números, no cadenas. La función devuelve `missingInputs`, `invalidInputs` y `blockers` cuando corresponde; una comparación degradada, sin confirmación o sin fuente trazable queda `NOT_EVALUATED`.

### Ecuaciones y prevención de doble conteo

Sean `deltaQ` la diferencia confirmada de throughput, `M` los minutos anuales y `D` la demanda incremental aprovechable:

```text
Capacidad adicional anual = deltaQ * M
Producción adicional aprovechada = min(Capacidad adicional anual, D)
Contribución adicional = Producción adicional aprovechada * Margen por unidad
Beneficio neto anual = Contribución adicional + Ahorro evitable - OPEX adicional
Desembolso inicial = Inversión + Instalación + Pérdida de implementación
```

El margen debe descontar los costos incrementales propios de cada unidad. Esos mismos costos no deben cargarse de nuevo como OPEX ni reaparecer como ahorro. El ahorro separado debe corresponder a un gasto realmente evitable y distinto de la contribución de la producción adicional. La inversión y los gastos iniciales no se repiten en el flujo anual.

La implementación calcula flujos anuales constantes al final de cada año, con residual al final del último. El VPN descuenta esos flujos y resta el desembolso inicial. No incorpora por su cuenta impuestos, financiación, inflación, rampas de adopción, crecimiento comercial o valores residuales faltantes.

`simplePaybackYears` divide el desembolso inicial entre beneficio neto anual positivo. Excluye descuento y residual. `paybackWithinHorizon` indica si ese plazo cabe dentro de la vida declarada. Con desembolso cero o beneficio no positivo, el plazo es `null`.

`simpleLifetimeRoi` es una fracción acumulada de toda la vida: beneficio anual por años más residual menos desembolso inicial, dividido entre ese desembolso. No es una tasa anualizada y es `null` si el desembolso es cero. Un VPN positivo sigue siendo una estimación condicionada, no una autorización de inversión.

### Firma exacta y estimación consultiva

La firma canónica del paquete incluye la simulación y firma de origen, los cambios ordenados y sus datos de intervención, unidades y naturaleza exploratoria. El hash corto no basta: `packageSignature` debe coincidir íntegramente. Un presupuesto de una máquina no se hereda automáticamente cuando cambia el paquete evaluado.

Ejemplo de consulta desde el navegador, con importes ficticios explícitos y sin guardar ni aprobar un escenario:

```js
const study = STScenarios.study(simulation, evaluation);
const budget = {
  packageSignature: study.evaluatedPackage.signature,
  packageId: study.evaluatedPackage.id,
  currency: "MXN",
  unitOfFlow: "bottles",
  investment: 200000,
  installationCost: 20000,
  implementationLoss: 10000,
  lifeYears: 5,
  discountRate: 0.10,
  annualOperatingMinutes: 240000,
  contributionMarginPerUnit: 0.50,
  annualIncrementalDemand: 500000,
  annualAvoidableSavings: 0,
  annualIncrementalOpex: 12000,
  residualValue: 0,
  benefitBasis: "INCREMENTAL_NON_OVERLAPPING",
  annualizationBasis: "REPRESENTATIVE_CONFIRMATION_RATE"
};
const advisoryEstimate = STScenarios.economics(simulation, evaluation, budget);
```

La API pura no recalcula la firma actual del simulador ni vuelve a ejecutar el motor. El llamador debe usar una evaluación y una fuente verificadas. El flujo de creación en servidor sí comprueba la fuente vigente y vuelve a evaluar la confirmación guardada antes de reconstruir el estudio.

Los metadatos completos, incluidos los costos, participan en `methodologySignature`. Guardar un presupuesto nuevo dentro de `methodology` invalida la elegibilidad de una evaluación asociada a otros metadatos hasta recalcularla. Esta regla es conservadora, aunque pueda repetir cálculo cuando solo cambió un costo. La consulta con `config` explícita permite preparar una estimación aparte; no la convierte en evidencia vigente aprobada ni en validación de inversión.

### Sensibilidad económica

Cuando existe un intervalo de la diferencia media de throughput, la función propaga sus extremos manteniendo constantes los datos comerciales y financieros. El intervalo debe ser coherente con la diferencia confirmada. No se emplea un intervalo de exploración.

Esta sensibilidad representa únicamente incertidumbre de la media de la simulación condicionada al modelo. No incluye incertidumbre de costos, demanda, vida útil, datos de entrada o fidelidad del modelo. Si no existe inferencia por varianza observada cero, no se genera un intervalo monetario. Si un extremo implica pérdida de throughput, ese extremo queda sin valorar: monetizar esa pérdida requeriría demanda base adicional; no se reemplaza silenciosamente por cero.

## 9. Guardado y trazabilidad

Una evaluación conserva `searchPolicyVersion: "MATCHED_CAPEX_V10"`, `sourceSimulationId`, `sourceSignature`, metadatos canónicos y `methodologySignature`. Al guardarse, incluye su `study`; `lastResult` conserva el estudio del resultado anterior cuando se necesita mostrarlo junto a una configuración posterior todavía no evaluada.

Al crear un clon, el servidor busca una evaluación guardada del paquete exacto, la misma fuente, la política actual y los mismos metadatos. No acepta un estudio redactado por el cliente o por un agente como evidencia autoritativa. Recalcula la confirmación usando las réplicas conservadas y reconstruye el estudio. Sin evaluación actual coincidente, conserva el escenario como propuesta pendiente de evaluación.

El clon guarda la instantánea en `scenario.study`. Sus resultados de simulación se reinician y su `whatIf` no hereda el historial de búsqueda de la fuente. El estudio conserva el contexto de la decisión aunque luego se sustituya o elimine la evaluación fuente; no convierte la corrida de la base en una nueva corrida del clon.

La instantánea contiene:

- Fuente, identidad canónica del paquete, objetivo y base de comparación.
- Diagnóstico y motivos de compatibilidad, hipótesis, fuentes reportadas y límites de atribución.
- Factores DOE, cambios fijos, efectos, ANOVA, horizonte, semilla y réplicas por combinación.
- Respuestas DOE por réplica con solo `{seed, oee, throughput}`: hasta 16 combinaciones y 100 réplicas, con contadores explícitos de omisiones.
- Plan de confirmación, piloto, semillas, precisión, métricas e intervalos resumidos; el plan se etiqueta `CONFIRMATION_NOT_DOE` donde corresponde.
- Datos, fórmulas declaradas y resultado económico, cuando es evaluable.
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
| `economics.status: ESTIMATED` | Existe un cálculo incremental condicionado y ligado al paquete exacto. |
| `REPORTED_NOT_VERIFIED` | Documento, piloto, factibilidad o dato económico proporcionado, sin verificación automática. |
| `plantValidated: false` / `plantValidation.verified: false` | El resultado de la simulación no certifica una mejora en planta. |

La incertidumbre de las réplicas no corrige un modelo incompleto. Si la relación entre velocidad y calidad, MTBF y esfuerzo, disponibilidad de personal, obsolescencia o costos no está modelada, ningún DOE sobre ese modelo demuestra esas relaciones físicas. La decisión de inversión necesita intervención realizable, revisión económica con datos de negocio y confirmación posterior en planta.

## 11. Fundamento cualitativo de los manuales

El Manual Green Belt V28 aportado al proyecto respalda el orden del trabajo: la página 39 sitúa medición y línea base antes del análisis de causas, y luego incluye pruebas de hipótesis, ANOVA, DOE y piloto en sus etapas correspondientes. Las secciones de AMEF, comparación de alternativas y finanzas apoyan la separación entre problema, intervención y caso económico; el ejemplo de la página 78 distingue reparaciones, cambios de producto y variables de operación como problemas que requieren análisis diferentes.

Estas referencias se usan como fundamento cualitativo. Los manuales no se incorporan como datos de planta ni como garantía de que un objetivo técnico sea alcanzable. Las reglas exactas de pareamiento, control de procedencia, multiplicidad y conservación de evidencia son las especificadas y verificadas en el código de este proyecto.

## 12. APIs y verificación de mantenimiento

| Entorno | API |
|---|---|
| Módulos ESM | `buildScenarioStudy`, `evaluateScenarioEconomics`, `planScenarioConfirmation`, `assessScenarioConfirmation`, `scenarioPairedSummary`, `planScenarioReplications`, `createScenarioDOE`, `analyzeScenarioDOE`, `analyzeScenarioANOVA` |
| Navegador | `STScenarios.study`, `STScenarios.economics`, `STScenarioSearch.planConfirmation`, `STScenarioSearch.confirm`, `STScenarioSearch.pairedSummary`, `STScenarioDOE.design/analyze/anova` |
| Apps Script | `STScenarioEngine_.study`, `.economics`, `.confirm`, `.pairedSummary`, junto a las APIs existentes de diagnóstico y escenarios |

Las funciones de estudio y economía no mutan sus argumentos. Los bundles del navegador y de Apps Script se regeneran desde los módulos fuente:

```bash
npm run build:apps-script
```

La cobertura pertinente incluye valores estadísticos conocidos, pareamiento de semillas, contrastes con interacción, Holm, planificación del tamaño, rechazo de evidencia incompatible, cálculo financiero conocido, demanda limitada, costos faltantes, firma de paquete, snapshots, creación de escenarios y contexto del asistente. Las pruebas de `ScenarioStatistics.js` están incluidas en `ScenarioDOE.test.js`. Los siguientes archivos de prueba sirven como referencia de mantenimiento:

```bash
node --test test/ScenarioDOE.test.js test/ScenarioSearch.test.js test/ScenarioMethodology.test.js test/ScenarioService.test.js test/GeminiService.test.js
```

Una modificación de las reglas de búsqueda, la procedencia o el contrato de metadatos debe revisar también la política de reutilización. Las evaluaciones históricas pueden conservar su valor documental sin adquirir automáticamente la condición de evaluación vigente bajo una política posterior.
