# Homologación de simulación numérica y simulación 2D

**Última actualización:** 25 de noviembre de 2026 (hora de México).
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
| Resolución temporal | Sensibilidad y G 24 h emparejada evaluadas; producción R1 idéntica; diferencias de trayectoria e inventario menores pendientes |
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
| Simulación numérica, etapa 6 (ST_CURRENT 0.20.3, BALANCED) | 193,032 | 134.05 | +13.30% |
| Numérica corregida ST_CURRENT 0.20.4, PRECISE, G 24 h (R1) | 190,152 | 132.05 | +11.61% |
| 2D corregida PHYSICAL_FLOW_8, G 24 h (semilla R1) | 190,152 | 132.05 | +11.61% |

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

El MTBF determina una distribución de tiempo de exposición hasta falla, no una cantidad fija de fallas por día. En el perfil general actual la reparación usa MTTR fijo, con cuantización y posible truncamiento al final del horizonte. El downtime propio por máquina no tiene por qué coincidir entre réplicas. Aun si coincide, la simultaneidad, la separación temporal entre eventos y el estado de los buffers pueden modificar la producción de línea; no sumar downtime de equipos como pérdida global. Hipótesis para pruebas deterministas posteriores: mantener cantidades y duraciones de paros forzados constantes y variar solo su fase temporal/solapamiento, conservando parámetros de buffers y recuperación; comparar producción, tiempo efectivo y pérdidas de línea. Para aislar fallas aleatorias, usar streams comunes por identidad y familia de evento, sin exigir mismos instantes de falla en tiempo calendario si las exposiciones productivas difieren. Los historiales actuales tienen eventos y transiciones omitidos, por lo que no permiten atribuir exhaustivamente la variación al solapamiento real de fallas. No se ha ejecutado aún ese experimento ni se ha cambiado código. El experimento BALANCED se completó sin modificar el motor; los resultados se registran a continuación.

### Evaluación de sensibilidad temporal completa — BALANCED (25 de noviembre)

Fuente: `G-complete (11).json`, revisión 70, 39,331,675 bytes, SHA-256 `c4a1647610093aa2735ded3b99bdbc1bdc25456a22066d091285c5d4ef7685ec`. Comparación directa de exportaciones (9), (10), (11). Equipos idénticos en las tres y coincidentes con sus firmas de entrada; firmas de run difieren solo en numericalResolution (FAST, BALANCED y valor por defecto PRECISE). Motor ST_CURRENT 0.20.3/cache:32; tick solicitado 0.25 s, efectivos 1/20, 1/60 y 1/120 s. Duración 86,400 s, formato S de 12 botellas/caja, residencia/fallas habilitadas, eventos/calendario deshabilitados, tres rondas completas con semillas 20261124–20261126. Se confirma que la ronda representativa es 3 en las tres resoluciones, incluida la reproducción representativa guardada. 2D de (11) está Ready, tiempo 0, complete=false, firma 2D semánticamente idéntica a (9)/(10); conservar (9) como referencia 2D completa (207,132 botellas, política 7, semilla 20261124). El reinicio de captura independiente al cambiar resolución sigue pendiente de investigación.

| Semilla / estadístico | FAST | BALANCED | PRECISE | BALANCED − PRECISE |
| --- | ---: | ---: | ---: | ---: |
| 20261124 | 181,548 | 193,032 | 192,984 | +48 |
| 20261125 | 176,040 | 183,132 | 183,480 | −348 |
| 20261126 (representativa) | 178,188 | 188,748 | 187,572 | +1,176 |
| Media | 178,592 | 188,304 | 188,012 | +292 |
| DE muestral | 2,776.14 | 4,964.91 | 4,767.25 | — |
| Error media vs planta | +4.82% | +10.52% | +10.35% | — |

BALANCED − PRECISE: +0.1553% sobre media PRECISE; diferencias individuales +0.025%, −0.190% y +0.627% aprox. Incremento medio sobre FAST de 9,712 (5.44%) y 9,420 (5.27%) respectivamente. Evidencia descriptiva de menor sensibilidad de salida al refinar de BALANCED a PRECISE que al refinar desde FAST, no prueba de convergencia en todas las métricas (n=3, sin resolución más fina ni tolerancias preestablecidas). BALANCED es candidato a opción de exploración multirréplica, requiere la mitad de ticks de PRECISE, no necesariamente la mitad de tiempo real. PRECISE se conserva para diagnóstico a igual tick 2D; FAST no se elige por cercanía fortuita a planta. No comparar media numérica o representativa directamente con única corrida 2D como si fueran muestras emparejadas.

| Balance ronda 1 (botellas) | FAST | BALANCED | PRECISE | 2D |
| --- | ---: | ---: | ---: | ---: |
| Entrada | 185,813 | 195,489 | 195,663 | 212,424 |
| Salida | 181,548 | 193,032 | 192,984 | 207,132 |
| Inventario final | 1,004 | 906 | 6 | 941 |
| Overflow | 3,261 | 1,551 | 2,673 | 4,351 |
| Residual | 0 | 0 | 0 | 0 |

