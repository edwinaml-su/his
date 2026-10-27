# Infraestructura — del escritorio al centro de datos

Cuatro escalas, mismo método: inventariar → diagnosticar → diseñar → ejecutar con retorno → documentar.

## 1. Ordenar una computadora (archivos y sistema)

Objetivo: que la persona encuentre lo suyo en segundos y que lo importante esté respaldado. Siempre **mover, nunca borrar**; dejar reporte.

**Estructura estándar de carpetas (usuario de oficina)**
```
Documentos/
  01-Trabajo/<Área>/<Proyecto o Año>/
  02-Personal/
  03-Plantillas/
  04-Referencia/
Descargas/            (vaciar a mensual; lo útil se mueve)
_Archivo/<Año>/       (lo que no se tocó en >12 meses)
_Revisar/             (dudosos; la persona decide)
```
Convención de nombres: `AAAA-MM-DD_Tema_vNN.ext` para versiones; sin espacios finales ni caracteres especiales; evitar "final final".

**Procedimiento**
1. Inventario: listar por carpeta tamaño, cantidad, fecha de último acceso; detectar duplicados por hash (script Python/PowerShell), archivos enormes (>500 MB), instaladores, temporales.
2. Propuesta: tabla "qué, cuánto, a dónde"; el usuario aprueba.
3. Ejecución con registro (`movimientos.csv`: origen, destino, hash); duplicados a `_Revisar/duplicados/`.
4. Respaldo: OneDrive/SharePoint corporativo con "Conocidos" (Escritorio, Documentos, Imágenes) redirigidos; verificar sincronización.
5. Sistema: actualizaciones, espacio (limpieza de disco, puntos de restauración antiguos, caché), programas al inicio, antivirus/Defender al día, cuenta sin privilegios de administrador para uso diario, BitLocker activo.

Con bridge al equipo del usuario, los scripts se preparan en el workspace y se ejecutan con él viendo; sin bridge, se entrega el script y el reporte esperado.

## 2. Diagnóstico y reparación de hardware (PC, laptop, servidor)

**Secuencia universal**: síntoma → alimentación → POST → almacenamiento → memoria → térmico → periféricos → software. Un cambio a la vez; anotar.

| Síntoma | Causas probables (orden) | Prueba |
|---|---|---|
| No enciende nada | Cable/toma, fuente (PSU), botón, placa | Otra toma; LED de placa; prueba de PSU (puente o tester); mínimo vital (placa+CPU+1 RAM) |
| Enciende, sin imagen | RAM, GPU, monitor/cable, BIOS | Un módulo de RAM por ranura; vídeo integrado; beep codes/LED de depuración; reset CMOS |
| Reinicios/apagados | Temperatura, PSU, RAM, drivers | Sensores (HWiNFO/`sensors`), pasta térmica y ventiladores, MemTest86, visor de eventos (Kernel-Power 41, WHEA) |
| Lento | Disco HDD saturado/fallando, RAM insuficiente, inicio, malware | SMART (CrystalDiskInfo/`smartctl -a`), uso de RAM, autoruns; pasar a SSD es el arreglo más rentable |
| Disco con errores | SSD/HDD en fin de vida, cable SATA, controlador | SMART (reasignados, pendientes), `chkdsk`/`fsck`, clonar **antes** de intentar reparar |
| Red cae | Cable, puerto, driver, DHCP, Wi-Fi saturado | Cable certificado, otro puerto, `ipconfig /all`, logs del AP |
| Laptop no carga | Cargador, conector DC, batería, placa | Cargador conocido, batería fuera + cargador, inspección del jack |
| Servidor degrada | Disco en RAID degradado, memoria ECC con errores, PSU redundante caída, temperatura | iDRAC/iLO/BMC, logs de RAID, `ipmitool sel list` |

Prácticas: antiestática; fotografiar antes de desarmar; firmware/BIOS al día; piezas de repuesto críticas en stock (discos, PSU, módulos de RAM, SFP); garantía y contrato de soporte antes de abrir un servidor; registro en el inventario (CMDB) con número de serie y vida útil.

## 3. Redes

