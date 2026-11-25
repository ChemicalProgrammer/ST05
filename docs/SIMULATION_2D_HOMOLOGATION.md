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
| Descarga y overflow | Implementado y evaluado (ambos motores; diferencias residuales pendientes) |
| Contadores | Implementado y evaluado (balances cerrados; anomalías de clasificación pendientes) |
| Resolución temporal | En evaluación (FAST vs PRECISE; falta sensibilidad intermedia y pruebas controladas) |
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
| Simulación numérica corregida, ronda 1 (ST_CURRENT 0.20.2) | 181,548 | 126.08 | +6.56% |
| Simulación 2D, posterior a etapa 4 (`PHYSICAL_FLOW_6`) | 207,132 | 143.84 | +21.57% |
| Simulación numérica, etapa 5 (ST_CURRENT 0.20.3, FAST) | 181,548 | 126.08 | +6.56% |
| Simulación 2D, etapa 5 (`PHYSICAL_FLOW_7`) | 207,132 | 143.84 | +21.57% |
| Simulación numérica, etapa 6 (ST_CURRENT 0.20.3, PRECISE) | 192,984 | 134.02 | +13.27% |
| Simulación numérica, etapa 6 (ST_CURRENT 0.20.3, BALANCED) | Pendiente | Pendiente | Pendiente |

Después de la etapa 1, la diferencia 2D − numérica era +9,276 botellas; después de las etapas 2 y 3 es +15,612. La brecha absoluta frente a planta disminuyó de 24,336 a 18,000 botellas (+6,336 de producción, reducción de 26.04% de la brecha). La brecha entre motores aumentó. La etapa 2 no se evaluó aisladamente; no atribuir la mejora combinada solamente a sensores. Tras evaluar ambos motores de la etapa 4, la diferencia 2D − numérica es +25,584 botellas. La numérica histórica de 136,764 se conserva y no se usa como referencia vigente.

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

### Evaluación conjunta de etapa 4 y diagnóstico previo a Contadores

Fuente: exportación del usuario `G-complete (8).json`, revisión 56, SHA-256 `f842f45c9a732373ce78b3800ab5cb0993f1faab33e41bbad7697a584a77d83f`. Se verificó que equipment, dynamicConfig y summary 2D son iguales a los del archivo (7). La firma numérica contiene exactamente los equipos guardados, ST_CURRENT:0.20.2/DES:0.5.0/cache:31, semilla 20261124, 86,400 s, FAST (tick efectivo 0.05 s), residencia y fallas habilitadas, eventos/calendario deshabilitados, tres rondas completas. La 2D sigue siendo política 6, independiente, misma semilla y duración. Las secuencias aleatorias y los pasos temporales no son necesariamente equivalentes.

Ronda 1 numérica: 181,548 botellas (+44,784 frente a 0.20.1; +6.56% vs planta); rondas 2 y 3: 176,040 y 178,188 con semillas 20261125 y 20261126. Media 178,592 (DE muestral 2,776.14; +4.82% vs planta). El batch identifica ronda 3 como representativa, pero summary/equipmentMetrics y replay principal corresponden a ronda 1; comparar solo esta última con la 2D. El gap anterior de 70,368 botellas (2D política 6 vs numérica histórica) baja a 25,584 (+14.09% vs numérica actual); reducción 63.64%. No atribuir el cambio de trayectoria a un incremento directo de descarga de cajas: ambas corridas nuevas registran cero descarga de transición/residual de Case Packer.

| Balance (botellas equiv.) | Numérica ronda 1 | 2D |
| --- | ---: | ---: |
| Entrada | 185,813 | 212,424 |
| Salida | 181,548 | 207,132 |
| Inventario final | 1,004 | 941 |
| Overflow | 3,261 | 4,351 |
| Clearout | 0 | No separado |
| Residual del balance | 0 | 0 |

Descomposición aritmética del gap de salida: +26,611 entrada +63 menor inventario −1,090 overflow adicional = +25,584. Por tanto, el mayor flujo de entrada 2D domina la diferencia observada; no se trata principalmente de que 2D pierda menos producto. No confundir descomposición con atribución causal.