BALANCED − PRECISE = −174 entrada −900 inventario adicional +1,122 menor overflow = +48 botellas. Aunque coincide casi la producción, overflow BALANCED es 41.98% menor; no son trayectorias idénticas. Brecha 2D − BALANCED = 14,100 botellas (7.30% vs BALANCED); −35 inventario adicional −2,800 overflow adicional +16,935 entrada adicional. Los balances materiales de todas las rondas numéricas cierran (clearout 0). Los 27 registros equipo/ronda de BALANCED cierran salida por estado y residual máximo absoluto de tiempo 0.000006 s.

| Máquina (ronda 1) | Runtime Efficiency FAST / BALANCED / PRECISE / 2D (%) | Blocked FAST / BALANCED / PRECISE / 2D (min) |
| --- | ---: | ---: |
| Scrambler | 116.27 / 100.77 / 100.79 / 100.81 | 147.53 / 53.79 / 26.79 / 28.44 |
| Virtual inlet | 88.44 / 99.51 / 99.52 / 99.97 | 0.03 / 0.04 / 0.04 / 0 |
| Filler | 108.67 / 102.11 / 102.14 / 102.17 | 150.64 / 53.71 / 53.29 / 57.09 |
| Case Packer | 92.86 / 98.15 / 99.19 / 99.19 | 113.42 / 142.01 / 146.33 / 0 |
| Palletizer | 93.42 / 96.02 / 96.25 / 96.48 | 0 / 0 / 0 / 0 |

| Máquina | Downtime propio BALANCED R1/R2/R3 (min) | Fallas R1/R2/R3 |
| --- | ---: | ---: |
| Scrambler | 345.21 / 396.99 / 369.63 | 20 / 23 / 22 |
| Virtual inlet | 106.56 / 104.56 / 103.56 | 213 / 209 / 207 |
| Filler | 63.02 / 54.02 / 60.32 | 70 / 60 / 67 |
| Case Packer | 87.71 / 96.59 / 93.26 | 79 / 87 / 84 |
| Palletizer | 39.61 / 18.00 / 22.81 | 33 / 15 / 19 |
| Suma de tiempos de equipos (no pérdida exclusiva línea) | 642.11 / 670.16 / 649.57 | — |

Diagnóstico:
- Scrambler BALANCED tiene 53.79 min Blocked, casi doble de PRECISE pese a producción similar; Filler cambia de 640 a 1,939 descargas durante DISCHARGING al refinar tick, y Scrambler de 911 a 1,381. Debe verificarse el crédito acumulado, cuándo se admite físicamente producto, el criterio de espacio/headway y la clasificación al final del tick en pruebas cortas, incluyendo overflow. Las eficiencias aparentes >100% (BALANCED Scrambler +1,496.82 y Filler +4,004.94 botellas sobre integral productiva de diseño) persisten.
- Case Packer BALANCED 16,105 episodios observados, 99 alcanzan BACKUP_STOP, 16,005 terminan sin observarlo y uno abierto; 150.86 min DISCHARGING, cero cajas en dicho estado; Blocked 142.01 min y Starved 14.80 min. La discrepancia Blocked frente a 2D no se resuelve refinando tick. Primero contrastar las condiciones de bloqueo de paquete, admisión parcial de botellas y pulsos Back-up con una prueba determinista.
- Las fallas siguen dependiendo de exposición y secuencia. Ronda 2 BALANCED y PRECISE presentan suma de downtime de 670.159 y 669.993 min, con producción 183,132 vs 183,480; no es un experimento de fallas iguales ni prueba causal del solapamiento. Guardar un registro específico de inicio/fin de fallas y exposición por máquina para analizar fase, duración, solapamiento y recuperación sin depender de un historial general truncado. El replay BALANCED R1 guarda 2,000 eventos y 4,000 transiciones, omite 44,865 eventos y 932,881 transiciones; no reconstruye toda la trayectoria.
- No se cambiaron ejecutables ni se ejecutaron nuevas simulaciones en esta actualización. La evaluación de sensibilidad de las tres resoluciones está realizada, pero quedan pruebas de convergencia/control y defectos de clasificación. No iniciar validación de planta ni más corridas largas hasta revisar los siguientes casos. El único dato real es producción agregada de 170,376 botellas, con bases de tiempo no confirmadas.

### Primeras pruebas deterministas de etapa 6 — 25 de noviembre

