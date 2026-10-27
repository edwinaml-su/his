# Programación, diseño de sistemas y protocolos

## 1. Elegir lenguaje y stack (criterio, no moda)

| Necesidad | Primera opción | Alternativa | Por qué |
|---|---|---|---|
| Backend de HIS / APIs clínicas | **TypeScript (Node/NestJS)** o **C# (.NET 8/9)** | Java (Spring Boot), Go | Tipado, ecosistemas FHIR (Medplum/HAPI), talento disponible en la región |
| Scripts, datos, IA, automatización | **Python** | — | Pandas, Airflow, SDKs de IA, scripting de sistemas |
| Frontend web | **TypeScript + React** (Next.js) | Vue, Angular | Estándar de mercado; componentes accesibles |
| Móvil | React Native / Flutter | Nativo (Swift/Kotlin) | Una base para iOS/Android |
| Servicios de alto rendimiento / infraestructura | **Go** | Rust | Binario único, concurrencia simple |
| Automatización Windows/M365 | **PowerShell** (Microsoft Graph) | Python | Nativo del tenant |
| Automatización Linux | **Bash** + Python | — | — |
| ERP | Odoo = **Python** (ORM, módulos) | — | Ya en la casa |
| Datos | **SQL** (PostgreSQL dialecto), DAX en Power BI, dbt | — | — |

Reglas: un lenguaje por capa, no cinco; versiones LTS; dependencias auditadas (SCA), lockfiles; estilo automático (Prettier/Black/dotnet format); revisión de código obligatoria; pruebas en CI.

## 2. Arquitectura de sistemas

- **Monolito modular primero**; microservicios cuando hay equipos independientes y necesidad real de escalar o desplegar por separado. El HIS típico: monolito modular (admisión, clínico, farmacia, facturación) con límites claros (DDD: contextos acotados) y servicios aparte para integración, documentos/imágenes, notificaciones e IA.
- **Capas**: arquitectura hexagonal/limpia (dominio sin dependencias de framework), puertos y adaptadores (base de datos, HL7, FHIR, Odoo, correo).
- **Comunicación**: síncrona (REST/gRPC) para consultas; **asíncrona con eventos** (Kafka, RabbitMQ, Azure Service Bus) para integraciones y procesos largos; outbox pattern para consistencia; idempotencia en consumidores; dead-letter queues.
- **APIs**: REST con OpenAPI 3 (contrato primero), versionado (`/v1`), paginación, filtros, errores RFC 9457 (Problem Details), rate limiting, autenticación OAuth2/OIDC, scopes; **gRPC** para servicio-a-servicio de alto volumen; **GraphQL** para frontends con muchas vistas (con cuidado en N+1 y autorización por campo); **webhooks** firmados para notificar a terceros.
- **Datos**: PostgreSQL como base por defecto (JSONB, extensiones: pgvector, PostGIS, TimescaleDB); SQL Server/Oracle cuando el legado lo impone; Redis para caché/sesiones/colas ligeras; MongoDB sólo con documentos realmente sin esquema; MinIO/S3 para archivos e imágenes. Multi-tenant (multipaís): esquema por tenant o columna `tenant_id` con RLS; nunca una base por cliente sin automatización.
- **Multipaís**: configuración por país (moneda, impuestos, catálogos, idioma, normativa) como datos, no como ramas de código; zona horaria y formato en la capa de presentación; identificadores con autoridad asignadora.
- **Seguridad por diseño**: OWASP ASVS/Top 10, validación de entrada, consultas parametrizadas, secretos en bóveda, cifrado TLS 1.3 y en reposo, auditoría de cada acceso a PHI (quién, qué, cuándo, desde dónde), registro inmutable.
- **Rendimiento y resiliencia**: timeouts, reintentos con backoff, circuit breaker, bulkheads, caché con invalidación clara, pruebas de carga (k6/Locust) antes de producción.
- **Observabilidad**: logs estructurados (JSON) con correlación, métricas (Prometheus/OpenTelemetry), trazas distribuidas; SLOs por servicio (disponibilidad, latencia p95, errores).
- **Disponibilidad**: sin punto único de falla; despliegues azul/verde o canario; migraciones de esquema compatibles hacia atrás (expand/contract).

**Plantilla de ADR (decisión de arquitectura)**: título, fecha, contexto, opciones consideradas (pros/contras/costo), decisión, consecuencias, revisión. Guardar en la bitácora (`decisiones-adr.md`).

## 3. Protocolos de comunicación (qué es, para qué, cuidado)

