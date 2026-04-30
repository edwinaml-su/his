# 03 — Blueprints Técnicos por Módulo (30 módulos)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autores:** @AS + @AT
**Versión:** 1.0 — 2026-04-30
**Referencia:** TDR §5–§28 + `docs/02_arquitectura_software.md`

> Cada blueprint sigue el mismo formato:
> **Bounded Context** · **Agregado(s) raíz** · **Entidades / VOs principales** · **Eventos de dominio** · **Integraciones** · **Complejidad** (S/M/L/XL) · **Fase** (MVP / posterior).

---

## Convenciones

- **Complejidad:** S = ≤2 sem; M = 2–4 sem; L = 1–3 meses; XL = >3 meses (incluye dependencia externa o normativa).
- **Fase:** MVP (Fase 0+1 según TDR §30.2), Fase 2…7 según cronograma TDR.
- Todo agregado raíz vive en `packages/domain/<bc>/aggregates/`.
- Todo evento se persiste como **outbox** en `domain_events` y se publica vía Inngest.

---

## 1. Multi-Entidad (TDR §5)

| Item | Detalle |
|---|---|
| **Bounded Context** | `identity` |
| **Agregados raíz** | `Country`, `Organization`, `Establishment`, `Currency`, `AccountingBook`, `ExchangeRate` |
| **Entidades / VOs** | `IsoCode`, `Timezone`, `OrgHierarchyNode` (Holding→Empresa→Estab→Sede→Servicio), `FunctionalCurrency`, `RoundingPolicy`, `RateType` (compra/venta/promedio/oficial/fiscal) |
| **Eventos** | `CountryActivated`, `OrganizationCreated`, `EstablishmentEnabled`, `CurrencyAdded`, `ExchangeRatePublished`, `BookActivated` |
| **Integraciones** | BCR El Salvador (tasas), feed regional Banxico/BCCR, Catálogo ISO 3166/4217 |
| **Complejidad** | **L** |
| **Fase** | **MVP — Fase 1** (cimiento de todo) |

---

## 2. Seguridad, Auditoría y Control de Acceso (TDR §6)

| Item | Detalle |
|---|---|
| **Bounded Context** | `security` |
| **Agregados raíz** | `User`, `Role`, `Permission`, `ConsentToken`, `BreakGlassSession`, `AuditEntry` (append-only, no es agregado mutable) |
| **Entidades / VOs** | `MfaFactor` (TOTP/SMS/Push), `Session`, `PasswordPolicy`, `RbacAssignment`, `AbacAttribute` (servicio, sede, turno), `SegregationOfDutiesRule` |
| **Eventos** | `UserAuthenticated`, `MfaChallengeIssued`, `RoleGranted/Revoked`, `BreakGlassActivated`, `AuditChainBroken` (alerta crítica), `ConsentGranted/Revoked` |
| **Integraciones** | Supabase Auth, AD/LDAP vía WorkOS, IdP SAML/OIDC, SIEM externo (Splunk/Elastic) |
| **Complejidad** | **L** |
| **Fase** | **MVP — Fase 1** |

---

## 3. Catálogos Maestros y Parametrización (TDR §7)

| Item | Detalle |
|---|---|
| **Bounded Context** | `catalog` (transversal, dividido en sub-módulos) |
| **Agregados raíz** | `GeoCatalog`, `IdentityDocumentType`, `PatientType/Category/AgeClass`, `Specialty`, `Service`, `Drug`, `LabTest`, `ImagingStudyType`, `Supply`, `Equipment`, `BillableService`, `ChartOfAccounts`, `BusinessRule` |
| **Entidades / VOs** | `Code` (CIE-10/11, CIAP-2, CUPS, SNOMED, LOINC, ATC), `EffectivePeriod`, `Translation`, `VersioningTag`, `Mapping` (cross-coding) |
| **Eventos** | `CatalogItemCreated/Updated/Deprecated`, `MappingPublished`, `RuleActivated` |
| **Integraciones** | Importadores CIE-10/11 OMS, LOINC, ATC, SNOMED CT (licenciable), DNM (registro sanitario SV), formularios DTE |
| **Complejidad** | **XL** (volumen de catálogos; editor sin código) |
| **Fase** | **MVP — Fase 1** (catálogos críticos: geo, doc-id, especialidades, CIE-10) · **Fase 2-4** completar resto |