Ejecutadas directamente sobre los scripts de `main` en commit `9f364a28e8daa50c7f2d6f59b16cd7f3702c9876`: bundle `SimulationEngine.html`, motor `Simulation2DEngine.html` y función real summarize2DRun extraída de `Simulation2D.html`, en arnés JavaScript aislado. Sin cambios en ejecutables, sin suite Node/npm completa ni pruebas DOM. No es una nueva corrida G ni una validación de planta. Doce comparaciones emparejadas de motores, más una prueba focalizada de última descarga. El validador numérico rechazó la prueba de máquina única (requiere máquina, conveyor y máquina); se utilizaron líneas mínimas válidas. Los pasos FAST/BALANCED aplicados a 2D en el arnés son diagnósticos, no nuevas opciones del producto (2D de interfaz conserva 1/120 s).

**Fixture A: envasado discreto.** Duración 180 s, semilla 7, sin fallas, residencia STORAGE de 0 s, formato S de 12 botellas/caja, inventarios iniciales vacíos, capacidad de entrada de 30 unidades por máquina. Fuente 4 botellas/s, empacador 1/3 cajas/s, equipo final 1/3 cajas/s. Conveyor de botellas: L=1,000 mm, v=240 mm/s, longitud/pitch móvil/compacto 60/60/60 mm, P=880 mm, B=120 mm. Conveyor de cajas: L=3,100 mm, v=541.5 mm/s, longitud/pitch móvil/compacto 310/310/310 mm, P=2,600 mm, B=979 mm. Blocked y clear delay 0.5 s, respuesta 0, residual máximo 2 unidades nativas, arranque/rampas 0. La 2D se configuró con estas mismas definiciones explícitas (sin interfaz); se verificaron los pitches, velocidad y capacidad resueltos de las zonas numéricas. Comandos vacíos para corrida libre; otras corridas con fuente STOP 60–80 s y equipo final STOP 60–80 s (simultáneos) o 100–120 s (separados).

| Resolución | Entrada libre (ambos) | Salida libre (ambos) | Inventario libre (ambos) | Blocked empacador num./2D (s) |
| --- | ---: | ---: | ---: | ---: |
| FAST | 352 | 312 | 40 | 15.35 / 0 |
| BALANCED | 359 | 312 | 47 | 15.833333 / 0 |
| PRECISE | 360 | 312 | 48 | 15.85 / 0 |

En las nueve comparaciones (tres resoluciones × tres calendarios de comandos) los dos motores dan el mismo balance para cada combinación y residual cero, overflow cero. Los escenarios con paros dan 276 botellas en ambos motores a todas las resoluciones, con entrada 314/320/320 e inventario 38/44/44 en FAST/BALANCED/PRECISE. Ambos equipos comandados registran exactamente 20 s STOPPED. En este fixture los patrones simultáneo y separado dan la misma salida; no generalizar un efecto del solapamiento independiente de la línea.

Estados exclusivos del empacador en PRECISE libre (segundos):

| Estado | Numérica | 2D |
| --- | ---: | ---: |
| RUNNING | 86.366667 | 87.575 |
| WAITING_FOR_PRIME | 16.558333 | 4.166667 |
| STARVED | 45.358333 | 72.391667 |
| BLOCKED | 15.85 | 0 |
| BACKUP_STOP | 15.866667 | 15.866667 |

Ambos descargan 28 cajas; la salida final es 26 cajas (312 botellas). El desajuste Blocked de G es reproducible sin RNG incluso con balances idénticos, pero esta prueba no demuestra trayectorias internas idénticas ni que todo el gap G sea de clasificación. Siguiente: trazar primer tick discrepante con inventario parcial/completo, crédito de servicio, intento efectivo de descarga, espacio de entrada y latched Prime.

**Fixture B: influencia temporal del paro.** Dos máquinas de 2 botellas/s, capacidad interna 1 botella cada una, conveyor L=600 mm, v=240 mm/s, longitud 60 mm, pitch móvil 120 mm y compacto 60 mm; P=540 mm, B=120 mm; blocked/clear 0.5 s, respuesta/residual/arranque/rampa 0. Horizonte 120 s, PRECISE / 1/120 s 2D, formato S, STORAGE residencia 0, fallas deshabilitadas. Fuente y equipo final STOP 30–50 s simultáneos; variante separada, fuente STOP 30–50 s y final STOP 70–90 s. Se usan comandos, no fallas propias del proceso MTBF; estos representan indisponibilidades controladas con igual tiempo de STOPPED.

| Escenario | Entrada (ambos) | Salida (ambos) | Inventario (ambos) | STOPPED fuente/final (s) |
| --- | ---: | ---: | ---: | ---: |
| Libre | 240 | 234 | 6 | 0 / 0 |
| Simultáneos | 200 | 194 | 6 | 20 / 20 |
| Separados | 162 | 154 | 8 | 20 / 20 |