| Conveyor | Overflow num. / 2D (botellas) | Activaciones B num. / 2D |
| --- | ---: | ---: |
| US-LAB | 2,177 / 3,047 | 2,178 / 1,525 |
| LAB-FIL | 0 / 0 | 433 / 492 |
| FIL-CAS | 1,084 / 1,304 | 1,088 / 656 |
| PAC-PAL | 0 / 0 | 15,147 / 17,276 |

Tiempos registrados por máquina (minutos, no sumables entre equipos). RUNNING numérico se toma de stateSeconds, no runningSeconds (que incluye fases productivas); 2D running incluye Discharging. Starting, Blocked, Back-up stop, Failure según estados respectivos. Waiting for Prime está incluido en starving 2D y separado en numérica.

| Máquina | Running num./2D | Blocked num./2D | Starting num./2D | Back-up stop num./2D | Fallas num./2D |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scrambler | 619.43 / 826.22 | 147.53 / 28.44 | 72.57 / 50.73 | 275.26 / 275.71 | 18 / 15 |
| Virtual inlet | 915.54 / 925.02 | 0.03 / 0.00 | 14.40 / 16.37 | 101.65 / 141.87 | 222 / 211 |
| Filler | 761.93 / 927.25 | 150.64 / 57.09 | 73.24 / 43.47 | 110.00 / 109.25 | 61 / 68 |
| Case Packer | 708.07 / 916.60 | 113.42 / 0.00 | 2.70 / 3.13 | 0.81 / 0.89 | 79 / 93 |
| Palletizer | 761.34 / 875.26 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 32 / 21 |

Hallazgos para etapa 5:
- Los estados exclusivos de cada máquina ya suman 86,400 s en ambos motores dentro del redondeo numérico. Esto no demuestra que su clasificación sea equivalente. El numérico registra 150.41 min de BACKUP_STOPPING en Case Packer sin ninguna unidad de salida durante esa fase, frente a cero Ramp down 2D (response delay 0) y Discharging incluido en running 2D. Separar Discharging, Ramp down, Back-up stop, pulso B y parada efectiva; conciliar la exposición MTBF y no contar solo por etiqueta sin verificar actividad física.
- Scrambler es el primer punto con diferencia de flujo (185,812 vs 212,401 botellas descargadas). Su Blocked difiere 119.09 min, mientras Back-up stop es casi igual; Filler también difiere 93.55 min de Blocked. Revisar criterios y transferencia, no asumir que toda discrepancia de tiempos es solamente de presentación.
- Contrastar producción real por máquina, output equivalente a velocidad de diseño durante estados productivos, y pérdidas parciales antes de calcular Availability/Runtime Efficiency/Operational Efficiency/throughput. En el numérico, Scrambler registra 185,812 unidades frente a runningDesignOutput 159,806.59; investigar si se debe a créditos acumulados, clasificación de ticks o definición de denominador. No ocultar discrepancias mediante tope de 100%.
- Mantener las siete etapas originales. La etapa 4 está evaluada en ambos motores con balance cerrado, pero equivalencia por evento y descarga visual máxima siguen pendientes. Los resultados acotados (2,000 eventos guardados; 51,553 eventos omitidos por motor; 4,000 transiciones registradas y 908,653 omitidas) no permiten reconstrucción exhaustiva. Probar trazas cortas deterministas, sin fallas y con paros controlados, luego repetir G con fallas. No cambiar parámetros de entrada para forzar concordancia. No ejecutar otra corrida G antes de decidir/publicar etapa 5.

### Etapa 5: Contadores exclusivos y eficiencia comparable

Política 2D `PHYSICAL_FLOW_7`; ST_CURRENT 0.20.3 / cache:32. El contrato incorpora `stateAccounting.schema = ST_EXCLUSIVE_STATES_V1` en equipos y conveyors. Intervención observacional: no cambia entradas, velocidades, física, lógica Prime/Back-up, reloj MTBF, RNG ni OEE global. Los contadores históricos se conservan para compatibilidad con estudios y resultados existentes; no sumar ambos conjuntos. El registro nuevo no demuestra por sí solo equivalencia física.