---

## 4. Admisión, Altas y Traslados — ADT + MPI (TDR §8)

| Item | Detalle |
|---|---|
| **Bounded Context** | `adt` (incluye MPI) |
| **Agregados raíz** | `Patient` (MPI), `Encounter`, `Admission`, `Transfer`, `Discharge`, `Bed`, `BedAssignment`, `DeathCertificate` |
| **Entidades / VOs** | `IdentityDocument` (DUI con dígito verificador, NIT, NIE, pasaporte, partida), `Allergy`, `BloodType`, `EmergencyContact`, `Wristband`, `BedStatus` (libre/ocupada/sucia/bloqueada/reservada/mantenimiento), `DischargeType` |
| **Eventos** | `PatientRegistered`, `PatientsMerged`, `PatientAdmitted`, `Transferred`, `Discharged`, `DeathCertified`, `BedReleased` |
| **Integraciones** | Registro Civil SV (cuando exista), impresoras de pulseras, biometría (huella, foto), HL7 ADT^A01..A40 vía Mirth |
| **Complejidad** | **L** |
| **Fase** | **MVP — Fase 1** |

---

## 5. Triage de Manchester (TDR §9)

| Item | Detalle |
|---|---|
| **Bounded Context** | `triage` |
| **Agregados raíz** | `TriageEncounter`, `Flowchart`, `Discriminator`, `RetriageEvent` |
| **Entidades / VOs** | `TriageLevel` (Rojo/Naranja/Amarillo/Verde/Azul), `MaxWaitTime`, `VitalSigns` (TA, FC, FR, SpO₂, T°, glicemia, dolor, Glasgow), `PresentingComplaint` (52 estándar), `PediatricVariant` (TEP, FLACC, Wong-Baker) |
| **Eventos** | `TriageStarted`, `LevelAssigned`, `LevelOverridden` (con justificación), `MaxWaitExceeded`, `RetriageRequired`, `LeftWithoutBeingSeen` |
| **Integraciones** | Monitor de signos vitales (vía Mirth/HL7 ORU), tablero realtime emergencia (Supabase Realtime), notificaciones a equipo |
| **Complejidad** | **M** |
| **Fase** | **MVP — Fase 1** (TDR Fase 1 explícitamente lo incluye) |

---

## 6. Atención Ambulatoria (TDR §10)

| Item | Detalle |
|---|---|
| **Bounded Context** | `ambulatory` |
| **Agregados raíz** | `Schedule` (agenda), `Appointment`, `OutpatientEncounter`, `OutpatientProcedure`, `DayHospitalSession`, `TelemedicineSession` |
| **Entidades / VOs** | `AppointmentType`, `Slot`, `WaitlistEntry`, `NoShowReason`, `SoapNote`, `Prescription` (referencia farmacia), `MedicalLeave` (incapacidad ISSS) |
| **Eventos** | `AppointmentBooked/Confirmed/Rescheduled/Cancelled/NoShow`, `ConsultationStarted/Completed/Signed`, `TelemedicineLinkIssued` |
| **Integraciones** | Twilio/WhatsApp (recordatorios), plataforma de videoconsulta externa (Zoom/Daily.co/Meet), portal del paciente, ISSS (formato incapacidad) |
| **Complejidad** | **L** |
| **Fase** | **Fase 2** |

---

## 7. Hospitalización / Atención No Ambulatoria (TDR §11)