Los tres balances y todos los estados exclusivos por equipo coinciden entre motores en este fixture. Sin overflow. Paros separados: 40 botellas menos que simultáneos; la fuente tiene 19.008333 s BACKUP_STOP y el equipo final 22.733333 s WAITING_FOR_PRIME vs 2.75 s en simultáneos. Evidencia controlada de sensibilidad a distribución temporal con downtime impuesto constante; no extrapolar magnitud a G ni considerar estos tres casos un DOE completo.

**Última descarga 2D.** Prueba de un tick de 1/120 s con una unidad residente lista, crédito de salida 1, B activo, residual configurado 1 y conveyor detenido con espacio. Se descarga una botella residual, pero el estado al final del tick es Back-up stop. El registro atribuye 1 unidad a BACKUP_STOP, productiveSeconds=0 y outputOutsideProductiveUnits=1. Confirma la anomalía de atribución detectada en Virtual inlet G. La corrección debe distinguir fase de descarga y estado final sin alterar transferencia ni exposición MTBF inadvertidamente. Aún no se corrigió el código.

### Correcciones conjuntas posteriores a los diagnósticos de etapa 6

Publicación ST_CURRENT 0.20.4/cache:33 y PHYSICAL_FLOW_8; versión anterior 0.20.3/política 7 se conserva como evidencia histórica. No se cambian parámetros de entrada de G, geometría, MTBF/MTTR, diseño de interfaz ni fórmulas generales de OEE. Las trayectorias sí pueden cambiar porque se corrigen créditos, tiempos productivos y secuencias de confiabilidad; los indicadores derivados de tiempos también pueden cambiar. DES/Python alternativo no se homologa en esta intervención.

1. **Estados y créditos.** Para máquinas residentes discretas, Blocked exige paquete completo listo y descarga impedida; el tick que gana el crédito necesario para completar el paquete cuenta como servicio productivo. Contabilizar trabajo fraccionario de entrada y salida con producto/capacidad disponible, antes de una salida entera. La admisión numérica consume crédito antes de limitar su remanente, sin perder cada fracción por cuantización. La 2D limita la admisión por velocidad/packed pitch del conveyor; se evita el error de precisión de inventarios de cajas parciales (cuantizar a unidad de entrada) y se mantiene el límite de crédito de una unidad. Se integra la rampa de arranque discreta en el punto medio y se pausa su progreso si hay bloqueo efectivo; el modelo continuo conserva su integración anterior. Se reinicia packageRemainder al cambiar formato. Los estados corregidos afectan el reloj productivo y la lógica de Prime; no es un cambio exclusivamente de presentación. No se capan eficiencias al 100%.
2. **Última descarga.** La última unidad residual se contabiliza en Discharging durante el tick real de salida; el estado Back-up stop se observa en el siguiente intervalo si sigue activo B. Se conserva el criterio de rearranque al completar residual. La descarga no se inventa para una máquina sin producto. La exposición MTBF incluye ese tick de trabajo.
3. **Confiabilidad.** La 2D adopta el mismo Mulberry32 y hash estable (semilla + ID equipo + familia) que ST_CURRENT, con flujos separados failure/failure-class; conserva el estado de ambos generadores en checkpoint. Se verificó que el refactor del generador numérico conserva la secuencia de números anterior (100 valores por semilla/familia en la prueba). Los perfiles general/minor/major se resuelven con la misma lógica y orden; se admiten splits válidos aunque falte perfil general. Las reparaciones terminan en el mismo límite de tick (sin tick extra de 2D, tolerancia 1e-8 s), avanzan durante comandos/paros calendario excepto E-stop, y la recuperación espera disponibilidad y Back-up libre. La duración de reparación sigue siendo MTTR configurado, cuantizado a tick. La misma secuencia en exposición no garantiza idéntico momento calendario ni idéntico conteo si cambia la exposición. La 2D sigue sin el proceso independiente MICRO_STOP numérico ni fallas propias de conveyors; no afirmar equivalencia de esas funciones. La respuesta al paro no nula sigue teniendo diferencias de implementación física (respuesta numérica vs frenado 2D); G usa respuesta 0.
4. **Historial.** `equipmentMetrics[id].failureHistory` y `simulation2d.summary.equipment[].failureHistory` contienen ST_FAILURE_HISTORY_V1 (schema, complete, fields, episodes). Cada registro compacto incluye inicio, fin (null si abierto), clase, reparación configurada, exposición sorteada, exposición acumulada al iniciar, tiempo observado de FAILURE y causa de cierre. No se trunca por los límites de eventos generales/transiciones; se conserva en métricas de todas las réplicas, incluidas summary-only y representative. La desactivación de fallas 2D cierra la reparación como DISABLED. No fabricar historial completo al restaurar un checkpoint antiguo. `summary.failureOverlap` / `simulation2d.summary.failureOverlap` informan unión de intervalos abiertos de reparación, tiempo simultáneo de dos o más, suma por equipos, máximo concurrente y episodios abiertos. No es downtime efectivo global ni atribución causal de pérdida. `batch.failureOverlapStatistics` agrega escalares por réplica; la vista promedio no presenta una trayectoria individual como promedio. El tamaño de reporte puede aumentar; el guardado sigue limitado por el presupuesto general, exportación completa preferida.
5. **Persistencia y compatibilidad.** La firma 2D canónica ordena recursivamente claves y excluye zoneId, no depende de Numerical Resolution. Corrige el riesgo de invalidación por reordenamiento al guardar/reabrir. El cambio de versión física invalida correctamente checkpoints de política 7 para reejecutar con política 8; conservar exportaciones históricas. La prueba de firma no sustituye prueba DOM/Apps Script de persistencia end-to-end.