- Una categoría por tick: RUNNING, STARTING, RAMP_UP, RAMP_DOWN, STOP_RESPONSE, DISCHARGING, STARVED, WAITING_FOR_PRIME, BLOCKED, BACKUP_STOP, FAILURE, MICRO_STOP, PAUSED, STOPPED, EMERGENCY_STOP, PLANNED_STOP, IDLE u otro estado informado. Discharging y Waiting for Prime dejan de mezclarse con Running y Starved en el registro nuevo. El numérico desglosa BACKUP_STOPPING en STOP_RESPONSE o DISCHARGING. El tiempo de respuesta numérico no representa necesariamente una desaceleración física; 2D sí representa una rampa de frenado. Conservar la diferencia explícita para revisión física/temporal.
- Los conveyors físicos registran EMPTY, FLOWING y ACCUMULATING tras transferencias, y estados de parada por separado. En discreto la acumulación usa cabeza en salida o parejas compactadas; el numérico registra la última pareja durante la pasada de transporte y ajusta su índice al retirar paquetes. El modelo continuo usa inventario/cola, no coordenadas discretas. No calcular eficiencias de máquinas para conveyors.
- Se contabiliza salida nativa por estado, tiempo de ticks con salida, tiempo productivo sin salida, producto fuera de estados productivos, residuales de balance de tiempo y salida, tiempo productivo e integral de velocidad de diseño en unidades nativas. No inferir paro mecánico por ausencia de una botella durante un tick. Se registra discrepancia de salida por encima del diseño y bandera si excede una unidad nativa; no ajustar por fuerza el denominador. Las diferencias de clasificación Blocked/Running de los motores siguen pendientes de explicar.
- Se distinguen episodios Back-up observados por máquina, episodios que alcanzan BACKUP_STOP, episodios terminados sin observar ese estado y episodio abierto. No equivalen necesariamente a activaciones de fotocelda ni a paro mecánico; pulsos enteramente dentro de un tick pueden no observarse.
- Se añade tiempo efectivamente cargado al reloj MTBF numérico bajo la condición existente, separado de la exposición. Se corrige el rótulo histórico a PRODUCTIVE_STATE_TICKS sin modificar el guard de decremento ni secuencias de fallas. La 2D no tiene el proceso independiente de microparos numérico; cero observado en esa categoría no demuestra equivalencia.
- Fórmulas comunes para tarjetas y nuevo JSON: Availability = tiempo productivo/(tiempo productivo + fallas propias + microparos); Runtime Efficiency = salida nativa / integral de velocidad de diseño durante tiempo productivo (calidad 100% asumida, no hay modelo de rechazos); Operational Efficiency = Availability × Runtime Efficiency; Throughput = Operational Efficiency × velocidad de diseño media ponderada. Productivo incluye Running, Ramp up, Ramp down, Stop response y Discharging. El OEE intrínseco diagnóstico usa la convención histórica numérica de disponibilidad 1 − (fallas + microparos + STOP + emergencia + planificados)/tiempo observado, multiplicada por Runtime Efficiency. No capar las nuevas eficiencias a 100%; investigar valores mayores antes de aceptarlos. `stateAccounting.efficiency` es la base común de tarjetas; se conserva OEE global y campos históricos numéricos para compatibilidad. La salida de máquina incluye lo descargado aunque el conveyor registre overflow; no se modela rechazo de calidad.
- Se conservan estilos, secciones y diseño de tarjetas; se muestran Discharging y Waiting for Prime por separado y los estados adicionales cuando se observan. La contabilidad de muestras y telemetría es compacta; diagnósticos detallados en métricas finales y snapshots completos. El reporte puede crecer moderadamente; no se altera el formato de exportación ni la compactación existente. Checkpoints antiguos sin el registro no generan contadores exclusivos ficticios. Las nuevas firmas requieren corridas nuevas.
- Pruebas: 32/32 focalizadas pasaron en arnés JavaScript aislado (7 nuevos casos; 25 regresiones de descarga, sensores, reinicio, MTBF y resumen; ejecución del bundle numérico). Además, tres comprobaciones de paridad exacta de la trayectoria contra etapa 4: numérica sin fallas y con comandos, numérica con fallas y comandos, y 2D de 1,200 ticks con fallas y comandos. Coincidencia fuente/bundles comprobada. No se ejecutó la suite completa Node/npm, pruebas DOM completas ni la corrida G de 24 h.
- Evaluación G registrada a continuación. Pendiente conciliar diferencias en tiempos/producción y revisar especialmente Scrambler (185,812 vs 159,806.59 de salida/diseño histórico), Filler y Case Packer. No afirmar que las correcciones de contadores eliminan por sí solas las 25,584 botellas de diferencia entre motores. Mantener inputs y referencias históricas.