| Item | Detalle |
|---|---|
| **Bounded Context** | `inpatient` |
| **Agregados raíz** | `InpatientStay`, `MedicalOrderSet` (CPOE), `NursingCarePlan`, `ProgressNote`, `IcuStay` (sub-tipo), `LaborAndDelivery`, `Newborn` |
| **Entidades / VOs** | `Order` (med, dieta, fluidos, O₂, monitorización, actividad, profilaxis), `VitalSignsRound`, `BalanceFluid`, `IcuScore` (APACHE II, SOFA, NEWS, Glasgow, RASS, CAM-ICU, Braden, Morse), `Partogram`, `ApgarScore`, `Capurro`, `Ballard` |
| **Eventos** | `StayStarted`, `OrdersIssued`, `OrdersChanged`, `PatientDeteriorating` (NEWS↑), `NewbornBorn`, `StayEnded` |
| **Integraciones** | Monitor multiparamétrico (HL7 ORU), bombas inteligentes (DERS), ventiladores, Mirth, eMAR (módulo 16) |
| **Complejidad** | **XL** |
| **Fase** | **Fase 3** |

---

## 8. Emergencias (TDR §12)

| Item | Detalle |
|---|---|
| **Bounded Context** | `emergency` |
| **Agregados raíz** | `EmergencyEncounter`, `ActivationCode` (Rojo/Azul/Trauma/Ictus/Infarto/Sepsis/Materno/Masiva), `ObservationStay`, `ForensicCase` |
| **Entidades / VOs** | `DoorToXTimer` (puerta-aguja, puerta-balón), `BundleChecklist` (sepsis hour-1, stroke), `ChainOfCustody` (evidencia forense) |
| **Eventos** | `CodeActivated`, `BundleCompleted/Breached`, `EvidenceSealed`, `ForensicNotified` (PNC, Fiscalía, Junta NA) |
| **Integraciones** | Triage (módulo 5), megafonía / pagers, PNC y Fiscalía SV (notificación manual), banco de sangre, quirófano on-call |
| **Complejidad** | **L** |
| **Fase** | **Fase 2** |

---

## 9. Salas de Operaciones / Quirófanos (TDR §13)

| Item | Detalle |
|---|---|
| **Bounded Context** | `surgery` |
| **Agregados raíz** | `SurgicalCase`, `OperatingRoomSchedule`, `WhoSafeSurgeryChecklist` (Sign-In / Time-Out / Sign-Out), `AnesthesiaRecord`, `RecoveryStay`, `SterilizationLot` (CEYE) |
| **Entidades / VOs** | `AsaClass`, `SurgicalTeam` (cirujano, anestesiólogo, instrumentista, circulante), `GauzeCount`, `Implant` (con UDI), `AldreteScore`, `IndicatorBio/Chem/Phys` (esterilización) |
| **Eventos** | `CaseScheduled`, `ChecklistStepCompleted`, `IncisionMade`, `CaseClosed`, `ProsthesisImplanted`, `SterilizationCycleCompleted` |
| **Integraciones** | Anestesia / monitor (HL7), inventario implantes (UDI), banco de sangre, autoclaves (validación lote) |
| **Complejidad** | **XL** |
| **Fase** | **Fase 3** |

---

## 10. Historia Clínica Electrónica HCE (TDR §14)

| Item | Detalle |
|---|---|
| **Bounded Context** | `ehr` |
| **Agregados raíz** | `PatientChart`, `ProblemList`, `AllergyList`, `MedicationList` (vista consolidada), `VaccinationRecord`, `ClinicalNote`, `Template` (editable), `Attachment` |
| **Entidades / VOs** | `Antecedente` (familiar/personal/gineco/ped), `Vaccine` (PAI SV), `Signature` (simple, avanzada con sello tiempo), `NoteVersion`, `GrowthCurve` (OMS) |
| **Eventos** | `NoteSigned`, `NoteAmended` (adendum), `AllergyAdded`, `ProblemActivated/Resolved`, `VaccineApplied`, `ChartShared` (consentimiento entre orgs) |
| **Integraciones** | FHIR DocumentReference (cross-org), firma electrónica avanzada (Ley SV), PAI MINSAL, scanners de documentos legados |
| **Complejidad** | **XL** |
| **Fase** | **Fase 2** (HCE básica) · **Fase 3** (avanzada) |

---

## 11. Farmacia y Gestión de Medicamentos (TDR §15)