Pruebas de etapa 6 sobre el candidato final: 88/88 focalizadas aprobadas en arnés JavaScript aislado ejecutando el bundle numérico real y motor 2D (64 regresiones de estados, física, sensores, rampas, descarga y MTBF; 7 casos standalone seleccionados de Simulation2DReplay; 13 nuevos casos de homologación; 4 pruebas G de 600 s). Se actualizan expectativas de pruebas afectadas por cambios físicos/reparación y una expectativa de rampa antigua que ya fallaba en 0.20.3; se aísla una prueba de residencia del disparo normal de Back-up con un retardo de fixture, no de G. Verificada paridad textual fuente/bundle navegador y procedencia de ScenarioEngine; build-browser-engine actualizado para compartir helpers. No se ejecutó la suite completa Node/npm, JSDOM, ni despliegue Apps Script. 

**Prueba de empacado de 180 s**: a FAST/BALANCED/PRECISE, ambos motores entregan 312 botellas con balance idéntico y ahora todos los estados exclusivos del empacador coinciden. Blocked numérico disminuye desde 15.35/15.833333/15.85 s a cero, igual a 2D. El caso de paros controlados de 120 s preserva 234/194/154 botellas (libre/simultáneos/separados) con 20 s STOPPED por máquina en los casos de paro. Pruebas adicionales: última residual productiva, tasa no divisora 255 bpm sin eficiencia >100%, secuencias general/split e historia idénticas en fixture de 60 s a igual exposición (incluido final abierto), checkpoint restaurado con RNG idéntico, historial completo pese al límite de eventos, solapamiento sintético, réplicas y firma canónica.

**G, fixture de geometría resuelta, 600 s** (no es ejecución de 24 h ni importación completa del JSON): IDs, tasas, pitches, longitudes, sensores, residuales y MTBF/MTTR de G; capacidad 30 unidades de entrada, rampas Prime 2/2/4/2 s, response 0, semilla/formatos registrados; sin eventos/calendario, PRECISE y 2D 1/120 s. Se verifican balances, secuencias de exposición/clase en episodios observados y ausencia de eficiencia >100% para las cinco máquinas en estas pruebas.

| Semilla / fallas | Entrada num./2D | Salida num./2D (botellas) | Inventario num./2D | Overflow num./2D |
| --- | ---: | ---: | ---: | ---: |
| 20261124 / no | 2,424 / 2,401 | 1,344 / 1,344 | 1,040 / 1,037 | 40 / 20 |
| 20261124 / sí | 2,280 / 2,273 | 1,140 / 1,140 | 1,088 / 1,106 | 52 / 27 |
| 20261125 / sí | 2,303 / 2,291 | 1,344 / 1,344 | 923 / 927 | 36 / 20 |
| 20261126 / sí | 1,871 / 1,865 | 984 / 984 | 859 / 863 | 28 / 18 |

Residual 0 en todas. Con fallas, media 1,156 botellas en ambos motores; los conteos por equipo Scrambler/Virtual/Filler/Packer/Palletizer son respectivamente [0,0,0,1,0], [0,1,0,0,0] y [0,3,2,0,0] en ambos. La ronda representativa por cercanía a media de este fixture es 1 (1,140), no necesariamente la representativa de 24 h. Runtime Efficiency máxima en las pruebas 99.7858%; no demuestra ausencia de anomalías durante 24 h. Aunque coincide salida en todas las pruebas, persisten diferencias físicas de entrada, inventario y overflow. No modificar inputs para compensar. Pendiente evaluación G 24 h y revisión de cuantización/sensores/descarga donde persistan diferencias. No declarar equivalencia integral ni validación de planta.

### Evaluación G de 24 h tras las correcciones (25 de noviembre)

Fuente: `G-complete (12).json`, revisión 74, 39,644,399 bytes, SHA-256 `afafd237c90dd999a2c5e47a7559bde34876b3c42d1745c9144fdd68c48a358e`. ST_CURRENT 0.20.4/cache:33, PRECISE efectivo 1/120 s, tres rondas completas; PHYSICAL_FLOW_8 independiente, completa, semilla 20261124. Formato S, 12 botellas/caja, 86,400 s, residencia y fallas activadas, eventos/calendario desactivados. La lista de equipos coincide con la firma numérica. Opciones 2D son las guardadas al capturar, no historial de cambios durante ejecución. El selector 2D guarda 1×; no contiene telemetría de velocidad wall-clock ni permite reconstruir las reducciones reportadas. La corrección del reloj de reproducción no afecta el motor ni invalida esta corrida.