### Evaluación de etapa 5 — G, revisión 61

Fuente: exportación `G-complete (9).json`, 39,060,961 bytes, SHA-256 `a19a40ed71c62cc714fc6a148a23706e112dca771550919ef2770f29e19cdf6e`. Numérica ST_CURRENT 0.20.3/cache:32 y 2D PHYSICAL_FLOW_7; ambas con ST_EXCLUSIVE_STATES_V1, 86,400 s, semilla 20261124, formato S, 12 botellas/caja, residencia y fallas habilitadas, eventos/calendario deshabilitados. La firma numérica contiene exactamente la lista de equipos guardados. Configuración FAST, tick solicitado 0.25 s, efectivo 0.05 s. Paso 2D nominal 1/120 s. Tres rondas numéricas completas (181,548; 176,040; 178,188 botellas, semillas consecutivas); comparación emparejada solo ronda 1, no promedio ni ronda representativa. La captura 2D independiente está completa; sus opciones no demuestran por sí solas que no se cambiaron durante la corrida.

**Paridad respecto a etapa 4:** producción numérica y 2D idénticas a sus respectivas referencias (181,548 y 207,132 botellas). Balances de material también idénticos: numérica 185,813 = 181,548 + 1,004 + 3,261 (clearout 0); 2D 212,424 = 207,132 + 941 + 4,351. Residual 0. Los nueve elementos de ambos motores tienen nuevo registro exclusivo; residual de salida por estado 0 para todos. Residual máximo absoluto de tiempo informado: 0.000002 s numérica (también en cada ronda), 0.000014 s 2D, compatible con error de punto flotante. La etapa se evalúa sin declarar equivalencia física ni exactitud de denominadores. Los conteos de fallas de ambas corridas coinciden con las referencias de etapa 4.

| Máquina | Tiempo productivo num./2D (min) | Runtime Efficiency num./2D (%) | Blocked num./2D (min) | Discharging num./2D (min) | Salida en Discharging num./2D (unidades nativas) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scrambler | 626.69 / 826.22 | 116.27 / 100.81 | 147.53 / 28.44 | 7.26 / 14.81 | 2,177 / 4,570 |
| Virtual inlet | 917.51 / 925.43 | 88.44 / 99.97 | 0.03 / 0 | 1.44 / 1.92 | 432 / 0 |
| Filler | 765.44 / 928.45 | 108.67 / 102.17 | 150.64 / 57.09 | 1.81 / 8.42 | 1,084 / 1,956 |
| Case Packer | 858.49 / 916.67 | 92.86 / 99.19 | 113.42 / 0 | 150.41 / 161.89 | 0 / 0 |
| Palletizer | 852.33 / 941.65 | 93.42 / 96.48 | 0 / 0 | 0 / 0 | 0 / 0 |