| Item | Detalle |
|---|---|
| **Bounded Context** | `pharmacy` |
| **Agregados raíz** | `Prescription` (CPOE), `PharmacyValidation`, `Dispensation`, `IvCompounding`, `ControlledSubstanceLedger`, `MedicationReconciliation`, `AdverseDrugReaction` |
| **Entidades / VOs** | `Dose` (cantidad, unidad, vía, frecuencia, duración), `Interaction`, `RenalAdjustment`, `Lot`, `ExpiryDate`, `FefoStrategy`, `LasaTag`, `BarcodeScan` |
| **Eventos** | `Prescribed`, `Validated/Rejected`, `Dispensed`, `Returned`, `ControlledLogged`, `RamReported`, `RecallIssued` |
| **Integraciones** | Base de conocimiento (Lexicomp/Micromedex/Vademécum), gabinetes Pyxis/Omnicell, DNM (farmacovigilancia), eMAR (módulo 12) |
| **Complejidad** | **XL** |
| **Fase** | **Fase 4** |

---

## 12. Administración de Medicamentos eMAR (TDR §16)

| Item | Detalle |
|---|---|
| **Bounded Context** | `emar` |
| **Agregados raíz** | `MedicationAdministrationRecord`, `AdministrationEvent`, `InfusionSession`, `PrnAssessment` |
| **Entidades / VOs** | `FiveRights` (paciente/medicamento/dosis/vía/hora con tolerancia ±), `DoubleVerification` (insulinas, opioides, quimio, vasoactivos ped), `NonAdministrationReason`, `InfusionRateChange` |
| **Eventos** | `DoseAdministered`, `DoseOmitted`, `InfusionStarted/RateChanged/Stopped`, `PrnDelivered`, `MedicationErrorPrevented` |
| **Integraciones** | Bombas inteligentes (DERS bidireccional cuando es factible), lector RFID/barcode, eHCE |
| **Complejidad** | **L** |
| **Fase** | **Fase 4** |

---

## 13. Laboratorio Clínico LIS (TDR §17)

| Item | Detalle |
|---|---|
| **Bounded Context** | `lis` |
| **Agregados raíz** | `LabOrder`, `Specimen`, `LabResult`, `Antibiogram` (microbio), `BloodBankUnit`, `PathologyReport`, `QualityControl` |
| **Entidades / VOs** | `Tube`, `RejectionReason`, `LoincCode`, `ReferenceRange`, `DeltaCheck`, `CriticalValue`, `LeveyJennings`, `WestgardRule`, `MicCutoff` |
| **Eventos** | `OrderPlaced`, `SpecimenCollected/Rejected`, `ResultsReceivedFromAnalyzer`, `CriticalValueNotified`, `ResultValidated`, `BloodUnitTransfused`, `TransfusionReactionReported` |
| **Integraciones** | Analizadores (HL7 v2 / ASTM via Mirth), banco de sangre nacional, biología molecular (PCR), citología (Bethesda), oncología (TNM) |
| **Complejidad** | **XL** |
| **Fase** | **Fase 4** |

---

## 14. Imágenes Diagnósticas RIS / PACS (TDR §18)

| Item | Detalle |
|---|---|
| **Bounded Context** | `ris` (RIS interno) + integración con PACS externo (Orthanc) |
| **Agregados raíz** | `ImagingOrder`, `ImagingStudy`, `RadiologyReport`, `DoseRecord`, `TeleRadiologyAssignment` |
| **Entidades / VOs** | `Modality` (CR/DR/CT/MR/US/MG/NM/PT/XA), `Protocol`, `ContrastAgent`, `BiRads/LiRads/PiRads/TiRads/LungRads`, `Ctdivol`, `Dlp`, `MammoGlandularDose` |
| **Eventos** | `OrderPlaced`, `WorklistAcknowledged` (DMWL), `StudyAcquired`, `StudyArchived` (PACS), `ReportSigned`, `CriticalFindingNotified`, `DoubleReadingCompleted` |
| **Integraciones** | **Orthanc PACS** (DICOMweb QIDO/WADO/STOW), modalidades vía MWL, visor diagnóstico OHIF embebido, FHIR ImagingStudy |
| **Complejidad** | **XL** |
| **Fase** | **Fase 4** (con dependencia de Orthanc disponible Fase 3) |