| Referencia | Botellas | Error vs planta |
| --- | ---: | ---: |
| Planta, base aún sin confirmar | 170,376 | — |
| Numérica R1, 20261124 | 190,152 | +11.61% |
| Numérica R2, 20261125 | 181,752 | +6.68% |
| Numérica R3, 20261126 (representativa) | 185,820 | +9.06% |
| Media numérica (n=3) | 185,908 | +9.12% |
| 2D independiente, 20261124 | 190,152 | +11.61% |

DE muestral numérica 4,200.69 botellas. Ambas corridas emparejadas entregaron 15,846 cajas, 132.05 bpm. Se elimina la brecha de producción previamente observada (14,148 botellas con paso igual en las referencias 0.20.3/política 7), no se declara equivalencia integral.

| Balance (botellas) | Numérica R1 | 2D |
| --- | ---: | ---: |
| Entrada | 194,862 | 194,875 |
| Salida | 190,152 | 190,152 |
| Inventario final | 945 | 962 |
| Overflow | 3,765 | 3,761 |
| Residual | 0 | 0 |

Diferencia aritmética 2D−numérica: +13 entrada −17 inventario +4 menor overflow = 0 salida. Todas las rondas numéricas cierran material, tiempos (residual máximo 0.000006 s) y salida por estado. 2D residual de tiempo máximo 0.000014 s y residual de salida 0 en los nueve elementos. No hay salida fuera de estado productivo en las máquinas de las corridas emparejadas.

| Máquina | Fallas num./2D | Runtime Efficiency num./2D (%) | Blocked num./2D (min) |
| --- | ---: | ---: | ---: |
| Scrambler | 21 / 21 | 97.4542 / 97.4540 | 0 / 0 |
| Virtual inlet | 208 / 208 | 99.7812 / 99.7823 | 0 / 0 |
| Filler | 70 / 70 | 99.0861 / 99.0900 | 26.1592 / 26.1625 |
| Case Packer | 87 / 87 | 88.7420 / 88.7476 | 0 / 0 |
| Palletizer | 32 / 32 | 96.7302 / 96.7318 | 0 / 0 |

Se verificaron las 418 secuencias de exposición sorteada y clase de falla, coincidentes por equipo (tolerancia 0.00001 s), con un episodio abierto en el Case Packer en cada motor. Diferencia máxima de inicio calendario de eventos correspondientes 19.525 s, no idéntica trayectoria. La unión de intervalos de reparación fue 37,827.091667 / 37,830.308339 s y el solapamiento de dos o más 1,996.175 / 1,985.45 s. Máximo concurrente 3 en ambos. No hay Runtime Efficiency >100% en ninguna de las tres rondas numéricas ni en 2D. Se considera evaluada la corrección en G 24 h para la semilla 20261124. No exigir repetición por el cambio de reloj de reproducción. Pendiente comparación emparejada de la ronda representativa y de las distribuciones 2D, estudio de diferencias físicas residuales y validación de planta con bases de medición confirmadas.

## 5. Pendientes y criterios de revisión

| Etapa | Alcance de revisión pendiente |
| --- | --- |
| Exposición a fallas | Evaluación conjunta registrada; queda pendiente aislar etapa 2 y conciliar clasificación de exposición y secuencias aleatorias. |
| Sensores | Evaluación conjunta registrada; revisar las diferencias de disparos, especialmente PAC-PAL, sin cambiar los inputs durante la homologación. |
| Descarga y overflow | Evaluación de ambos motores registrada y balances cerrados; revisar equivalencia de eventos de descarga/parada y máximo visual como diagnóstico transversal. |
| Contadores | Corregidos créditos, clasificación de empacado y última descarga; pruebas cortas aprobadas. Verificar tiempos y eficiencia de G 24 h y fases sin salida. |
| Resolución temporal | Sensibilidad y fixtures emparejados evaluados; créditos/rampas/streams corregidos. Falta G 24 h, diferencias restantes de overflow y convergencia cuantitativa. |
| Validación contra planta | Comparar resultados con datos reales, revisar por equipo y por turno si existen datos, y evaluar variación entre réplicas. |

Estos criterios son una guía de revisión, no una especificación de cambios ya aprobados ni evidencia de defectos confirmados.

## 6. Punto de continuación