Hallazgos:
- Scrambler: salida sobre integral de diseño +26,005.412502 botellas numérica y +1,716.033306 en 2D; Filler +14,606.016669 y +4,440.083311 respectivamente. Velocidades calculadas sobre tiempo productivo: Scrambler 296.50/257.08 bpm frente a 255; Filler 239.08/224.78 frente a 220. No es prueba de velocidad física superior a diseño. Hipótesis a contrastar: créditos de trabajo acumulados en ticks clasificados como Blocked/Starved, asignación del estado al final del tick, cuantización y diferencias en transferencia. No capar al 100%.
- Virtual inlet 2D contabiliza 491 botellas descargadas residualmente en BACKUP_STOP, no DISCHARGING; total por estado reconcilia, pero `outputOutsideProductiveUnits=491`. El código stepResident puede descargar la última unidad y asignar Back-up stop al mismo tick si se vacía el inventario; distinguir instante de descarga del estado al cierre del tick. Esto requiere una prueba focalizada; no prueba que la máquina produzca mientras está físicamente detenida. No cambiar el flujo para corregir solo la atribución. Se conserva esta anomalía como pendiente transversal de contadores.
- Case Packer: 15,147/17,276 activaciones de B (num./2D), 15,147/17,245 episodios observados, 81/94 alcanzaron BACKUP_STOP, 15,065/17,150 terminaron sin observar ese estado y un episodio permanece abierto en cada motor. 150.41/161.89 min clasificados Discharging, cero cajas producidas en ese estado y cero descarga residual registrada. Discharging representa una fase de control que puede no completar paquete; no equiparar duración a flujo positivo ni al paro completo. Diferencias de clasificación y exposición todavía pendientes. El sensor B puede activarse con el paso normal de caja (310/541.5 s > 0.5 s), no modificar parámetros durante esta evaluación.
- Scrambler y Filler concentran diferencias de Blocked de 119.09 y 93.54 min. Comparar a igual resolución y con trazas controladas antes de cambiar la física. La diferencia global sigue en 25,584 botellas, 2D +14.09% vs numérica. No atribuirla únicamente al paso temporal; también difieren las secuencias de fallas, orden de integración y las condiciones de créditos.

### Inicio de etapa 6: protocolo de sensibilidad temporal

La resolución numérica existente con residencia habilitada y tick solicitado 0.25 s permite FAST (1/20 s), BALANCED (1/60 s) y PRECISE (1/120 s). El motor 2D usa 1/120 s. Confirmado en `src/simulation/LineSimulationEngine.js` (`resolveSimulationNumerics`) y política 2D vigente. No confundir Playback speed ni sample interval con integración. Primera comparación: repetir únicamente numérica con PRECISE, duración 1,440 min, semilla 20261124, una ronda, mismos equipos/formatos, fallas habilitadas y eventos/calendario deshabilitados, residencia activa. Mantener numérica FAST y 2D política 7 como referencias; no repetir 2D. Se recomienda guardar exportación independiente. Este paso varía un solo factor: resolución numérica. No cambia código. A igual tick, no se garantiza misma trayectoria ni secuencia aleatoria. Después evaluar BALANCED si es necesario, y pruebas cortas deterministas sin fallas y con eventos controlados. Revisar conservación, producción, eficiencia sin tope, tiempos de estados y discrepancias de créditos, evitando elegir el tick únicamente por cercanía a planta.

### Evaluación inicial de etapa 6 — FAST vs PRECISE

Fuente: exportación `G-complete (10).json`, revisión 66, 38,812,224 bytes, SHA-256 `a5ded8499bdd8fae38eeac92c94941a16d9bc9d67789c90120c4dea26bd0f08d`. Comparación directa con `G-complete (9).json`, revisión 61. Ambas listas de equipos son idénticas y coinciden con la lista de equipos de sus firmas numéricas. La única diferencia semántica en el run de las firmas numéricas es FAST frente a ausencia de numericalResolution (por defecto PRECISE). El bloque results.numerics y el replay confirman PRECISE efectivo 1/120 s, solicitado 0.25 s, versión 0.20.3/cache:32. Duración 86,400 s, formato S, residencia/fallas activadas, eventos/calendario desactivados. Tres rondas completas, semillas 20261124–20261126. La captura 2D del archivo (10) está Ready, tiempo 0, complete=false; no es una corrida de 0 botellas. Se reutiliza la 2D completa de (9), PHYSICAL_FLOW_7; las firmas 2D de ambos archivos son semánticamente idénticas (orden de claves no significativo). No se estableció por qué se reinició la captura; revisar persistencia de resultados independientes al cambiar resolución numérica.

| Semilla | FAST (botellas) | PRECISE (botellas) | Diferencia PRECISE − FAST |
| --- | ---: | ---: | ---: |
| 20261124 | 181,548 | 192,984 | +11,436 |
| 20261125 | 176,040 | 183,480 | +7,440 |
| 20261126 | 178,188 | 187,572 | +9,384 |
| Media | 178,592 | 188,012 | +9,420 |