---

## 15. Insumos y Almacén Hospitalario (TDR §19)

| Item | Detalle |
|---|---|
| **Bounded Context** | `inventory` |
| **Agregados raíz** | `Warehouse`, `SupplyItem`, `StockMovement`, `PurchaseRequest`, `PurchaseOrder`, `Receipt`, `CycleCount`, `Quarantine` |
| **Entidades / VOs** | `Gtin/Udi`, `Lot`, `ExpiryDate`, `ReorderPoint`, `MinMaxStock`, `MovementType` (recepción/transferencia/consumo/devolución/merma/ajuste) |
| **Eventos** | `StockReceived`, `StockTransferred`, `StockConsumed` (cargo a paciente o CC), `ItemQuarantined`, `RecallTriggered`, `ReorderPointReached` |
| **Integraciones** | LACAP (compras públicas SV), proveedores B2B, integración farmacia (módulo 11) |
| **Complejidad** | **L** |
| **Fase** | **Fase 4** (junto a farmacia) |

---

## 16. Servicios Hospitalarios, Usos y Equipos (TDR §20)

| Item | Detalle |
|---|---|
| **Bounded Context** | `services-equipment` |
| **Agregados raíz** | `BillableServiceCharge`, `EquipmentAsset`, `EquipmentUsageSession`, `MaintenanceOrder` (preventivo / correctivo), `SupportService` (lavandería, limpieza, transporte) |
| **Entidades / VOs** | `Tariff`, `Tier` (privada/semi/sala común/UCI), `ProrationRule`, `CalibrationCert`, `ElectricalSafetyCheck`, `Lifecycle` (operativo/mantenimiento/baja) |
| **Eventos** | `EquipmentAssignedToPatient`, `MaintenanceScheduled/Completed`, `EquipmentDecommissioned`, `ServiceCharged` |
| **Integraciones** | CMMS (sistema de mantenimiento; puede ser interno), facturación (módulo 19) |
| **Complejidad** | **L** |
| **Fase** | **Fase 3-4** |

---

## 17. Terapia Respiratoria (TDR §21)

| Item | Detalle |
|---|---|
| **Bounded Context** | `respiratory-therapy` |
| **Agregados raíz** | `RespiratoryOrder`, `TherapySession`, `VentilationSetup`, `TracheostomyCare` |
| **Entidades / VOs** | `Device` (cánula nasal, mascarilla, Venturi, alto flujo, CPAP, BiPAP, vent. invasivo), `BorgScale`, `MmrcScale`, `PeakFlow`, `VentParam` (FiO₂, PEEP, VT, FR) |
| **Eventos** | `SessionDelivered`, `OxygenTitrated`, `WeaningStarted`, `Extubated` |
| **Integraciones** | Ventiladores (HL7), oxímetros, cuenta del paciente |
| **Complejidad** | **M** |
| **Fase** | **Fase 4** |

---

## 18. Nutrición y Alimentación (TDR §22)

| Item | Detalle |
|---|---|
| **Bounded Context** | `nutrition` |
| **Agregados raíz** | `NutritionalAssessment`, `NutritionalPlan`, `DietOrder`, `MealServing`, `EnteralFormula`, `ParenteralFormula`, `Recipe` |
| **Entidades / VOs** | `Anthropometry`, `ScreeningTool` (NRS-2002, MUST, MNA, STRONGkids), `MacroTarget`, `MicroTarget`, `Allergen`, `CulturalRestriction` (kosher/halal/vegano) |
| **Eventos** | `AssessmentCompleted`, `DietPrescribed`, `MealServed/Returned`, `NpoStarted/Lifted` |
| **Integraciones** | Sistema de cocina (interno), inventario alimentos, costos hospitalarios |
| **Complejidad** | **M** |
| **Fase** | **Fase 4** |

---

## 19. Cuentas Hospitalarias y Facturación + DTE (TDR §23)