1. Conservar exportaciones (9), (10), (11) y (12), incluyendo resultados históricos y G 24 h corregida. La corrección de reproducción 2D es independiente del motor; no necesita volver a ejecutar (12).
2. Confirmada paridad de producción en G 24 h con semilla 20261124 (190,152 botellas ambos motores). Numérica representativa R3 (185,820, semilla 20261126), media 185,908 (n=3). Para ampliar comparación, ejecutar 2D representativa usando esa semilla y conservar ambas corridas independientes; otra 2D con semilla 20261125 permitiría comparar todas las réplicas.
3. Revisar diferencias de inventario/overflow, desfase de inicios de fallas y recuperación de G; comprobar cambio de velocidad y persistencia en Apps Script. No confundir coincidencia de salida con trayectoria idéntica.
4. Validación contra planta: confirmar base de tiempo, calendario, unidades y registros de equipos/turnos. Media numérica excede producción real 9.12%; no ajustar parámetros únicamente para igualar producción. Evaluar convergencia y distribución 2D cuando existan las réplicas necesarias. Las funciones no homologadas (MICRO_STOP, respuesta no nula, fallas de conveyors, DES alternativo) permanecen fuera de esta validación.

La evaluación conjunta no equivale a homologación completa ni validación de planta.

### Ajuste transversal: cámara lenta de reproducción

Se incorporan 0.2× y 0.5× al componente compartido de velocidades, preservando 1× por defecto y todas las velocidades anteriores. Se elimina el mínimo artificial de 1× del reloj Live numérico y se valida que los multiplicadores sean positivos y finitos. El reloj 2D y su paso físico fijo permanecen sin cambios. Se actualiza la lista de velocidades persistibles del servidor para que coincida con el selector (manteniendo compatibilidad con 1,000,000× histórico). No cambia el motor físico, la procedencia de resultados ni el estado de las etapas. Pruebas focalizadas: 4/4 en arnés JavaScript aislado; se amplía la prueba DOM existente, no ejecutada en este arnés. La nueva corrida numérica 0.20.2 está registrada en la evaluación conjunta de etapa 4.

### Ajuste transversal: reducción de velocidad 2D durante la reproducción

El usuario informó que al reducir la velocidad hasta 1× el avance permanecía acelerado. En `Simulation2D.html`, animate acumulaba lag (segundos virtuales solicitados pero aún no calculados) y ejecutaba un máximo de 24,000 pasos por frame con presupuesto de CPU de 12 ms comprobado cada 128 pasos. A velocidades superiores a la capacidad del equipo, lag crecía; el selector únicamente guardaba checkpoint, por lo que la deuda de reproducción anterior continuaba después de reducir la velocidad. Reproducido con reloj/CPU sintéticos: 50,000× durante 100 ms, 128 pasos de 1/120 s y lag de 4,998.933333 s; tras pasar a 1×, el siguiente intervalo de 100 ms todavía avanzaba 1.066667 s (10.67× efectivo). No se dispone de medición wall-clock del navegador del usuario en el JSON.

Se reinicia exclusivamente el reloj de reproducción (previous, lag y último multiplicador) al cambiar el selector, incluso durante ejecución; animate detecta también cambios programáticos. Cancelar el frame al pausar, detener o terminar descarta la deuda anterior. Se mantienen el estado físico, tiempo ya calculado, inventario, fallas, resultados, semilla, paso fijo 1/120 s, todas las velocidades y presupuesto de CPU. Se omite el intervalo hasta el primer frame del nuevo reloj en lugar de atribuirlo a una velocidad equivocada. A velocidades altas sigue siendo posible que la velocidad efectiva sea menor a la solicitada por capacidad del procesador. No se cambia versión física 8 ni procedencia numérica. Pruebas focalizadas de PlaybackSlowMotion: 7/7 aprobadas en arnés JS aislado, incluidas tres nuevas regresiones de reducción sucesiva, cambio programático y pausa/reanudación con deuda positiva. Sin prueba DOM completa ni despliegue Apps Script.

### Mejora arquitectónica diferida — núcleo físico único (2026-11-25)

**Estado: pendiente, expresamente pospuesta por el usuario. No implementar en la etapa actual.** La evaluación G 24 h (semilla 20261124) produjo 190,152 botellas en ambos motores, con diferencias residuales de inventario, overflow y tiempos de eventos. Conservar los dos motores independientes como referencias de validación y sus exportaciones originales.

Objetivo futuro: extraer un núcleo físico determinista compartido entre simulación numérica y 2D, sin cambiar las reglas físicas homologadas ni la apariencia de las tarjetas. La animación será una vista del estado físico, no una segunda ejecución de la misma lógica. Separar el reloj de cálculo del reloj de reproducción y ofrecer cálculo adelantado en un worker con snapshots/checkpoints o deltas acotados en memoria; no almacenar cada posición de cada producto de las 24 horas a 120 Hz. Distinguir resultados calculados de datos de reproducción efectivamente disponibles, limitar el cursor al horizonte disponible y permitir acelerar, pausar y navegar por el historial cuando exista evidencia suficiente. Los comandos manuales durante la ejecución deben invalidar el futuro calculado afectado, restaurar un checkpoint consistente con los RNG, contadores e inventarios y recalcular sin alterar el pasado.