Desviación estándar muestral FAST 2,776.14, PRECISE 4,767.25 botellas. Comparación descriptiva emparejada por semilla dentro de la numérica (n=3, no prueba de convergencia ni validación). Ronda 1: incremento 6.30% respecto a FAST; brecha 2D − numérica disminuye de 25,584 a 14,148 botellas (44.70%; +7.33% respecto a PRECISE). Error frente a planta aumenta de +6.56% a +13.27%. El paso temporal afecta los resultados; no escoger FAST solo porque es más próximo al dato real. No atribuir porcentajes de la brecha a causas independientes a partir de una sola comparación.

| Balance (botellas) | FAST | PRECISE | 2D |
| --- | ---: | ---: | ---: |
| Entrada | 185,813 | 195,663 | 212,424 |
| Salida | 181,548 | 192,984 | 207,132 |
| Inventario final | 1,004 | 6 | 941 |
| Overflow | 3,261 | 2,673 | 4,351 |
| Residual | 0 | 0 | 0 |

Diferencia 2D − PRECISE: +16,761 entrada −935 inventario adicional −1,678 overflow adicional = +14,148 salida. La entrada domina la diferencia aritmética, no prueba atribución causal. Las tres rondas PRECISE cierran balances materiales. Los nueve elementos de ronda 1 cierran salida por estado; máximo residual absoluto de tiempo 0.000006 s. El reloj MTBF cargado coincide con exposición productiva en las cinco máquinas de ronda 1.

| Máquina | Runtime Efficiency FAST / PRECISE / 2D (%) | Blocked FAST / PRECISE / 2D (min) | Fallas FAST / PRECISE / 2D |
| --- | ---: | ---: | ---: |
| Scrambler | 116.27 / 100.79 / 100.81 | 147.53 / 26.79 / 28.44 | 18 / 21 / 15 |
| Virtual inlet | 88.44 / 99.52 / 99.97 | 0.03 / 0.04 / 0 | 222 / 212 / 211 |
| Filler | 108.67 / 102.14 / 102.17 | 150.64 / 53.29 / 57.09 | 61 / 70 / 68 |
| Case Packer | 92.86 / 99.19 / 99.19 | 113.42 / 146.33 / 0 | 79 / 78 / 93 |
| Palletizer | 93.42 / 96.25 / 96.48 | 0 / 0 / 0 | 32 / 33 / 21 |

Hallazgos y siguientes diagnósticos:
- Runtime Efficiency y Blocked del Scrambler y Filler se acercan notablemente al igualar tick. Persiste sobreproducción aparente (PRECISE +1,530.747895 / +4,072.605538 botellas respectivamente sobre integral de diseño, frente a +1,716.033306 / +4,440.083311 2D). No confundir cierre contable con exactitud física. Investigar créditos, estado al cierre de tick y tiempo de descarga.
- Case Packer PRECISE: 16,082 episodios observados, 87 alcanzan BACKUP_STOP, 15,995 terminan sin observar ese estado. 150.72 min DISCHARGING sin salida; Blocked 146.33 min frente a cero 2D; Starved 31.12 min frente a 158.23; Waiting for Prime 318.89 frente a 257.82. La clasificación de bloqueo/escasez sigue discrepando incluso con el mismo paso. En numérica, processEquipmentFlow usa disponibilidad, packageRemainder, capacidad de entrada y bloqueo de paquete; en 2D, stepResident determina Blocked cuando un intento efectivo de descarga falla. Estas condiciones deben contrastarse con trazas deterministas; no deducir equivalencia por métricas agregadas.
- Scrambler PRECISE registra 21 fallas y 356.60 min de falla, 2D 15 y 258.90 min; diferencia 97.70 min. Se verificó que los motores no comparten el algoritmo ni la inicialización de RNG: numérica createEquipmentRandom usa hash de semilla, id y familia de evento y streams separados; 2D usa LCG con índice de línea y stream de máquina compartido. Misma semilla no significa misma secuencia de fallas. No atribuir todo el gap restante a una sola causa. Probar primero sin fallas y con órdenes controladas a igual tick; después alinear streams de confiabilidad por identidad y evento con pruebas de reproducibilidad, sin modificar MTBF/MTTR de entrada para calibrar.
- La corrida (10) no valida planta: Real Data tiene una sola referencia de producción agregada, sin desglose de equipos, y la base de tiempos/producción permanece sin confirmar. Conservar el archivo previo para 2D y ambos resultados numéricos. Ningún archivo ejecutable fue modificado ni se ejecutaron nuevas simulaciones o pruebas de código en esta actualización documental.