| Item | Detalle |
|---|---|
| **Bounded Context** | `billing` |
| **Agregados raíz** | `HospitalAccount`, `Charge`, `Invoice`/`DTE`, `Payment`, `Receipt`, `AccountReceivable`, `AccountPayable`, `CashSession` |
| **Entidades / VOs** | `Tariff`, `Discount`, `Copay`, `Coinsurance`, `Deductible`, `CoverageCap`, `DteType` (Factura, CCF, NR, NC, ND, CompLiq, CompRet, FSE, FExp), `MhSeal` (sello recepción), `PaymentMethod`, `BtcConversion` (Ley Bitcoin SV) |
| **Eventos** | `AccountOpened/Closed`, `ChargePosted`, `InvoiceIssued`, `DteSubmittedToMh`, `DteAccepted/Rejected`, `DteContingencyMode`, `PaymentApplied`, `WriteOffApproved` |
| **Integraciones** | **MH El Salvador (DTE)** vía servicio dedicado, adaptadores fiscales por país (FEL Guatemala, CFDI México, DIAN Colombia, etc.), pasarelas de pago (tarjeta, ACH), bancos (conciliación), aseguradoras |
| **Complejidad** | **XL** |
| **Fase** | **Fase 5** |

---

## 20. Contabilidad y Finanzas Multi-Libro (TDR §24)

| Item | Detalle |
|---|---|
| **Bounded Context** | `accounting` |
| **Agregados raíz** | `JournalEntry` (con N líneas en N libros), `AccountingPeriod`, `FixedAsset`, `DepreciationSchedule`, `Budget`, `BankReconciliation`, `FinancialStatement` |
| **Entidades / VOs** | `ChartOfAccounts` (por libro), `CostCenter`, `RevenueCenter`, `FxRevaluation`, `BookType` (fiscal, IFRS, USGAAP, gerencial, presupuestal, estadístico), `Driver` (m², kg ropa, raciones) para distribución de costos |
| **Eventos** | `EntryPosted`, `EntryReversed`, `PeriodClosed/Reopened` (con justificación), `DepreciationRun`, `FxRevalued`, `IntercompanyEliminated`, `BudgetVarianceFlagged` |
| **Integraciones** | Bancos (archivos MT940, BAI2), bolsa de Valores (cuando aplique), plan de cuentas regulatorio SV (CVPCPA), Ministerio de Hacienda (libros IVA, F-07, F-11, F-910) |
| **Complejidad** | **XL** |
| **Fase** | **Fase 5** |

---

## 21. Convenios y Aseguradoras (TDR §25)

| Item | Detalle |
|---|---|
| **Bounded Context** | `insurance` |
| **Agregados raíz** | `Agreement` (convenio), `Policy` (afiliación), `Authorization` (pre-autorización), `Settlement` (liquidación), `Glossing` (glosa) |
| **Entidades / VOs** | `CoverageMatrix`, `NegotiatedTariff`, `EligibilityResult`, `AuthRequest/Response`, `GlossReason`, `RebillCycle` |
| **Eventos** | `EligibilityChecked`, `AuthorizationRequested/Approved/Denied`, `SettlementGenerated`, `GlossReceived/Resolved`, `PaymentReceivedFromInsurer` |
| **Integraciones** | **ISSS** (formato propio), **ISBM**, Sanidad Militar, MINSAL, FOSALUD, alcaldías, aseguradoras privadas locales (SISA, ASESUISA, Pacífico) e internacionales (BUPA, Allianz), HL7/X12 270/271/278/837 vía Mirth |
| **Complejidad** | **XL** |
| **Fase** | **Fase 5** |

---

## 22. Reportería e Inteligencia de Negocios (TDR §26)

| Item | Detalle |
|---|---|
| **Bounded Context** | `bi` |
| **Agregados raíz** | `Report`, `Dashboard`, `Kpi`, `RegulatoryReport`, `AdHocQuery`, `ScheduledDelivery` |
| **Entidades / VOs** | `KpiCategory` (asistencial, calidad, operativo, financiero, RH), `Threshold`, `Drilldown`, `DimensionalModel` (estrellas/copos por DA) |
| **Eventos** | `ReportGenerated`, `KpiThresholdBreached`, `RegulatoryReportSubmitted`, `BiRefreshCompleted` |
| **Integraciones** | **Réplica Postgres → Metabase** (open-source) o Power BI/Tableau vía conector, MINSAL (SUIS, SIMMOW), CVPCPA, ISSS, Hacienda |
| **Complejidad** | **L** (asume @DA/@BID definen modelo dimensional aparte) |
| **Fase** | **Fase 6** |