**Diseño hospitalario de referencia**
- Topología: núcleo (core, redundante) → distribución por edificio/piso → acceso (switches PoE para APs, teléfonos, cámaras). Enlaces troncales 10/25/40 GbE con LACP; acceso 1/2.5 GbE PoE+.
- **Segmentación por VLAN** (mínimo): administrativa, clínica (estaciones del HIS), equipos médicos/IoMT (monitores, analizadores, bombas — aislados, sin internet), imágenes (PACS, alto ancho de banda), VoIP, cámaras/CCTV, invitados/pacientes (sólo internet, aislada), gestión (switches, APs, BMC), servidores (varias por nivel: web/app/datos/respaldo), proveedores (VPN con destino limitado).
- Firewall de nueva generación en el perímetro **y** entre segmentos (este-oeste); políticas por VLAN; IDS/IPS; filtrado DNS.
- **Wi-Fi 6E/7**: estudio de sitio (site survey) antes de comprar; densidad por sala; SSID clínico con 802.1X (certificados por dispositivo), SSID IoMT con PSK por dispositivo o 802.1X, SSID pacientes con portal cautivo aislado; controlador centralizado; roaming rápido (802.11r/k/v) para carros de enfermería.
- Enrutamiento: OSPF interno, BGP con ISPs si hay dos salidas; VRRP/HSRP en gateways; QoS para VoIP e imágenes.
- Servicios: DHCP con reservas para equipos médicos; DNS interno redundante; NTP interno (los mensajes HL7 y auditoría dependen de la hora); 802.1X/NAC (RADIUS) para que nada desconocido entre a la VLAN clínica.
- WAN entre sedes: SD-WAN o MPLS + VPN IPsec de respaldo; doble ISP por sede; latencia < 30 ms para HIS centralizado.
- Monitoreo: SNMP/NetFlow (Zabbix, LibreNMS, PRTG); mapas; alertas por caída, errores CRC, saturación.
- Cableado estructurado: Cat6A mínimo, fibra OM4/OS2 entre cuartos, certificación, etiquetado (TIA-606), racks de telecomunicaciones por piso con UPS.

**Diagnóstico**: `ping`/`traceroute`/`mtr`, `nslookup`, `iperf3` para ancho de banda, `show interfaces` (errores, duplex), `show mac address-table`, `show spanning-tree`, captura con Wireshark en el segmento afectado, logs del controlador Wi-Fi (reasociaciones, canal, interferencia).

## 4. Centro de datos on-premise (de 10 a cientos de servidores)

**Decisión previa**: on-prem vs. nube vs. híbrido. Hospital: núcleo clínico (HIS, PACS, LIS) suele quedar on-prem o en colocation por latencia, soberanía y costo de egreso; nube para BI, IA, correo (M365), DR y picos. Documentar como ADR.

**Diseño físico (Tier II–III objetivo)**
- Ubicación: sin riesgo de inundación, fuera de rutas de pacientes, acceso controlado (biometría + bitácora), sin ventanas, piso técnico o canalización aérea.
- Energía: dos acometidas o acometida + generador (autonomía ≥ 24 h, prueba mensual), UPS en línea doble conversión (N+1, autonomía 15–30 min hasta que arranca el generador), PDUs duales (A/B) por rack, servidores con doble fuente.
- Climatización: pasillo frío/caliente, 18–27 °C en entrada de aire (ASHRAE A1), humedad 40–60 %, unidades redundantes (N+1), sensores por rack.
- Protección: detección temprana de humo (VESDA), extinción con agente limpio (FM-200/Novec, no agua), sensores de agua, cámaras.
- Racks: 42–48U, 800 mm de ancho para gestión de cables, PDU vertical, paneles ciegos, etiquetado; densidad 5–10 kW/rack típica (más con GPU: refrigeración específica).
- Cableado: top-of-rack (ToR) con fibra al núcleo; bandejas separadas datos/energía; fibra para 25/100 GbE.
- Capacidad: planificar a 3–5 años (kW, U, puertos, almacenamiento); dejar 30 % de holgura.