### Criterios de comparación de réplicas y distribución de fallas (25 de noviembre)

A raíz de la observación del usuario, mantener tres referencias distintas: (1) comparación emparejada por semilla y configuración para cambios de motor/resolución, conservando ronda 1 (20261124) como histórico; (2) ronda representativa para inspeccionar una trayectoria individual; (3) promedio, dispersión y tamaño de muestra de todas las réplicas para evaluar rendimiento esperado y comparación estadística contra planta. No elegir retrospectivamente la ronda más cercana a la producción real. Verificado en `src/simulation/SimulationBatch.js`: closestRound selecciona la mínima distancia absoluta a producción media, desempata por distancia a OEE medio y luego por número de ronda. No selecciona por similitud del perfil de downtime de cada equipo.

En archivos (9) FAST y (10) PRECISE la representativa es ronda 3, semilla 20261126 (178,188 y 187,572 botellas, respectivamente); medias de 178,592 y 188,012. Para homologar 2D, la referencia independiente existente es semilla 20261124; no comparar directamente su trayectoria con la ronda 3 como si fueran semillas emparejadas. Si se requiere una 2D representativa, usar la semilla 20261126 y documentar la diferencia de algoritmos RNG vigente. Posteriormente comparar distribuciones de ambos motores con las mismas semillas y streams homologados.

Downtime propio PRECISE, por ronda, extraído de `results.batch.rows[].equipmentMetrics[].failureSeconds` del archivo (10), en minutos:

| Máquina | Ronda 1 | Ronda 2 | Ronda 3 | Fallas por ronda |
| --- | ---: | ---: | ---: | --- |
| Scrambler | 356.60 | 396.98 | 379.72 | 21 / 23 / 22 |
| Virtual inlet | 106.03 | 105.53 | 103.53 | 212 / 211 / 207 |
| Filler | 63.01 | 54.01 | 60.31 | 70 / 60 / 67 |
| Case Packer | 86.59 | 95.47 | 91.03 | 78 / 86 / 82 |
| Palletizer | 39.60 | 18.00 | 22.80 | 33 / 15 / 19 |

El MTBF determina una distribución de tiempo de exposición hasta falla, no una cantidad fija de fallas por día. En el perfil general actual la reparación usa MTTR fijo, con cuantización y posible truncamiento al final del horizonte. El downtime propio por máquina no tiene por qué coincidir entre réplicas. Aun si coincide, la simultaneidad, la separación temporal entre eventos y el estado de los buffers pueden modificar la producción de línea; no sumar downtime de equipos como pérdida global. Hipótesis para pruebas deterministas posteriores: mantener cantidades y duraciones de paros forzados constantes y variar solo su fase temporal/solapamiento, conservando parámetros de buffers y recuperación; comparar producción, tiempo efectivo y pérdidas de línea. Para aislar fallas aleatorias, usar streams comunes por identidad y familia de evento, sin exigir mismos instantes de falla en tiempo calendario si las exposiciones productivas difieren. Los historiales actuales tienen eventos y transiciones omitidos, por lo que no permiten atribuir exhaustivamente la variación al solapamiento real de fallas. No se ha ejecutado aún ese experimento ni se ha cambiado código. El usuario está ejecutando BALANCED; se mantiene ese experimento sin modificaciones.

## 5. Pendientes y criterios de revisión

