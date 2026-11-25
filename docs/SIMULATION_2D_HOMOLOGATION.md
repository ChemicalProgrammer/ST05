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
| Exposición a fallas | Implementado y evaluado (en conjunto con sensores) |
| Sensores | Implementado y evaluado (en conjunto con exposición a fallas) |
| Descarga y overflow | Implementado y evaluado (2D; comparación numérica actual pendiente) |
| Contadores | Parcialmente implementado |
| Resolución temporal | Pendiente |
| Validación contra planta | Pendiente |

**Interpretación:** «Implementado» significa que existe una corrección publicada, no que esté validada con el caso de planta. «Implementado y evaluado» indica que se realizó una comparación posterior al cambio, no necesariamente que se alcanzó equivalencia completa. «Pendiente» no implica ausencia total de lógica existente, sino que falta su revisión sistemática de homologación.

## 3. Resultados de referencia

Datos históricos de la conversación y última evidencia del archivo de caso exportado por el usuario. No se ejecutaron nuevas corridas en esta actualización documental.

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
| Simulación 2D, posterior a etapas 2 y 3 (`PHYSICAL_FLOW_5`) | 152,376 | 105.82 | −10.56% |
| Simulación numérica corregida (ST_CURRENT 0.20.2) | Pendiente | Pendiente | Pendiente |
| Simulación 2D, posterior a etapa 4 (`PHYSICAL_FLOW_6`) | 207,132 | 143.84 | +21.57% |

Después de la etapa 1, la diferencia 2D − numérica era +9,276 botellas; después de las etapas 2 y 3 es +15,612. La brecha absoluta frente a planta disminuyó de 24,336 a 18,000 botellas (+6,336 de producción, reducción de 26.04% de la brecha). La brecha entre motores aumentó. La etapa 2 no se evaluó aisladamente; no atribuir la mejora combinada solamente a sensores.

## 4. Registro de cambios publicados

Los commits indicados a continuación se verificaron en el historial de `main`. La presencia de pruebas en el repositorio no implica que se hayan ejecutado en esta actualización documental.