**Diseño lógico**
- **Virtualización**: VMware vSphere (maduro, costoso tras Broadcom), **Proxmox VE** (abierto, Ceph integrado, excelente costo), Hyper-V (ecosistema Microsoft), Nutanix (hiperconvergente). Clúster mínimo 3 nodos; HA y migración en vivo; separar redes de gestión, VM, almacenamiento y migración.
- **Almacenamiento**: SAN (FC/iSCSI) o hiperconvergente (Ceph, vSAN, ZFS en pares); niveles NVMe (bases de datos) / SSD (VMs) / HDD (archivo, PACS frío); snapshots no son respaldo.
- **Contenedores**: Kubernetes (RKE2/k3s/OpenShift) para servicios nuevos del HIS; registro de imágenes privado; GitOps (Argo CD).
- **Respaldo 3-2-1-1-0**: 3 copias, 2 medios, 1 fuera de sitio, 1 inmutable/aislada (ransomware), 0 errores en pruebas de restauración. Herramientas: Veeam, Proxmox Backup Server, Bacula, snapshots de base de datos + logs. Prueba de restauración mensual documentada.
- **DR**: sitio secundario (otra sede o nube) con replicación; definir RPO/RTO por sistema (HIS: RPO ≤ 15 min, RTO ≤ 2 h como referencia); plan de contingencia clínico en papel para caídas (downtime procedures); simulacro anual.
- **Seguridad**: bastión para administración, MFA en consolas (BMC, hipervisor), parches con ventana, segmentación, EDR en servidores, SIEM (Wazuh/Sentinel), escaneo de vulnerabilidades (OpenVAS/Nessus), hardening CIS, cifrado de discos en reposo.
- **Monitoreo y operación**: Zabbix/Prometheus+Grafana (métricas), Loki/ELK (logs), alertas a Teams/correo/SMS, runbooks por alerta, CMDB (NetBox para IP/racks/cables; GLPI/ITop para activos y tickets), gestión de cambios (CAB ligero), ITIL.
- **Automatización**: IaC con Terraform (nube) y Ansible (on-prem), imágenes doradas (Packer), PXE para instalación masiva; nada a mano dos veces.
- **Servidores**: Dell/HPE/Lenovo/Supermicro; discos empresariales; memoria ECC; garantía 3–5 años con respuesta 4 h para lo crítico; firmware con política.
- **GPU para IA local**: nodos dedicados (p. ej. 4–8 GPU por nodo), refrigeración y energía aparte, vLLM; justificar contra API con costo por tarea.

**Dimensionamiento rápido (regla de pulgar, verificar con el proveedor)**
- HIS mediano (3 sedes, 300 camas, 1 500 usuarios): 6–10 nodos de virtualización (2×32 núcleos, 512 GB–1 TB RAM), 100–200 TB útiles con niveles, PACS aparte (crecimiento 5–20 TB/año).
- Energía: suma de consumos nominales × 0.6–0.7 de factor real; UPS a 60–70 % de carga.

## 5. Plan tipo para montar el datacenter (fases)

1. **Descubrimiento** (2–4 semanas): inventario de aplicaciones y cargas, RPO/RTO, crecimiento, restricciones del edificio, presupuesto.
2. **Diseño** (4–6 semanas): ADRs (on-prem/híbrido, hipervisor, almacenamiento, red, respaldo), planos, lista de materiales, TDR para obra civil, energía, climatización, redes, cómputo; criterios de aceptación.
3. **Obra e infraestructura física** (8–16 semanas): civil, energía, clima, racks, cableado; pruebas de carga de UPS/generador; certificación de cableado.
4. **Plataforma** (4–8 semanas): red, hipervisor, almacenamiento, respaldo, monitoreo, seguridad; automatización; pruebas de HA y de restauración.
5. **Migración** (por olas): no crítico primero; ventana y plan de retorno por sistema; validación clínica tras cada ola.
6. **Operación**: runbooks, turnos, mantenimiento preventivo, simulacro de DR, revisión de capacidad trimestral.

## 6. Entregables de este dominio

- **Informe de diagnóstico** (equipo o red): síntoma, pruebas, causa, solución, costo, prevención.
- **Reporte de ordenamiento** de archivos: antes/después, movimientos, duplicados, liberado, pendientes.
- **Diseño de red**: diagrama L2/L3, plan de VLAN/IP, lista de equipos, políticas de firewall, plan de Wi-Fi.
- **Diseño de datacenter**: ADRs, diagramas físico y lógico, BOM con costos, plan por fases, RPO/RTO por sistema, plan de respaldo y DR.
- **TDR / especificación técnica** para contratación (alcance, requisitos mínimos, criterios de evaluación, SLA, garantías, entregables, pruebas de aceptación).
- **Runbooks** operativos y plan de contingencia clínico por caída de sistemas.