| Etapa | Alcance de revisión pendiente |
| --- | --- |
| Exposición a fallas | Evaluación conjunta registrada; queda pendiente aislar etapa 2 y conciliar clasificación de exposición y secuencias aleatorias. |
| Sensores | Evaluación conjunta registrada; revisar las diferencias de disparos, especialmente PAC-PAL, sin cambiar los inputs durante la homologación. |
| Descarga y overflow | Evaluación de ambos motores registrada y balances cerrados; revisar equivalencia de eventos de descarga/parada y máximo visual como diagnóstico transversal. |
| Contadores | Evaluación G registrada; balances cerrados. Pendiente conciliar sobreproducción aparente, atribución de última descarga a Back-up stop y duración de fases sin salida. |
| Resolución temporal | FAST/PRECISE comparados; completar BALANCED y casos deterministas con igual tick y fallas deshabilitadas; revisar clasificación Case Packer y créditos, y después aislar discrepancias de RNG. |
| Validación contra planta | Comparar resultados con datos reales, revisar por equipo y por turno si existen datos, y evaluar variación entre réplicas. |

Estos criterios son una guía de revisión, no una especificación de cambios ya aprobados ni evidencia de defectos confirmados.

## 6. Punto de continuación

1. Conservar referencias: (9) numérica FAST 181,548 botellas y 2D PHYSICAL_FLOW_7 207,132; (10) numérica PRECISE 192,984, ronda 1. No tratar la 2D Ready de (10) como resultado ni sobrescribir el histórico.
2. Completar sensibilidad con una corrida numérica BALANCED (1/60 s), ST_CURRENT 0.20.3, G, 24 h, semilla 20261124, formato S, residencia y fallas habilitadas, eventos/calendario deshabilitados; una ronda basta como mínimo. No repetir 2D; exportar por separado. Comparar con FAST/PRECISE sin asumir monotonía o convergencia.
3. Realizar pruebas cortas deterministas a igual tick, sin fallas y con paros controlados, para investigar Case Packer (Blocked vs Starved/Discharging), créditos y última descarga. Revisar la persistencia independiente de 2D.
4. Aislar la influencia aleatoria; evaluar homologación de streams de fallas por id y familia, misma semilla, sin cambiar MTBF/MTTR. No exigir igualdad de fallas por hora si difiere la exposición. Resolver defectos demostrados y registrar versiones/pruebas antes de nuevas corridas largas.
5. Validación contra planta y evaluación aislada de etapa 2 siguen pendientes.

La evaluación conjunta no equivale a homologación completa ni validación de planta.

### Ajuste transversal: cámara lenta de reproducción

Se incorporan 0.2× y 0.5× al componente compartido de velocidades, preservando 1× por defecto y todas las velocidades anteriores. Se elimina el mínimo artificial de 1× del reloj Live numérico y se valida que los multiplicadores sean positivos y finitos. El reloj 2D y su paso físico fijo permanecen sin cambios. Se actualiza la lista de velocidades persistibles del servidor para que coincida con el selector (manteniendo compatibilidad con 1,000,000× histórico). No cambia el motor físico, la procedencia de resultados ni el estado de las etapas. Pruebas focalizadas: 4/4 en arnés JavaScript aislado; se amplía la prueba DOM existente, no ejecutada en este arnés. La nueva corrida numérica 0.20.2 está registrada en la evaluación conjunta de etapa 4.

## 7. Protocolo de mantenimiento

Al retomar el trabajo, leer primero este archivo en `main` y contrastarlo con el historial de commits. Actualizarlo en el mismo commit de cada modificación de homologación cuando sea viable, o en un commit documental posterior claramente vinculado. Registrar siempre:

- Fecha, etapa, estado y objetivo de la modificación.
- Commit y archivos afectados; pruebas añadidas y resultados efectivamente ejecutados (o «no ejecutadas»).
- Configuración de la corrida, semilla, versión de política, producción y otros indicadores efectivamente medidos; identificar datos ausentes.
- Impacto frente a la referencia, limitaciones y siguiente acción concreta.

No sobrescribir corridas históricas ni marcar como evaluada una modificación solamente por haber sido publicada. Mantener la tabla de siete etapas como resumen canónico; añadir los detalles en el registro y las secciones de resultados. Al concluir una sesión, dejar identificado el punto de continuación de la próxima.

Referencias internas: [Reloj MTBF](MTBF_OPERATING_CLOCK.md), [Rampas](RAMP_ACCOUNTING.md), [Comparación con planta](PLANT_COMPARISON_CONFIRMATIONS.md), [Exportación selectiva](SELECTIVE_CASE_EXPORT.md).