| Fecha local | Cambio | Evidencia |
| --- | --- | --- |
| 2026-11-24 | Persistencia y exportación opcional del estado 2D; resumen con producción, unidades, tiempos, fallas y origen de corrida. Apoyo transversal a la validación, no una etapa adicional. | [da6c363](https://github.com/ChemicalProgrammer/ST04/commit/da6c3631e9c03ecb5f09fe1cf2072ad8e4b2ef8a) |
| 2026-11-24 | Etapa 1: Startup, Prime y rampas; perfiles de reinicio basados en las demoras resueltas del conveyor y recuperación de Prime. Contadores por causa de reinicio. Política `PHYSICAL_FLOW_3`. | [a2951de](https://github.com/ChemicalProgrammer/ST04/commit/a2951deee814033346cec736e0542187dc622662) |
| 2026-11-24 | Etapa 2: exposición a fallas basada en los estados productivos. Política `PHYSICAL_FLOW_4`. Se distinguen tiempo de exposición y tiempo efectivamente cargado al reloj MTBF. | [7ae1681](https://github.com/ChemicalProgrammer/ST04/commit/7ae16811fa23050e6822cd382e2c5eb6bebdaf80) |
| 2026-11-24 | Etapa 3: homologación de sensores y nuevos diagnósticos. Política `PHYSICAL_FLOW_5`. | [cf8d1e5](https://github.com/ChemicalProgrammer/ST04/commit/cf8d1e5d8e56af28af0735e51b0c8eb6c51e06d2) |
| 2026-11-24 | Evaluación conjunta de etapas 2 y 3 con exportación de línea G, revisión 50. Se registran resultados, balance y próximos pasos sin cambiar código. | Sección 4, evidencia de corrida G |

### Etapa 1: Startup, Prime y rampas

Implementada y evaluada en el caso de referencia; ver resultados de la sección 3. Los perfiles distinguen arranque inicial, recuperación por Prime, liberación de Back-up y recuperación tras reparación. Se incorporan diagnósticos de solicitudes de reinicio, tiempo de Starting y Ramp up por causa y espera de Prime. La revisión de sensores se registra por separado en la etapa 3.

### Etapa 2: Exposición a fallas

Corrección funcional de la etapa 2: `7ae16811fa23050e6822cd382e2c5eb6bebdaf80`.

- Archivos de aplicación: `apps-script/Simulation2DEngine.html` y `apps-script/Simulation2D.html`.
- Prueba incorporada: `test/Simulation2DReliabilityClock.test.js`.
- El reloj MTBF avanza durante Running, Ramp up, Ramp down y Discharging, no simplemente por conservar producto dentro del equipo.
- Back-up stop, Starting, Waiting for Prime, Starved, Blocked, Paused y las paradas externas no consumen exposición MTBF.
- `reliabilityExposureSeconds` mide exposición en estados elegibles; `reliabilityChargedSeconds` mide el tiempo cargado con fallas habilitadas y perfil válido. El umbral de falla se procesa en el siguiente límite de tick.
- La exportación distingue estos contadores y la política de control. Evaluada junto con etapa 3; pendiente aislar el efecto mediante una corrida de política 4.

### Etapa 3: Sensores (Prime y Back-up)

Política `PHYSICAL_FLOW_5`. Se avanzó a esta etapa por petición del usuario sin recibir todavía la corrida de la etapa 2. Las dos etapas ya tienen evaluación conjunta en la política 5, documentada a continuación. Para aislar cada efecto usar el commit `7ae1681` como referencia de etapa 2.

- Referencia: `src/simulation/LineSimulationEngine.js` (avance discreto de conveyors, autorización Prime y debounce Back-up). Se modifica únicamente el motor 2D, no el motor numérico.
- Prime exige una cola compacta y contigua desde la salida; umbral en unidades `max(1,min(floor(L/pitchAcumulado),ceil((L-P)/pitchAcumulado)))`, igual al modelo numérico. No confundir la obstrucción puntual del haz con una autorización. Una salida con Back-up activo inhibe la autorización incluso durante su tiempo de respuesta. El latch se rearma al solicitar reinicio.
- Back-up conserva la señal ocupada en huecos entre paquetes compactados; bordes inclusivos con tolerancia de 1e-6 mm. Requiere ocupación/claridad continuas durante los retardos configurados; un pulso contrario reinicia el contador. Si faltan retardos, el valor por defecto es 0 s, como en el motor numérico. Los sensores siguen observando producto inmóvil con la banda detenida.
- En transporte discreto el Back-up se libera por despeje continuo del sensor físico, no por la posición de liberación configurada. Se conserva esta última como dato diagnóstico; no se introduce una segunda fotocelda. Revisar aparte si se necesita cambiar esa política en ambos motores.
- El JSON incluye posición, haz bruto, estado de autorización Prime, unidades de cola y umbral, disparos Prime, ocupación y control Back-up, retardos, tiempo candidato y conteos de activaciones/liberaciones. Los datos instantáneos se muestrean después del movimiento y antes de transferencias. No se cambian las tarjetas ni la interfaz.
- Archivos: `apps-script/Simulation2DEngine.html`, `apps-script/Simulation2D.html`, `test/Simulation2DSensorPolicy.test.js`, y este documento; ver el commit que introduce esta sección.
- Pruebas: 18 casos ejecutados con el código JavaScript en un arnés aislado (aserciones y fixtures de las pruebas del repositorio, sin Node/npm); 18 pasaron. Incluye regresiones de sensores con y sin helper compartido, reinicio, MTBF, checkpoint y resumen. No se ejecutó la suite completa ni una corrida de planta.
- Evaluación conjunta registrada; equivalencia entre motores todavía no demostrada. La siguiente intervención se concentra en descarga y overflow.

### Evidencia de corrida G — etapas 2 y 3 (24 de noviembre)

Fuente: exportación entregada por el usuario `G-complete (6).json`, caso G, Simulation A, revisión 50, SHA-256 `bc18e8d75b5ab8fe035f7a2acc0fe11ee324b77ab2117b9c462b8f133409960c`. Se registran cifras agregadas pertinentes, no el JSON completo. El resumen 2D indica `PHYSICAL_FLOW_5`, `INDEPENDENT`, `Completed`, `complete: true`, 86,400 s y semilla 20261124. Formato S de 12 botellas/caja. Fallas habilitadas; eventos y calendario deshabilitados según opciones de captura. La ronda 1 numérica guardada usa la misma semilla y duración, y su firma de equipos coincide exactamente con los equipos de la simulación guardada. El paso efectivo numérico es 0.05 s (FAST; solicitado 0.25 s), mientras que el código 2D usa 1/120 s nominal. El archivo no demuestra que las opciones se mantuvieran durante toda la corrida ni que las secuencias aleatorias sean iguales. No se volvió a ejecutar ningún motor.

**Producción y referencia:** 12,698 cajas = 152,376 botellas en 2D, contra 11,397 cajas = 136,764 botellas en numérica ronda 1 y 14,198 cajas = 170,376 botellas reportadas en planta. Cociente de producción contra ideal de Filler de 316,800 botellas: 48.10% (2D) y 43.17% (numérica); no equiparar a OEE de planta sin conciliar denominadores y definiciones. Las otras rondas numéricas registran 140,256 y 134,664 botellas (semillas 20261125 y 20261126); no compararlas como si tuvieran la misma semilla.

| Equipo | Producción numérica (botellas equiv.) | Producción 2D (botellas equiv.) | Fallas num. / 2D | Waiting for Prime num. / 2D (min) | Exposición MTBF num. / 2D (min) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scrambler | 143,135 | 153,348 | 16 / 11 | 0 / 0 | 486.99 / 596.75 |
| Virtual inlet | 140,180 | 153,096 | 159 / 153 | 247.50 / 176.87 | 703.02 / 677.57 |
| Filler | 140,180 | 152,706 | 52 / 47 | 208.78 / 157.01 | 589.88 / 679.84 |
| Case Packer | 136,776 | 152,544 | 60 / 70 | 196.39 / 151.31 | 626.92 / 669.13 |
| Palletizer | 136,764 | 152,376 | 23 / 18 | 740.84 / 680.91 | 668.50 / 736.92 |

El rótulo de base MTBF guardado en numérica es `POSITIVE_PROCESSED_FLOW_TICKS` y en 2D `PRODUCTIVE_STATE_TICKS`; el código numérico actual carga por estados productivos (RUNNING, RAMPING_UP, BACKUP_STOPPING), por lo que el rótulo por sí solo no demuestra diferencia de algoritmo. Las exposiciones y fallas observadas difieren; pendiente revisar equivalencia de clasificación y streams/ticks. Waiting for Prime es subconjunto de starving en 2D y separado en numérica; no sumar dos veces. Tiempos de equipos pueden solaparse.

| Conveyor | Activaciones Back-up num. / 2D | Activaciones Prime num. / 2D | Overflow numérico (botellas equiv.) | Inventario final 2D (botellas equiv.) |
| --- | ---: | ---: | ---: | ---: |
| US-LAB | 2,950 / 3,333 | 2,724 / 3,366 | 2,946 | 251 |
| LAB-FIL | 2,576 / 3,223 | 3,444 / 3,914 | 0 | 388 |
| FIL-CAS | 3,396 / 3,873 | 11,437 / 12,737 | 3,379 | 148 |
| PAC-PAL | 11,398 / 12,711 | 3,664 / 4,129 | 0 | 156 |

Hallazgo de sensores: PAC-PAL tiene caja de 310 mm, velocidad 541.5 mm/s y blocked/clear delay de 0.5 s. Paso del producto ≈ 0.5725 s > blocked delay. Las 12,711 activaciones Back-up frente a 12,712 cajas del Case Packer (12,666 solicitudes BACKUP_CLEAR, 25,332 s de Starting = 422.2 min) respaldan la hipótesis de paradas causadas por pulsos normales. No es confirmación de causa en planta. No modificar los datos de entrada durante homologación. Evaluar después sensibilidad de delay y geometría en Zero CAPEX.

Balance de material:
- Numérica: entrada 143,136; salida 136,764; overflow 6,325; inventario final 47; residual 0. El output de Scrambler es 143,135 y conserva 1 botella interna.
- 2D: Scrambler produjo 153,348 con inventario interno final 0; salida 152,376; inventario final total 972 botellas equivalentes (943 en conveyors, 29 en máquinas: Virtual inlet 1, Filler 2, Case Packer 14 botellas y Palletizer 1 caja = 12 botellas). El balance reconstruido cierra exactamente. No existe contador explícito de overflow en este resumen 2D: no confundir ausencia de contador con prueba universal de ausencia de overflow.
- Diferencia de salida = +10,212 entrada/inyección equivalente −925 inventario adicional +6,325 overflow numérico = +15,612 botellas. Descomposición aritmética, no atribución causal.
- La etapa 4 debe distinguir intento de transferencia bloqueada, descarga física residual, espacio real a la entrada, capacidad y pérdida por overflow, con unidades nativas y equivalentes. En particular PAC-PAL usa cajas y no debe dividir por 12 una cantidad ya expresada en cajas. Revisar también el balance de las transiciones Back-up.
- No hay tiempos reales por equipo en el registro de planta; las posiciones de sensores resueltas son datos de modelo, no necesariamente medidas. Validación contra planta sigue pendiente.

### Etapa 4: Descarga y overflow

Política 2D `PHYSICAL_FLOW_6`; versión numérica ST_CURRENT 0.20.2, provenance cache:31. Referencia previa: 6,325 botellas perdidas por overflow en la numérica y balance 2D sin pérdida deducible (política 5). No se cambian inputs, velocidades, sensores, retardos ni interfaz.

- La transferencia normal a un conveyor detenido o sin separación suficiente en la entrada se bloquea; el producto permanece dentro de la máquina. Los intentos bloqueados se cuentan por intento de transferencia, no como pérdidas físicas ni como eventos únicos de parada.
- Tras el tiempo de respuesta al Back-up, una descarga residual real puede salir aun si la banda no admite otra unidad. Si hay espacio físico de entrada, el envase entra; si no, se registra overflow y se retira del inventario de la máquina. No se inserta producto superpuesto ni se crea material. Durante la respuesta anterior a ese instante, se sigue aplicando bloqueo normal.
- El número de descargas residuales en máquinas con residencia se limita a las unidades completas contenidas al activar Back-up. El nombre heredado `bottlesDischargedAtStop` representa envases nativos, como especifica CAT L21/L52. Se corrige en ambos motores la división indebida por el factor botellas/caja. Dos cajas configuradas equivalen a dos cajas (24 botellas para formato S), no cero. No se modifica el motor Python alternativo; la homologación se refiere al ST_CURRENT.
- La salida de máquina incluye envases físicamente descargados aunque se pierdan; entrada y salida de conveyor incluyen solo envases aceptados y entregados, respectivamente. Se exportan conteos de descarga durante Back-up, descarga residual, overflow e intentos bloqueados, e inventario en unidades nativas y botellas equivalentes. El balance global usa admisiones de la primera máquina (incluye su inventario interno), salida final, inventarios y overflow. El inventario de Case Packer se convierte por su unidad de entrada (botellas), no su salida (cajas). Si faltan contadores de una corrida anterior, el balance es nulo.
- La firma de política 2D y la versión de procedencia numérica cambian para evitar reutilizar checkpoints/resultados incompatibles. La referencia de 136,764 botellas permanece histórica; es necesario recalcular la ronda numérica con 0.20.2 para comparar motores corregidos. Mantener separada la referencia 2D de 152,376 botellas de política 5.
- Archivos: motor 2D y resumen, motor numérico fuente y bundle browser, procedencia fuente y bundle de escenarios, pruebas de descarga, ajuste de versión en prueba de sensores y esta bitácora.
- Pruebas: 25/25 casos superados en arnés JavaScript aislado (incluye ejecución real del bundle numérico, balance material, spill residual, cajas, checkpoint, sensores, reinicios y reloj MTBF). Se verificó coincidencia textual del fuente numérico y procedencia con sus bundles generados. No se ejecutó la suite completa de Node/npm ni el caso G de 24 h. Validar con la exportación de las siguientes corridas.
- Limitación: se homologa el manejo de descarga residual en conveyors físicos; las diferencias de política de transición/temporización, contadores y otras topologías siguen sujetas a revisión en las etapas correspondientes.

### Evidencia de corrida G — etapa 4 (24 de noviembre de 2026)

Fuente: `G-complete (7).json`, revisión 51, SHA-256 `31029a55b8c7ed1e86f8aa478679caeaf1bcfc2b405bdf0866e1c00c7a19e439`. Corrida 2D completa e independiente, política `PHYSICAL_FLOW_6`, semilla 20261124, duración 86,400 s, formato S (12 botellas/caja), fallas habilitadas y eventos/calendario deshabilitados en la captura. La firma de equipos de la numérica guardada coincide con los equipos de Simulation A, pero su replay sigue siendo ST_CURRENT 0.20.1, procedencia cache:30, resolución FAST, salida 136,764. **No se recibió todavía la corrida numérica corregida 0.20.2.** No tratar los dos resultados como comparación de versiones homologadas.

La salida 2D fue de 17,261 cajas = 207,132 botellas, 143.8417 bpm; +54,756 (+35.93%) respecto a política 5 y +36,756 (+21.57%) respecto a planta. La distancia frente a la numérica histórica aumentó a 70,368 botellas. El mayor flujo no demuestra mayor exactitud. La diferencia de etapas se observa, pero no constituye atribución causal aislada de cada ajuste.

Balance exportado 2D (botellas equivalentes): entrada 212,424 = salida 207,132 + inventario 941 + overflow 4,351; residual 0. Comparación aritmética respecto a política 5 (cuya entrada se reconstruyó, no se registró explícitamente): +59,076 entrada −4,351 overflow +31 reducción de inventario = +54,756 salida. No confundir un balance conservado con validación física de toda la lógica.

| Conveyor | Back-up activaciones / liberaciones | Overflow (botellas equiv.) | Inventario final (botellas equiv.) | Descarga residual de máquina anterior (unidad nativa) |
| --- | ---: | ---: | ---: | ---: |
| US-LAB | 1,525 / 1,524 | 3,047 | 259 | 4,570 botellas |
| LAB-FIL | 492 / 492 | 0 | 364 | 491 botellas |
| FIL-CAS | 656 / 656 | 1,304 | 68 | 1,956 botellas |
| PAC-PAL | 17,276 / 17,275 | 0 | 180 | 0 cajas |

Hallazgo: PAC-PAL sigue registrando aproximadamente una activación de Back-up por cada caja producida (17,276). Sin embargo, Case Packer registró solo 94 solicitudes BACKUP_CLEAR y 188 s de Starting por esa causa, contra 12,666 solicitudes y 25,332 s (422.2 min) en política 5. La corrección permite que un pulso termine antes de completar la descarga/parada y no necesariamente reinicie la máquina. Es una hipótesis explicativa importante de la subida de producción; falta comparar la numérica corregida y separar pulsos, descarga real y paros completos mediante eventos individuales. El contador de descarga residual del Case Packer es cero al final de esta corrida, aunque su configuración es dos cajas y al cierre tiene una unidad residual pendiente. No asumir que todas las activaciones son paros completos o que necesariamente se descarga el máximo configurado.

Revisión visual del video aportado `Recording 2026-11-24 233317.mp4` (13.25 s): Running, Discharging cerca de 6.5 s, Back-up stop cerca de 7–8 s, Starting cerca de 8.5–10 s y Running cerca de 10.5 s. Tiempos de grabación, no tiempos virtuales certificados; el icono B refleja el control filtrado por temporizadores, no exclusivamente el haz bruto. No se identifica inequívocamente la máquina ni se certifica el conteo individual de botellas. El usuario indica que contará la descarga residual.

**Secuencia de rearranque vigente (commit f3eb930):** B de salida debe permanecer desocupado durante Clear Time Delay (reiniciado si se vuelve a ocupar). Tras paro completo y liberación, se rearma Prime de entrada si existe y se autoriza al alcanzar la reserva de cola compacta. Luego Startup Time y ramp-up solo si el perfil de rearranque los requiere, sin fallas ni comandos externos que impidan operar. Un pulso que termina antes de completar el paro no necesariamente dispara un nuevo startup. El Recovery Point no es una segunda fotocelda de liberación en el modelo discreto. Parámetros G resueltos: blocked/clear delay 0.5 s en los cuatro conveyors; restart delay 2/2/4/2 s (Scrambler/Virtual inlet/Filler/Case Packer); residual 3/2/3 botellas y 2 cajas; stop-response 0 s. Los perfiles Back-up de G no tienen ramp-up adicional (override nulo y ramp de máquina 0); el ramp-up de Prime es otro perfil. Código: `apps-script/Simulation2DEngine.html` (moveBelt, restart, stepMachine) y `src/simulation/LineSimulationEngine.js` (updateBackupSensorSegment, requestEquipmentStart). Se documenta la política vigente, sin modificarla ni afirmar que reproduzca un PLC de planta.

## 5. Pendientes y criterios de revisión

| Etapa | Alcance de revisión pendiente |
| --- | --- |
| Exposición a fallas | Evaluación conjunta registrada; queda pendiente aislar etapa 2 y conciliar clasificación de exposición y secuencias aleatorias. |
| Sensores | Evaluación conjunta registrada; revisar las diferencias de disparos, especialmente PAC-PAL, sin cambiar los inputs durante la homologación. |
| Descarga y overflow | Balance 2D comprobado con política 6; falta nueva numérica 0.20.2, comparar descarga/overflow y explicar diferencias de paros completos frente a pulsos. |
| Contadores | Homologar definiciones, unidades y exclusividad de estados; distinguir pérdidas internas y externas, y evitar doble conteo (Waiting for Prime ya forma parte de starving en el resumen 2D). |
| Resolución temporal | Medir sensibilidad al paso de integración y a los límites de tick; distinguir velocidad de reproducción de resolución del modelo. |
| Validación contra planta | Comparar resultados con datos reales, revisar por equipo y por turno si existen datos, y evaluar variación entre réplicas. |

Estos criterios son una guía de revisión, no una especificación de cambios ya aprobados ni evidencia de defectos confirmados.

## 6. Punto de continuación

1. Conservar corrida 2D política 6 de 207,132 botellas; no es necesario repetirla si no se cambia el modelo.
2. Ejecutar nuevamente solo numérica ST_CURRENT 0.20.2 (no reutilizar resultados 0.20.1), con los mismos datos G, 1,440 min, semilla 20261124, formato S, fallas habilitadas y sin eventos/calendario, resolución FAST.
3. Exportar ambos resultados; verificar versión y comparar con la 2D política 6. Registrar diferencias de producción, balance, descarga residual y paros efectivos. Confirmar la cantidad descargada por paro mediante revisión visual o eventos; no confundir activación del sensor con paro completo.
4. Siguiente etapa de implementación: Contadores; luego resolución temporal. No corregir parámetros para forzar coincidencia con planta.
5. Para aislar etapas 2 y 3, aún falta política 4 (`7ae1681`). Para aislar estrictamente el efecto de cambio de unidad numérica y el resto de la política 6, conservar resultados de cada versión y comparar con mismo input.


La evaluación conjunta no equivale a homologación completa ni validación de planta.

## 7. Protocolo de mantenimiento

Al retomar el trabajo, leer primero este archivo en `main` y contrastarlo con el historial de commits. Actualizarlo en el mismo commit de cada modificación de homologación cuando sea viable, o en un commit documental posterior claramente vinculado. Registrar siempre:

- Fecha, etapa, estado y objetivo de la modificación.
- Commit y archivos afectados; pruebas añadidas y resultados efectivamente ejecutados (o «no ejecutadas»).
- Configuración de la corrida, semilla, versión de política, producción y otros indicadores efectivamente medidos; identificar datos ausentes.
- Impacto frente a la referencia, limitaciones y siguiente acción concreta.

No sobrescribir corridas históricas ni marcar como evaluada una modificación solamente por haber sido publicada. Mantener la tabla de siete etapas como resumen canónico; añadir los detalles en el registro y las secciones de resultados. Al concluir una sesión, dejar identificado el punto de continuación de la próxima.

Referencias internas: [Reloj MTBF](MTBF_OPERATING_CLOCK.md), [Rampas](RAMP_ACCOUNTING.md), [Comparación con planta](PLANT_COMPARISON_CONFIRMATIONS.md), [Exportación selectiva](SELECTIVE_CASE_EXPORT.md).
