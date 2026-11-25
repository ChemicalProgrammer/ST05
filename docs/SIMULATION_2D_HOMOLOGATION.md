# Homologación de simulación numérica y simulación 2D

**Última actualización:** 24 de noviembre de 2026 (hora de México).
**Estado:** en progreso. Este documento es el registro vivo de la homologación; no reemplaza las pruebas ni la validación contra planta.

## 1. Objetivo y alcance

Alinear el comportamiento físico, la lógica de control y los criterios de contabilización de ambos motores, conservando la representación discreta de la simulación 2D. Comparar primero la producción total en botellas equivalentes y después el comportamiento y los tiempos por equipo. No dar por homologado un motor por el simple hecho de aproximarse a la producción real: también debe explicarse la diferencia entre motores.

Cambiar una etapa a la vez cuando sea posible; mantener constantes el caso, formato, duración, configuración de fallas y eventos y semilla de la corrida de referencia. La misma semilla sirve para reproducibilidad, pero no garantiza por sí sola secuencias aleatorias idénticas entre motores. No alterar la interfaz ni la física únicamente para forzar coincidencia de resultados.

## 2. Estado de la homologación

Tabla original confirmada por el usuario el 24 de noviembre. Se conservan las siete etapas, sus nombres, su orden y sus estados.

| Etapa | Estado |
| --- | --- |
| Startup, Prime y rampas | Implementado y evaluado |
| Exposición a fallas | Implementado |
| Sensores | Implementado |
| Descarga y overflow | Pendiente |
| Contadores | Parcialmente implementado |
| Resolución temporal | Pendiente |
| Validación contra planta | Pendiente |

**Interpretación:** «Implementado» significa que existe una corrección publicada, no que esté validada con el caso de planta. «Implementado y evaluado» indica que se realizó una comparación posterior al cambio, no necesariamente que se alcanzó equivalencia completa. «Pendiente» no implica ausencia total de lógica existente, sino que falta su revisión sistemática de homologación.

## 3. Resultados de referencia

Datos históricos recuperados de la conversación de homologación; no recalculados ejecutando los motores en esta actualización documental.

- Duración: 1,440 min.
- Semilla: `20261124`.
- Mantener el mismo caso, formato, calendario, eventos, fallas y configuración de equipos y conveyors al comparar.
- Usar la ronda 1 numérica como referencia fija para la siguiente comparación.

| Corrida / referencia | Producción (botellas) | Throughput (bpm) | Diferencia vs. planta |
| --- | ---: | ---: | ---: |
| Planta (real) | 170,376 | 118.32 | — |
| Simulación numérica, ronda 1 | 136,764 | 94.98 | −19.73% |
| Simulación 2D, anterior a etapa 1 | 194,640 | 135.17 | +14.24% |
| Simulación 2D, posterior a etapa 1 | 146,040 | 101.42 | −14.28% |
| Simulación 2D, posterior a etapa 2 (`PHYSICAL_FLOW_4`) | Pendiente | Pendiente | Pendiente |
| Simulación 2D, posterior a etapas 2 y 3 (`PHYSICAL_FLOW_5`) | Pendiente | Pendiente | Pendiente |

Después de la etapa 1, la diferencia 2D − numérica es +9,276 botellas. No utilizar la producción de las versiones anteriores como resultado de la corrección de exposición a fallas.

## 4. Registro de cambios publicados

Los commits indicados a continuación se verificaron en el historial de `main`. La presencia de pruebas en el repositorio no implica que se hayan ejecutado en esta actualización documental.

