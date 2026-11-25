# Control dinámico de velocidad y balanceo de línea — propuesta experimental

Fecha: 2026-11-25. Estado: investigación y diseño propuesto; **no implementado ni validado**. Mantener intacta la referencia PHYSICAL_FLOW_8 y el plan diferido de núcleo físico único en SIMULATION_2D_HOMOLOGATION.md.

## Evidencia industrial

- [Rockwell Automation, Line Control for Beverage Line, presentación de 2011 (copia pública)](https://doczz.net/doc/2875723/line-control-for-beverage-line): control por secciones, detección de huecos y aceleración de la sección anterior; control de velocidades de máquina y estimación de volúmenes.
- [Krones SynCo](https://www.krones.com/en/products/machines/container-conveyor.php): accionamientos con frecuencia variable, medición de ocupación y ajuste dinámico de velocidad y capacidad de las máquinas.
- [Sorgatz y Voigt, Continuous Control for Buffering Conveyors in Beverage Bottling Plants, 2012](https://doi.org/10.1002/pts.1997): control continuo por conteos de entrada y salida, contrastado experimentalmente con sensores discretos.
- [Downtime Reduction with Fast Restart Function in a Beverage Production System, 2023](https://doi.org/10.3390/pr11010039): sensores de reserva para regular las velocidades de las máquinas; distinguir esta política de la regulación de la banda.

Estas referencias fundamentan la viabilidad del concepto, no la configuración de los PLC ni las capacidades mecánicas de la línea G.

## Alcance y opciones propuestas

- Dynamic line balancing: checkbox global OFF por defecto, en Simulation options y Simulation 2D; configuración y persistencia comunes. Con OFF no cambia ni un resultado, firma física histórica o secuencia aleatoria. Permitir activación por conveyor.
- Conveyor speed control: primera fase, velocidad nominal resuelta por MANUAL/AUTO/Target Population/Target Overspeed, más velocidades mínima/máxima explícitas, rampas de aceleración/desaceleración, retardo PLC/VFD, tiempos de confirmación y permanencia, señales de recuperación. No inferir límites reales ni considerar el rango matemático del AUTO como límite mecánico.
- Equipment speed control: fase separada, opcional. Velocidad Low/Nominal/High dentro de límites medidos, basada en reserva de entrada, espacio de salida y disponibilidad de máquina. No modificar MTBF/MTTR, semilla, reloj de exposición ni velocidad de referencia OEE por cambiar el setpoint; investigar dependencia real de confiabilidad con velocidad sólo si hay evidencia.
- Multi-zone conveyor: únicamente si hay accionamientos independientes; no crear una zona con velocidad distinta en una banda que tiene un solo motor. En fase inicial representar una velocidad instantánea por conveyor. Si hay segmentos reales, modelar transferencias, capacidad, límites y señales por segmento.

## Política inicial (hipótesis, no algoritmo de PLC certificado)

Sensores intermedios dentro de la zona de acumulación: S_low más cercano a Prime y S_high hacia Back-up. Interpretar ocupación persistente / reserva contigua y no un pulso de botella. La simulación puede ofrecer una variante ideal por conteo, separada de la implementable por sensores y señales locales. Si S_low indica reserva insuficiente, hay producto disponible aguas arriba y el destino puede recibirlo, aumentar hasta V_high; mantener hasta que la reserva alcance S_high o se agote la demanda. Volver a V_nominal con rampa; ante congestión no activar boost, evaluar V_low sólo si está permitido por el diseño. Si no hay producto que transportar, no aumentar velocidad sin beneficio. Interlocks actuales Prime, Back-up, Stop, E-Stop y restricciones de transferencias dominan. No crear producto, saltar acumulación, inventar presión de contacto ni autorizar una máquina antes de que Prime cumpla su regla existente. Evitar oscilaciones por histéresis, debounce y dwell. Las rampas sólo cambian la velocidad efectiva de la banda; actualizar desplazamientos, headway y sensores en ambos motores, sin modificar el pitch físico configurado arbitrariamente. Si el pitch de alimentación cambia por el control, derivarlo de entradas reales. Mantener los límites de seguridad industrial fuera de una mera recomendación del simulador.

## Posición de sensores

Coordenada x desde la entrada, longitud L, pitch acumulado p_acc, consumo Q_down en unidades nativas/min. Para cola compacta anclada a la salida:
N(t) = ceil(Q_down*t/60); x(t) = L - N(t)*p_acc.
t_low debe cubrir tiempo de detección + respuesta PLC/VFD + rampa + llegada real de producto + margen, sin contar dos veces intervalos que se solapan. t_high > t_low; ambos deben ser físicamente realizables dentro de la zona entre Back-up y Prime (si no, no forzar ni desplazar sensores existentes). La ecuación es sólo una estimación para cola contigua; no confundir ocupación local, inventario total y reserva efectiva. Usar registros de gaps, paros y recuperación para generar candidatos. Optimizar y validar ubicación, no asumir que el centro geométrico es óptimo.

Ejemplo de G, LAB-FIL: L=24.3 m, p_acc=0.06 m, Q_down=220 botellas/min, V_nom=33.16 m/min, Prime=23.3 m desde entrada. Hipótesis de 12 s de reserva (44 botellas; S_low=21.66 m) y 25 s (92 botellas; S_high=18.78 m). No son posiciones medidas ni recomendación definitiva de montaje; verificar sensores instalados, geometría, tramos y límites mecánicos. S_high hacia entrada, S_low hacia salida. Con boost hipotético +20%, V_high=39.792 m/min. Un envase libre a 7 m de la salida tardaría 12.67 s a V_nom, o 10.80 s con retardo de 0.5 s, rampa lineal de 2 s y V_high posterior; ahorro cinemático 1.86 s. No es una corrida completa ni una predicción de OEE.

## Validación y búsqueda

1. Registrar baseline G 24 h y escenarios sin control dinámico (mismas semillas y configuración; usar varias semillas, no comparar sólo promedios). Verificar igualdad exacta OFF con los motores existentes.
2. Aislar recuperación de huecos, starvation, overflow y Back-up, con paros controlados y sin fallas aleatorias; comprobar que posiciones, velocidad real, sensores, estados y balances sean coherentes en ambas implementaciones.
3. Evaluar OFF / Conveyor only / Equipment only / Both. Para el primer DOE, explorar sensores S_low y S_high como segundos de reserva, boost y rampas dentro de límites autorizados. Comparar alternativas con igual horizonte, mismas semillas por bloque y réplicas adicionales; usar diferencias pareadas, intervalos de confianza y ANOVA según diseño y supuestos.
4. Respuestas: producción, throughput, OEE con referencia de diseño constante, starving, blocking, Back-up stops, overflow, tiempo de recuperación, cambios de velocidad, rampas y tiempo por nivel. No afirmar pérdidas por presión, energía o desgaste si no se han modelado/calibrado.
5. Recomendar sensores y estrategias que aporten mejora robusta, respeten capacidad de las máquinas, límites VFD, pitch, estabilidad y condiciones mecánicas. Clasificar como mejora de control o inversión en sensores/variadores/accionamientos según infraestructura real. No recomendar CAPEX por una sola semilla ni maximizar velocidad sin restricción.
6. Registrar diferencias entre motores y mantener el diseño de interfaz actual; agregar telemetría de velocidad objetivo/real y posición/estado de sensores en las vistas existentes. Antes de modificar el runtime, acordar alcance de la fase de conveyor único vs segmentación y obtener límites reales o marcar valores experimentales como supuestos.

No se han modificado archivos Apps Script, ejecutado simulaciones integrales ni demostrado un aumento de eficiencia.

## Phase 1 implementation — numerical conveyor control (2026-11-25)

Implemented an optional ST discrete-physical conveyor controller. Global `dynamicLineBalancingEnabled` and per-conveyor `processData.dynamicLineBalancing.enabled` must both be true; the global option is absent/off for legacy cases. The third conveyor inspector tab configures explicit maximum speed (m/min), boost percentage, low/high reserve seconds, ramp-up/down seconds, confirmation and dwell. The controller uses a virtual contiguous outlet queue signal, not an assumed PLC photoeye program. Only nominal and recovery speeds are implemented; no below-nominal policy, equipment speed balancing, independent motor segments, or 2D dynamic control. 2D explicitly warns that it uses fixed speeds. The maximum is user-supplied; no mechanical limit is inferred. Existing interlocks override boost; no changes to machine design speed or random reliability parameters. Dynamic run provenance is tagged `/DLB:1`; legacy off signatures ignore inactive control configuration. Format changes rebuild sensor thresholds and preserve aggregate timing counters. Per-round zone telemetry includes actual/target speed, sensor states and cumulative recovery time. This is experimental; plant OEE improvement requires paired runs. See the new regression test.
