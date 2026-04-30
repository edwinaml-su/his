# language: es
# Épica: E3 — Catálogos Maestros
# Historias cubiertas: US-3.7 (multi-idioma), US-7.6 (i18n base)
# TDR: §7
# Persona principal: P7 — Administrador clínico
# Valor de negocio: Catálogos multilingües (es, en mínimo) que permitan crecimiento regional.

@regression @catalog @i18n @es-SV
Característica: Internacionalización de catálogos
  Como administrador clínico (P7)
  Quiero mantener nombres de catálogos en múltiples idiomas
  Para soportar usuarios y reportes en distintos idiomas.

  Antecedentes:
    Dado que el sistema soporta los idiomas "es" (default es-SV) y "en"
    Y inicio sesión con rol "admin_clinico"

  @smoke
  Escenario: Captura obligatoria del nombre en es-SV; opcional en en
    Cuando creo una especialidad con nombre_es "Neumología" sin nombre_en
    Entonces el sistema acepta el guardado
    Y al cambiar idioma a "en" muestra el nombre_es entre paréntesis con marca "(es)"

  @validation
  Escenario: Bloqueo si nombre_es está vacío
    Cuando intento guardar especialidad con nombre_es vacío
    Entonces el sistema rechaza con "El nombre en español es obligatorio"

  @ui-switch
  Escenario: Cambio de idioma actualiza inmediatamente la interfaz
    Dado el usuario tiene preferencia "es"
    Cuando cambia a "en"
    Entonces los nombres de catálogo se muestran en "en" donde existan
    Y los textos de UI se traducen vía i18next con namespace por módulo
    Y la preferencia se persiste en su perfil

  @fallback
  Escenario: Fallback a es-SV cuando no existe traducción
    Dado existe especialidad con nombre_es "Geriatría" y sin nombre_en
    Cuando consulto en "en"
    Entonces se muestra "Geriatría (es)"
    Y NO se rompe la interfaz por ausencia de traducción