| Fecha local | Cambio | Evidencia |
| --- | --- | --- |
| 2026-11-24 | Persistencia y exportación opcional del estado 2D; resumen con producción, unidades, tiempos, fallas y origen de corrida. Apoyo transversal a la validación, no una etapa adicional. | [da6c363](https://github.com/ChemicalProgrammer/ST04/commit/da6c3631e9c03ecb5f09fe1cf2072ad8e4b2ef8a) |
| 2026-11-24 | Etapa 1: Startup, Prime y rampas; perfiles de reinicio basados en las demoras resueltas del conveyor y recuperación de Prime. Contadores por causa de reinicio. Política `PHYSICAL_FLOW_3`. | [a2951de](https://github.com/ChemicalProgrammer/ST04/commit/a2951deee814033346cec736e0542187dc622662) |
| 2026-11-24 | Etapa 2: exposición a fallas basada en los estados productivos. Política `PHYSICAL_FLOW_4`. Se distinguen tiempo de exposición y tiempo efectivamente cargado al reloj MTBF. | [7ae1681](https://github.com/ChemicalProgrammer/ST04/commit/7ae16811fa23050e6822cd382e2c5eb6bebdaf80) |

### Etapa 1: Startup, Prime y rampas

Implementada y evaluada en el caso de referencia; ver resultados de la sección 3. Los perfiles distinguen arranque inicial, recuperación por Prime, liberación de Back-up y recuperación tras reparación. Se incorporan diagnósticos de solicitudes de reinicio, tiempo de Starting y Ramp up por causa y espera de Prime. La revisión de sensores se registra por separado en la etapa 3.

### Etapa 2: Exposición a fallas

Corrección funcional de la etapa 2: `7ae16811fa23050e6822cd382e2c5eb6bebdaf80`.

- Archivos de aplicación: `apps-script/Simulation2DEngine.html` y `apps-script/Simulation2D.html`.
- Prueba incorporada: `test/Simulation2DReliabilityClock.test.js`.
- El reloj MTBF avanza durante Running, Ramp up, Ramp down y Discharging, no simplemente por conservar producto dentro del equipo.
- Back-up stop, Starting, Waiting for Prime, Starved, Blocked, Paused y las paradas externas no consumen exposición MTBF.
- `reliabilityExposureSeconds` mide exposición en estados elegibles; `reliabilityChargedSeconds` mide el tiempo cargado con fallas habilitadas y perfil válido. El umbral de falla se procesa en el siguiente límite de tick.
- La exportación distingue estos contadores y la política de control. Falta evaluar el efecto de la corrección en el caso de referencia.

### Etapa 3: Sensores (Prime y Back-up)

Política `PHYSICAL_FLOW_5`. Se avanzó a esta etapa por petición del usuario sin recibir todavía la corrida de la etapa 2. Las dos etapas permanecen implementadas pero sin evaluación del caso de referencia; una corrida en la política 5 medirá el efecto combinado. Para aislar cada efecto usar el commit `7ae1681` como referencia de etapa 2.

- Referencia: `src/simulation/LineSimulationEngine.js` (avance discreto de conveyors, autorización Prime y debounce Back-up). Se modifica únicamente el motor 2D, no el motor numérico.
- Prime exige una cola compacta y contigua desde la salida; umbral en unidades `max(1,min(floor(L/pitchAcumulado),ceil((L-P)/pitchAcumulado)))`, igual al modelo numérico. No confundir la obstrucción puntual del haz con una autorización. Una salida con Back-up activo inhibe la autorización incluso durante su tiempo de respuesta. El latch se rearma al solicitar reinicio.
- Back-up conserva la señal ocupada en huecos entre paquetes compactados; bordes inclusivos con tolerancia de 1e-6 mm. Requiere ocupación/claridad continuas durante los retardos configurados; un pulso contrario reinicia el contador. Si faltan retardos, el valor por defecto es 0 s, como en el motor numérico. Los sensores siguen observando producto inmóvil con la banda detenida.
- En transporte discreto el Back-up se libera por despeje continuo del sensor físico, no por la posición de liberación configurada. Se conserva esta última como dato diagnóstico; no se introduce una segunda fotocelda. Revisar aparte si se necesita cambiar esa política en ambos motores.
- El JSON incluye posición, haz bruto, estado de autorización Prime, unidades de cola y umbral, disparos Prime, ocupación y control Back-up, retardos, tiempo candidato y conteos de activaciones/liberaciones. Los datos instantáneos se muestrean después del movimiento y antes de transferencias. No se cambian las tarjetas ni la interfaz.
- Archivos: `apps-script/Simulation2DEngine.html`, `apps-script/Simulation2D.html`, `test/Simulation2DSensorPolicy.test.js`, y este documento; ver el commit que introduce esta sección.
- Pruebas: 18 casos ejecutados con el código JavaScript en un arnés aislado (aserciones y fixtures de las pruebas del repositorio, sin Node/npm); 18 pasaron. Incluye regresiones de sensores con y sin helper compartido, reinicio, MTBF, checkpoint y resumen. No se ejecutó la suite completa ni una corrida de planta.
- Pendiente: comprobar producción, disparos y tiempos en el caso real de referencia. No alterar la etapa 4 (descarga y overflow) hasta la siguiente intervención.

## 5. Pendientes y criterios de revisión

| Etapa | Alcance de revisión pendiente |
| --- | --- |
| Exposición a fallas | Ejecutar la nueva corrida 2D; comparar producción y, si están disponibles, fallas y tiempo de exposición. No marcar evaluado hasta registrar el resultado. |
| Sensores | Evaluar la política 5 en el caso de referencia y comparar los nuevos diagnósticos contra el motor numérico. |
| Descarga y overflow | Revisar producto descargado durante la parada, capacidad efectiva, acumulación y transferencias; comprobar conservación de producto. |
| Contadores | Homologar definiciones, unidades y exclusividad de estados; distinguir pérdidas internas y externas, y evitar doble conteo (Waiting for Prime ya forma parte de starving en el resumen 2D). |
| Resolución temporal | Medir sensibilidad al paso de integración y a los límites de tick; distinguir velocidad de reproducción de resolución del modelo. |
| Validación contra planta | Comparar resultados con datos reales, revisar por equipo y por turno si existen datos, y evaluar variación entre réplicas. |

Estos criterios son una guía de revisión, no una especificación de cambios ya aprobados ni evidencia de defectos confirmados.

## 6. Punto de continuación

1. Actualizar Apps Script con el commit de la etapa 3 (política `PHYSICAL_FLOW_5`).
2. Ejecutar únicamente la simulación 2D de referencia: 1,440 min, semilla `20261124`, mismos inputs, calendario y configuración que en la comparación anterior.
3. Guardar y exportar el caso con los resultados numéricos y Simulation 2D. Verificar corrida completa y política 5. Registrar producción, diferencia contra numérica y planta, y diagnósticos de sensores y fallas.
4. La política 5 contiene etapas 2 y 3; para medirlas por separado, ejecutar también la política 4 del commit `7ae1681` con idénticas condiciones. No atribuir automáticamente a sensores el cambio combinado.
5. La siguiente etapa de implementación es Descarga y overflow. Mantener los estados de validación pendientes hasta disponer de resultados.

No se requiere repetir todavía la corrida numérica de referencia si no cambian sus inputs o su motor.

## 7. Protocolo de mantenimiento

Al retomar el trabajo, leer primero este archivo en `main` y contrastarlo con el historial de commits. Actualizarlo en el mismo commit de cada modificación de homologación cuando sea viable, o en un commit documental posterior claramente vinculado. Registrar siempre:

- Fecha, etapa, estado y objetivo de la modificación.
- Commit y archivos afectados; pruebas añadidas y resultados efectivamente ejecutados (o «no ejecutadas»).
- Configuración de la corrida, semilla, versión de política, producción y otros indicadores efectivamente medidos; identificar datos ausentes.
- Impacto frente a la referencia, limitaciones y siguiente acción concreta.

No sobrescribir corridas históricas ni marcar como evaluada una modificación solamente por haber sido publicada. Mantener la tabla de siete etapas como resumen canónico; añadir los detalles en el registro y las secciones de resultados. Al concluir una sesión, dejar identificado el punto de continuación de la próxima.

Referencias internas: [Reloj MTBF](MTBF_OPERATING_CLOCK.md), [Rampas](RAMP_ACCOUNTING.md), [Comparación con planta](PLANT_COMPARISON_CONFIRMATIONS.md), [Exportación selectiva](SELECTIVE_CASE_EXPORT.md).