Migración futura: (1) fijar las referencias actuales y los contratos de estados, balances, sensores, rampas, confiabilidad y formatos; (2) elegir el núcleo canónico tras comparar ambos motores y sus funciones no homologadas; (3) conectar gradualmente la vista 2D a la API de estados físicos, manteniendo el motor 2D independiente como oráculo de regresión; (4) desacoplar cálculo/reproducción y limitar memoria; (5) verificar controles, persistencia, latencia y exactitud con pruebas deterministas y estocásticas, sin fallas y con fallas, eventos, formatos y corridas de 24 h de varias semillas. Para un mismo núcleo, semilla, configuración, resolución y comandos, la vista numérica y 2D deben mostrar el mismo estado a cada instante y el mismo balance, no sólo igual producción final. Cualquier diferencia frente a los motores históricos debe explicarse y validarse antes de retirar una referencia. What-If, CAPEX, DOE y ANOVA deberán consumir el núcleo canónico sin depender de la presentación gráfica.

Referencia de estado actual: commits `0af83397` y `8ced6161` incorporan indicadores de tiempo real y cálculo, no el núcleo único ni un buffer 2D. El cálculo de resultados numéricos puede adelantarse; el cursor numérico preciso se reconstruye bajo demanda (`src/simulation/NumericalPlayback.js`) y 2D avanza por su propio ciclo (`apps-script/Simulation2D.html`). No confundir 100% de resultados calculados con 100% de frames físicos disponibles.

Este registro sólo documenta el diseño futuro; no modifica código de ejecución ni reclama nuevas pruebas. Continuar ahora con las prioridades de homologación, revisión de pérdidas y validación de planta de las secciones 5 y 6.

## 7. Protocolo de mantenimiento

Al retomar el trabajo, leer primero este archivo en `main` y contrastarlo con el historial de commits. Actualizarlo en el mismo commit de cada modificación de homologación cuando sea viable, o en un commit documental posterior claramente vinculado. Registrar siempre:

- Fecha, etapa, estado y objetivo de la modificación.
- Commit y archivos afectados; pruebas añadidas y resultados efectivamente ejecutados (o «no ejecutadas»).
- Configuración de la corrida, semilla, versión de política, producción y otros indicadores efectivamente medidos; identificar datos ausentes.
- Impacto frente a la referencia, limitaciones y siguiente acción concreta.

No sobrescribir corridas históricas ni marcar como evaluada una modificación solamente por haber sido publicada. Mantener la tabla de siete etapas como resumen canónico; añadir los detalles en el registro y las secciones de resultados. Al concluir una sesión, dejar identificado el punto de continuación de la próxima.

Referencias internas: [Reloj MTBF](MTBF_OPERATING_CLOCK.md), [Rampas](RAMP_ACCOUNTING.md), [Comparación con planta](PLANT_COMPARISON_CONFIRMATIONS.md), [Exportación selectiva](SELECTIVE_CASE_EXPORT.md).

### Macrostop scrap (2026-11-25)

Advance machine setting `processData.equipment.macroStopScrapBottles` (nonnegative integer bottles/stop, implicit zero). Applies once on a MAJOR or GENERAL repair start or an individual STOP command, not MINOR, microstop, PAUSE, emergency, backup or calendar stop. Repeated STOP or STOP during a charged major/general repair and pending repair restart does not create a second quota. STOP works with reliability disabled. No-scrap cases retain old provenance; nonzero scrap uses SCRAP:2 and 2D PHYSICAL_FLOW_8_SCRAP2. Actual incoming inventory is removed oldest first; insufficient inventory leaves a pending reject quota, fulfilled by actual admissions after repair (a modeling assumption for the stop/restart purge). Never debit delivered good output or invent material. Case-fed machines require whole incoming cases expressed in bottles for every selected format. Format change keeps quota in bottles; a partial-case remainder may remain pending. Actual/requested/pending and event counts are recorded; material balance subtracts actual scrap separately from overflow/clearout. Quality uses good/(good+actual rejects); net runtime efficiency and line OEE already reflect good output, so do not subtract rejects twice. ST numerical and independent 2D engines support this feature; experimental SimPy is rejected for nonzero input. Zero preserves legacy physical results and provenance. Basic hides dedicated inputs and counters without deleting stored settings. Dynamic conveyor investigation remains paused; Real Data mapping is deferred.

Focused regression fixture: 90 s, five MAJOR stops × 7 bottles, 22 actual rejects + 13 pending, 115 delivered good bottles, identical numerical and 2D material ledgers (zero residual). Also cover GENERAL, MINOR, actual microstops, commanded pause, disabled reliability, complete cases, zero configuration, checkpoint and numerical execution paths. This fixture is not a plant calibration.