---

## 23. Tropicalización El Salvador (TDR §27)

> No es un BC nuevo: es **configuración + pack de catálogos + adaptadores** que activan los demás BCs en modo SV.

| Item | Detalle |
|---|---|
| **Bounded Context** | `localization-sv` (cross-cutting) |
| **Agregados raíz** | `LocalizationPack` (versionado por país); en SV: `SvLocalizationPack` |
| **Entidades / VOs** | `Departamento` (14), `Municipio` (44 post-reforma 2024 / 262 legacy), `FeriadoSv`, `Dui`, `Nit`, `Nie`, `Nup`, `JvpmRegistry`, `MinsalEstabCode`, `NawatTranslation` |
| **Eventos** | `LocalizationPackActivated`, `RegulatoryUpdatePublished` |
| **Integraciones** | DUI validator, registro JVPM/CSSP, MINSAL (códigos establecimientos), feriados oficiales |
| **Complejidad** | **M** |
| **Fase** | **MVP — Fase 1** (catálogos críticos SV) · **Fase 5** (DTE, libros IVA) · **Fase 6** (reportes regulatorios) |

---

## 24. Integraciones e Interoperabilidad (TDR §28)

> No es BC funcional: es **plataforma transversal**.

| Item | Detalle |
|---|---|
| **Bounded Context** | `integration-platform` |
| **Agregados raíz** | `IntegrationChannel`, `MessageMapping`, `InboundMessage`, `OutboundMessage`, `DeadLetter`, `IntegrationLog` |
| **Entidades / VOs** | `Hl7v2Message` (ADT/ORM/ORU/MDM/SIU/DFT/BAR), `FhirResource` (R4), `DicomEvent`, `X12Transaction` (270/271/278/837), `IheProfile` (XDS/PIX/PDQ/ATNA) |
| **Eventos** | `MessageReceived`, `MessageMappedAndPersisted`, `MessageFailed`, `ChannelHealthDegraded`, `DeadLetterAged` |
| **Integraciones** | **Mirth Connect** (gateway), HAPI FHIR, OAuth2 / OIDC para API pública, sandbox de integradores |
| **Complejidad** | **XL** |
| **Fase** | **Fase 4-5** (incremental por dominio que la consume) |

---

## 25. Sub-módulos transversales explícitos del TDR

Para alcanzar los **30 módulos**, descomponemos sub-bounded-contexts que el TDR menciona pero merecen blueprint propio:

### 25.1 Banco de Sangre (sub-BC dentro de LIS — TDR §17.7)

| Item | Detalle |
|---|---|
| **Agregados raíz** | `BloodUnit`, `Crossmatch`, `Transfusion`, `TransfusionReaction` |
| **VOs** | `AboRhType`, `AntibodyScreen`, `Compatibility` |
| **Eventos** | `UnitReceived`, `UnitCrossmatched`, `UnitDispatched`, `Transfused`, `ReactionReported` |
| **Integraciones** | Banco Nacional de Sangre, sistemas de hemovigilancia |
| **Complejidad** | **L** · **Fase 4** |

### 25.2 Anatomía Patológica (sub-BC LIS)

| Item | Detalle |
|---|---|
| **Agregados raíz** | `PathologySpecimen`, `MacroExam`, `MicroExam`, `IhcStain`, `PathologyReport` |
| **VOs** | `Bethesda`, `Tnm`, `Gleason` |
| **Eventos** | `SpecimenReceived`, `SlidesPrepared`, `ReportSigned`, `MalignancyDetected` |
| **Complejidad** | **L** · **Fase 4** |

### 25.3 Esterilización CEYE (sub-BC dentro de surgery — TDR §13.7)