| Capa | Protocolo | Uso típico | Cuidado |
|---|---|---|---|
| Red | **IPv4/IPv6**, ICMP, ARP | Base; planear IPv6 dual-stack en diseños nuevos | NAT no es seguridad |
| Transporte | **TCP** (fiable), **UDP** (rápido), **QUIC** (HTTP/3) | TCP para HL7/MLLP, bases, SSH; UDP para VoIP, DNS, SNMP | MTU, keepalives en integraciones largas |
| Seguridad | **TLS 1.3** (1.2 mínimo), mTLS, IPsec, WireGuard/OpenVPN, SSH | Todo tráfico de aplicación cifrado; VPN sitio-a-sitio y de proveedor | Certificados con renovación automática (ACME), sin TLS 1.0/1.1 |
| Aplicación web | **HTTP/1.1, HTTP/2, HTTP/3**, **WebSocket**, SSE | APIs, FHIR, portales; WebSocket/SSE para tiempo real (monitores, tableros) | Cabeceras de seguridad (HSTS, CSP), CORS mínimo |
| Mensajería | **AMQP** (RabbitMQ), **Kafka** (propio), **MQTT** (IoT/IoMT, ligero, QoS 0-2), STOMP | Eventos, dispositivos médicos, sensores de datacenter | Autenticación por dispositivo; broker redundante |
| Salud | **MLLP** (HL7 v2 sobre TCP, puerto convencional 2575), FHIR REST, **DICOM** (C-STORE/C-FIND/C-MOVE; DICOMweb), ASTM E1381/E1394 y HL7 para analizadores, IEEE 11073/SDC para equipos de cabecera | Integración clínica | MLLP sin cifrado: encapsular en VPN/TLS; ACK obligatorio |
| Archivos | **SFTP/FTPS** (nunca FTP), **SMB 3** (compartidos Windows), NFS v4, rsync, WebDAV | Intercambio con aseguradoras/laboratorios, almacenamiento | SMBv1 deshabilitado; cifrado SMB |
| Directorio/identidad | **LDAP(S)**, Kerberos, **OIDC/OAuth2**, SAML 2.0, **SCIM**, RADIUS/802.1X | Autenticación y aprovisionamiento | Nunca contraseñas en claro; tokens cortos |
| Infraestructura | **DNS** (DNSSEC, DoH), **DHCP**, **NTP/PTP**, **SNMP v3**, Syslog/CEF, NetFlow/IPFIX, LLDP, STP/RSTP, LACP, VRRP, OSPF, BGP, VXLAN/EVPN | Operación de red y datacenter | SNMP v1/v2c sólo en gestión aislada; NTP interno autoritativo |
| Correo | SMTP (587/465 con TLS), IMAP, **SPF/DKIM/DMARC** | Correo transaccional, notificaciones | DMARC en `reject` para el dominio corporativo |
| Fiscal/documentos | DTE (JSON firmado, API Hacienda), XAdES/PAdES para firmas, PDF/A para archivo | Facturación, consentimientos | Sello de tiempo |
| Integración de datos | JDBC/ODBC, CDC (Debezium, logical replication), REST/JSON-RPC (Odoo), XML-RPC, SOAP (legados) | ETL/ELT, BI | Cargas incrementales; nunca consultas pesadas sobre producción en horario clínico (réplica de lectura) |
| IA | **MCP** (Model Context Protocol) para herramientas de agentes, OpenAI-compatible API como lingua franca de LLM | Agentes y modelos locales (vLLM/Ollama exponen API compatible) | Permisos por herramienta; registro |

## 4. DevOps y entrega

- Git (trunk-based o GitFlow ligero), PRs con revisión, Conventional Commits.
- CI/CD (GitHub Actions / Azure DevOps / GitLab): build → pruebas (unitarias, integración, contrato de API, seguridad SAST/SCA) → imagen → despliegue a dev/QA/prod con aprobación.
- Infraestructura como código (Terraform, Ansible), configuración por entorno en variables/secretos, nunca en el repositorio.
- Contenedores (Docker) + Kubernetes/Compose; imágenes mínimas, escaneadas (Trivy); usuario no root.
- Migraciones de base de datos versionadas (Flyway/Liquibase/Prisma/Alembic).
- Entornos: dev (datos sintéticos), QA (copia anonimizada), prod. Nunca PHI real fuera de prod.
- Definición de terminado: código revisado, pruebas verdes, documentación (OpenAPI, README, runbook), observabilidad, seguridad revisada, aceptación del dueño de negocio.

## 5. Revisión de código y diseño (lista corta)

Corrección → seguridad (entrada, authz por recurso, PHI en logs) → datos (transacciones, índices, migraciones) → resiliencia (timeouts, reintentos, idempotencia) → rendimiento (N+1, paginación) → legibilidad y pruebas → documentación.

## 6. Entregables de este dominio

- **ADR** por decisión importante.
- **Diseño de solución**: contexto (C4 nivel 1–2), componentes, contratos de API (OpenAPI), modelo de datos (ERD), eventos, seguridad, despliegue, SLOs, costos.
- **Código y scripts** listos, con comentarios, manejo de errores y pruebas; un archivo por artefacto.
- **Estándares de desarrollo** (documento): lenguajes, estilo, ramas, revisión, pruebas, seguridad, logs.
- **Evaluación técnica de proveedor/sistema**: arquitectura, stack, APIs, seguridad, escalabilidad, operación, lock-in, deuda técnica, riesgos; puntuación y recomendación.