| Item | Detalle |
|---|---|
| **Agregados raíz** | `SterilizationLot`, `InstrumentSet`, `BiologicIndicator` |
| **VOs** | `Method` (autoclave/EtO/plasma), `IndicatorResult` |
| **Eventos** | `LotProcessed`, `IndicatorPositive` (alerta crítica), `SetTracedToCase` |
| **Complejidad** | **M** · **Fase 3** |

### 25.4 Vacunación PAI (sub-BC dentro de EHR — TDR §14.5)

| Item | Detalle |
|---|---|
| **Agregados raíz** | `VaccinationSchedule`, `VaccineApplication` |
| **VOs** | `PaiSvSchedule`, `Lot`, `AnatomicSite`, `CoverageRate` |
| **Eventos** | `VaccineApplied`, `ScheduleCompleted`, `MissedDoseAlerted` |
| **Integraciones** | MINSAL PAI, carné de salud infantil |
| **Complejidad** | **M** · **Fase 2** (junto a HCE básica) |

### 25.5 Notificación de Defunción y Nacimiento (sub-BC ADT — TDR §8.7, §11.6)

| Item | Detalle |
|---|---|
| **Agregados raíz** | `BirthCertificate`, `DeathCertificate` |
| **VOs** | `CauseOfDeath` (básica/intermedia/directa CIE-10), `Apgar`, `BirthMetrics` |
| **Eventos** | `BirthRegistered`, `DeathCertified`, `RegistroCivilNotified` |
| **Integraciones** | Registro Civil SV (cuando exista API), MINSAL |
| **Complejidad** | **M** · **Fase 3** |

### 25.6 Portal del Paciente (extensión opcional — TDR §3.4)

| Item | Detalle |
|---|---|
| **Agregados raíz** | `PatientPortalUser`, `SharedDocument`, `AppointmentSelfService`, `AccessLogQuery` (ARCO) |
| **VOs** | `ConsentScope`, `ShareLink` (firmado, expira) |
| **Eventos** | `PatientLoggedIn`, `DocumentShared`, `AccessLogRequested`, `ConsentRevoked` |
| **Integraciones** | Resend (email), Twilio (SMS), Apple Health / Google Fit (cuando aplique) |
| **Complejidad** | **L** · **Fase 7** (post-go-live) |

---

## Resumen ejecutivo

| Fase TDR | Módulos cubiertos | Complejidad acumulada | Push-back / dependencia externa |
|----------|-------------------|------------------------|---------------------------------|
| **Fase 0** | Iniciación | — | Provisión Supabase, Vercel, Inngest, Sentry, Resend, Mirth (preparado) |
| **Fase 1 — MVP** | 1 (Multi-Entidad), 2 (Seguridad), 3 (Catálogos núcleo), 4 (ADT/MPI), 5 (Triage), 23 (Localización SV núcleo) | L+L+XL+L+M+M | Ninguna externa crítica |
| **Fase 2** | 6 (Ambulatorio), 8 (Emergencias), 10 (HCE básica), 25.4 (PAI) | L+L+L+M | Resend/Twilio, plataforma video |
| **Fase 3** | 7 (Hospitalización/UCI), 9 (Quirófanos), 25.3 (CEYE), 25.5 (Defunción/Nacimiento) | XL+XL+M+M | Mirth + monitores; Orthanc preparado |
| **Fase 4** | 11 (Farmacia), 12 (eMAR), 13 (LIS), 14 (RIS/PACS), 15 (Almacén), 17 (Resp), 18 (Nutrición), 24 (Plataforma Integración), 25.1 (BS), 25.2 (Patología) | XL×4 + varios | **Mirth + Orthanc + bombas DERS productivos** |
| **Fase 5** | 19 (Cuentas+DTE), 20 (Contabilidad multi-libro), 21 (Convenios), 16 (Equipos) | XL+XL+XL+L | **Servicio DTE + cert MH + ISSS API** |
| **Fase 6** | 22 (BI) + reportes regulatorios completos | L | Réplica + Metabase; @DA/@BID modelo dimensional |
| **Fase 7** | 25.6 (Portal paciente), estabilización, optimización | L | — |

**Total: 30 módulos** (24 numerados + 6 sub-BCs explícitos del TDR).
