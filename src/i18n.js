// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, statuses, scene texts and errors,
// results of the configuration buttons. Vocabulary of the Gladys interface
// (appareil / Gerät / dispositivo); German says "du", Spanish "usted", like
// Gladys. System names are never translated. The yield of a day is written
// kWh/kW (PVOutput), kWh/kWc in French, kWh/kWp in German and Spanish.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // features
  feature_power: {
    en: 'Solar production',
    fr: 'Production solaire',
    de: 'Solarerzeugung',
    es: 'Producción solar',
  },
  feature_energy_today: {
    en: 'Production today',
    fr: 'Production du jour',
    de: 'Erzeugung heute',
    es: 'Producción de hoy',
  },
  feature_lifetime_energy: {
    en: 'Lifetime production',
    fr: 'Production totale',
    de: 'Gesamterzeugung',
    es: 'Producción total',
  },
  feature_consumption_power: {
    en: 'Consumption',
    fr: 'Consommation',
    de: 'Verbrauch',
    es: 'Consumo',
  },
  feature_consumption_today: {
    en: 'Consumption today',
    fr: 'Consommation du jour',
    de: 'Verbrauch heute',
    es: 'Consumo de hoy',
  },
  feature_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  feature_voltage: { en: 'Voltage', fr: 'Tension', de: 'Spannung', es: 'Tensión' },

  // fields of the scene actions, in the errors
  field_power: {
    en: 'Power produced',
    fr: 'Puissance produite',
    de: 'Erzeugte Leistung',
    es: 'Potencia producida',
  },
  field_energy: {
    en: 'Energy produced',
    fr: 'Énergie produite',
    de: 'Erzeugte Energie',
    es: 'Energía producida',
  },
  field_consumption_power: {
    en: 'Power consumed',
    fr: 'Puissance consommée',
    de: 'Verbrauchte Leistung',
    es: 'Potencia consumida',
  },
  field_consumption_energy: {
    en: 'Energy consumed',
    fr: 'Énergie consommée',
    de: 'Verbrauchte Energie',
    es: 'Energía consumida',
  },
  field_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  field_voltage: { en: 'Voltage', fr: 'Tension', de: 'Spannung', es: 'Tensión' },
  field_generated: {
    en: 'Energy produced',
    fr: 'Énergie produite',
    de: 'Erzeugte Energie',
    es: 'Energía producida',
  },
  field_exported: {
    en: 'Energy exported',
    fr: 'Énergie injectée',
    de: 'Eingespeiste Energie',
    es: 'Energía exportada',
  },
  field_consumption: {
    en: 'Energy consumed',
    fr: 'Énergie consommée',
    de: 'Verbrauchte Energie',
    es: 'Energía consumida',
  },
  field_import_peak: {
    en: 'Import, peak hours',
    fr: 'Soutirage heures pleines',
    de: 'Bezug Hochtarif',
    es: 'Importación en punta',
  },
  field_import_off_peak: {
    en: 'Import, off-peak hours',
    fr: 'Soutirage heures creuses',
    de: 'Bezug Niedertarif',
    es: 'Importación en valle',
  },
  field_min_temperature: {
    en: 'Minimum temperature',
    fr: 'Température minimale',
    de: 'Tiefsttemperatur',
    es: 'Temperatura mínima',
  },
  field_max_temperature: {
    en: 'Maximum temperature',
    fr: 'Température maximale',
    de: 'Höchsttemperatur',
    es: 'Temperatura máxima',
  },

  // refusals of a scene action, before anything is sent
  errNotNumber: {
    en: '{field}: "{value}" is not a number.',
    fr: '{field} : « {value} » n’est pas un nombre.',
    de: '{field}: „{value}“ ist keine Zahl.',
    es: '{field}: «{value}» no es un número.',
  },
  errUnit: {
    en: '{field}: the unit of "{value}" is not the expected one.',
    fr: '{field} : l’unité de « {value} » n’est pas celle attendue.',
    de: '{field}: Die Einheit von „{value}“ ist nicht die erwartete.',
    es: '{field}: la unidad de «{value}» no es la esperada.',
  },
  errNegative: {
    en: '{field}: a negative value needs the "Net data" option.',
    fr: '{field} : une valeur négative demande l’option « Données nettes ».',
    de: '{field}: Ein negativer Wert braucht die Option „Nettodaten“.',
    es: '{field}: un valor negativo requiere la opción «Datos netos».',
  },
  errRange: {
    en: '{field}: the value must lie between {min} and {max}.',
    fr: '{field} : la valeur doit être comprise entre {min} et {max}.',
    de: '{field}: Der Wert muss zwischen {min} und {max} liegen.',
    es: '{field}: el valor debe estar entre {min} y {max}.',
  },
  errNetCumulative: {
    en: 'Net data and cumulative values cannot be sent together.',
    fr: 'Les données nettes et les valeurs cumulées ne peuvent pas être envoyées ensemble.',
    de: 'Nettodaten und kumulierte Werte können nicht zusammen gesendet werden.',
    es: 'Los datos netos y los valores acumulados no pueden enviarse juntos.',
  },
  errNetPower: {
    en: 'Net data needs the power produced (export) or the power consumed (import).',
    fr: 'Les données nettes demandent la puissance produite (injection) ou consommée (soutirage).',
    de: 'Nettodaten brauchen die erzeugte (Einspeisung) oder die verbrauchte Leistung (Bezug).',
    es: 'Los datos netos requieren la potencia producida (exportación) o la consumida (importación).',
  },
  errNoValue: {
    en: 'Nothing to send: give at least a power or an energy, produced or consumed.',
    fr: 'Rien à envoyer : indiquez au moins une puissance ou une énergie, produite ou consommée.',
    de: 'Nichts zu senden: Gib mindestens eine Leistung oder eine Energie an, erzeugt oder verbraucht.',
    es: 'Nada que enviar: indique al menos una potencia o una energía, producida o consumida.',
  },
  errNoOutputValue: {
    en: 'Nothing to send: give at least one value of the day.',
    fr: 'Rien à envoyer : indiquez au moins une valeur de la journée.',
    de: 'Nichts zu senden: Gib mindestens einen Wert des Tages an.',
    es: 'Nada que enviar: indique al menos un valor del día.',
  },
  errConsumptionEnergy: {
    en: 'The energy consumed is above what PVOutput accepts for a day: is it a lifetime value? Then choose it in "Cumulative values".',
    fr: 'L’énergie consommée dépasse ce que PVOutput accepte pour une journée : est-ce un index ? Choisissez-le alors dans « Valeurs cumulées ».',
    de: 'Die verbrauchte Energie liegt über dem, was PVOutput für einen Tag annimmt: Ist es ein Zählerstand? Dann wähle ihn bei „Kumulierte Werte“.',
    es: 'La energía consumida supera lo que PVOutput acepta para un día: ¿es un valor acumulado? Elíjalo entonces en «Valores acumulados».',
  },
  errConsumptionPower: {
    en: 'The power consumed is above 100,000 W, the limit of PVOutput.',
    fr: 'La puissance consommée dépasse 100 000 W, la limite de PVOutput.',
    de: 'Die verbrauchte Leistung liegt über 100.000 W, der Grenze von PVOutput.',
    es: 'La potencia consumida supera 100.000 W, el límite de PVOutput.',
  },
  errTemperatures: {
    en: 'Temperatures: give the minimum and the maximum, "min / max" (both or none).',
    fr: 'Températures : indiquez la minimale et la maximale, « min / max » (les deux ou aucune).',
    de: 'Temperaturen: Gib Tiefst- und Höchstwert an, „min / max“ (beide oder keine).',
    es: 'Temperaturas: indique la mínima y la máxima, «mín / máx» (ambas o ninguna).',
  },

  // refusals of PVOutput, by their message
  refusedWith: {
    en: 'PVOutput refused: {reason} ({detail})',
    fr: 'Refus de PVOutput : {reason} ({detail})',
    de: 'PVOutput lehnt ab: {reason} ({detail})',
    es: 'PVOutput rechaza: {reason} ({detail})',
  },
  refusedMoon: {
    en: 'a production at night ("Moon Powered"): check the timezone of the system on PVOutput',
    fr: 'une production en pleine nuit (« Moon Powered ») : vérifiez le fuseau horaire du système sur PVOutput',
    de: 'eine Erzeugung bei Nacht („Moon Powered“): Prüfe die Zeitzone des Systems auf PVOutput',
    es: 'una producción de noche («Moon Powered»): compruebe la zona horaria del sistema en PVOutput',
  },
  refusedReadOnly: {
    en: 'The key is a read only key: sending needs the standard key (Settings → API Access).',
    fr: 'La clé est une clé en lecture seule : l’envoi demande la clé standard (Settings → API Access).',
    de: 'Der Schlüssel ist nur zum Lesen: Zum Senden braucht es den Standardschlüssel (Settings → API Access).',
    es: 'La clave es de solo lectura: el envío requiere la clave estándar (Settings → API Access).',
  },
  refusedQuota: {
    en: 'The requests of the hour of the key are used up: PVOutput takes new ones at the next hour.',
    fr: 'Les requêtes de l’heure de la clé sont épuisées : PVOutput en accepte de nouvelles à l’heure suivante.',
    de: 'Die Anfragen dieser Stunde für den Schlüssel sind aufgebraucht: PVOutput nimmt ab der nächsten Stunde wieder welche an.',
    es: 'Las peticiones de la hora de la clave están agotadas: PVOutput acepta nuevas en la hora siguiente.',
  },
  refusedQuotaUntil: {
    en: 'The requests of the hour of the PVOutput key are used up: try again after {time}.',
    fr: 'Les requêtes de l’heure de la clé PVOutput sont épuisées : réessayez après {time}.',
    de: 'Die Anfragen dieser Stunde für den PVOutput-Schlüssel sind aufgebraucht: Versuche es nach {time} erneut.',
    es: 'Las peticiones de la hora de la clave de PVOutput están agotadas: vuelva a intentarlo después de las {time}.',
  },
  refusedDonation: {
    en: 'This request needs the donation mode of PVOutput.',
    fr: 'Cette requête demande le mode donation de PVOutput.',
    de: 'Diese Anfrage braucht den Spendenmodus von PVOutput.',
    es: 'Esta petición requiere el modo donación de PVOutput.',
  },
  refusedPowerHigh: {
    en: 'a power more than 50 % above the size of the system',
    fr: 'une puissance supérieure de plus de 50 % à la puissance du système',
    de: 'eine Leistung über 50 % oberhalb der Systemgröße',
    es: 'una potencia más de un 50 % superior al tamaño del sistema',
  },
  refusedEnergyHigh: {
    en: 'an energy too high for the size of the system or the time of day (is it in Wh rather than kWh?)',
    fr: 'une énergie trop élevée pour la puissance du système ou l’heure (est-elle en Wh plutôt qu’en kWh ?)',
    de: 'eine Energie zu hoch für die Systemgröße oder die Uhrzeit (ist sie in Wh statt kWh?)',
    es: 'una energía demasiado alta para el tamaño del sistema o la hora (¿está en Wh en lugar de kWh?)',
  },
  refusedExportHigh: {
    en: 'an export too high for the system or above the production',
    fr: 'une injection trop élevée pour le système ou supérieure à la production',
    de: 'eine Einspeisung zu hoch für das System oder über der Erzeugung',
    es: 'una exportación demasiado alta para el sistema o superior a la producción',
  },
  refusedTooOld: {
    en: 'a date too old (14 days at most for a status)',
    fr: 'une date trop ancienne (14 jours au plus pour un statut)',
    de: 'ein zu altes Datum (höchstens 14 Tage für einen Status)',
    es: 'una fecha demasiado antigua (14 días como máximo para un estado)',
  },
  refusedFuture: {
    en: 'a date in the future: check the timezone of the system',
    fr: 'une date dans le futur : vérifiez le fuseau horaire du système',
    de: 'ein Datum in der Zukunft: Prüfe die Zeitzone des Systems',
    es: 'una fecha en el futuro: compruebe la zona horaria del sistema',
  },
  refusedLower: {
    en: 'an energy lower than the one sent before (a counter that went back?)',
    fr: 'une énergie inférieure à celle envoyée avant (un compteur revenu en arrière ?)',
    de: 'eine Energie unter der zuvor gesendeten (ein zurückgesetzter Zähler?)',
    es: 'una energía inferior a la enviada antes (¿un contador que retrocedió?)',
  },
  refusedKey: {
    en: 'the API key or the System Id',
    fr: 'la clé d’API ou le System Id',
    de: 'der API-Schlüssel oder die System-ID',
    es: 'la clave de API o el System Id',
  },
  refusedSystem: {
    en: 'the System Id',
    fr: 'le System Id',
    de: 'die System-ID',
    es: 'el System Id',
  },
  refusedOther: {
    en: 'the values sent',
    fr: 'les valeurs envoyées',
    de: 'die gesendeten Werte',
    es: 'los valores enviados',
  },

  // results of the scene actions
  sentStatus: {
    en: '{name}: status of {time} sent to PVOutput ({answer}).',
    fr: '{name} : statut de {time} envoyé à PVOutput ({answer}).',
    de: '{name}: Status von {time} an PVOutput gesendet ({answer}).',
    es: '{name}: estado de las {time} enviado a PVOutput ({answer}).',
  },
  sentOutput: {
    en: '{name}: output of {date} sent to PVOutput ({answer}).',
    fr: '{name} : production du {date} envoyée à PVOutput ({answer}).',
    de: '{name}: Tagesertrag vom {date} an PVOutput gesendet ({answer}).',
    es: '{name}: producción del {date} enviada a PVOutput ({answer}).',
  },

  // summaries (scenes)
  summaryProduced: {
    en: '{name}: {value} kWh produced today',
    fr: '{name} : {value} kWh produits aujourd’hui',
    de: '{name}: {value} kWh heute erzeugt',
    es: '{name}: {value} kWh producidos hoy',
  },
  summaryYield: {
    en: '{value} kWh/kW',
    fr: '{value} kWh/kWc',
    de: '{value} kWh/kWp',
    es: '{value} kWh/kWp',
  },
  summaryPeakAt: {
    en: 'peak {value} W at {time}',
    fr: 'pic de {value} W à {time}',
    de: 'Spitze {value} W um {time}',
    es: 'pico de {value} W a las {time}',
  },
  summaryPeak: {
    en: 'peak {value} W',
    fr: 'pic de {value} W',
    de: 'Spitze {value} W',
    es: 'pico de {value} W',
  },
  summaryExported: {
    en: '{value} kWh exported',
    fr: '{value} kWh injectés',
    de: '{value} kWh eingespeist',
    es: '{value} kWh exportados',
  },
  summaryConsumed: {
    en: '{value} kWh consumed',
    fr: '{value} kWh consommés',
    de: '{value} kWh verbraucht',
    es: '{value} kWh consumidos',
  },

  // connection status
  statusNoKey: {
    en: 'Enter the API key of your PVOutput account (Settings → API Access).',
    fr: 'Saisissez la clé d’API de votre compte PVOutput (Settings → API Access).',
    de: 'Gib den API-Schlüssel deines PVOutput-Kontos ein (Settings → API Access).',
    es: 'Introduzca la clave de API de su cuenta PVOutput (Settings → API Access).',
  },
  statusNoSystem: {
    en: 'Enter the System Id of at least one system (Settings → Registered Systems).',
    fr: 'Saisissez le System Id d’au moins un système (Settings → Registered Systems).',
    de: 'Gib die System-ID mindestens eines Systems ein (Settings → Registered Systems).',
    es: 'Introduzca el System Id de al menos un sistema (Settings → Registered Systems).',
  },
  statusInvalidIds: {
    en: 'Not a System Id: {ids}. A System Id is a number (Settings → Registered Systems).',
    fr: 'Ce n’est pas un System Id : {ids}. Un System Id est un nombre (Settings → Registered Systems).',
    de: 'Keine System-ID: {ids}. Eine System-ID ist eine Zahl (Settings → Registered Systems).',
    es: 'No es un System Id: {ids}. Un System Id es un número (Settings → Registered Systems).',
  },
  statusWaiting: {
    en: 'Waiting for the first reading of PVOutput.',
    fr: 'En attente de la première lecture de PVOutput.',
    de: 'Warte auf die erste Abfrage von PVOutput.',
    es: 'Esperando la primera lectura de PVOutput.',
  },
  systemLine: {
    en: '{name} {value}',
    fr: '{name} {value}',
    de: '{name} {value}',
    es: '{name} {value}',
  },
  statusOk: {
    en: '{count} system(s): {systems}.',
    fr: '{count} système(s) : {systems}.',
    de: '{count} System(e): {systems}.',
    es: '{count} sistema(s): {systems}.',
  },
  statusSomeFailing: {
    en: 'Unknown System Id: {systems}.',
    fr: 'System Id inconnu : {systems}.',
    de: 'Unbekannte System-ID: {systems}.',
    es: 'System Id desconocido: {systems}.',
  },
  statusPaused: {
    en: 'Readings paused until {time} (quota of the key).',
    fr: 'Lectures en pause jusqu’à {time} (quota de la clé).',
    de: 'Abfragen pausiert bis {time} (Kontingent des Schlüssels).',
    es: 'Lecturas en pausa hasta las {time} (cuota de la clave).',
  },
  statusTooMany: {
    en: 'Five systems at most: the others are ignored.',
    fr: 'Cinq systèmes au plus : les autres sont ignorés.',
    de: 'Höchstens fünf Systeme: Die anderen werden ignoriert.',
    es: 'Cinco sistemas como máximo: los demás se ignoran.',
  },
  errKey: {
    en: 'PVOutput refuses the API key ({detail}): check it in Settings → API Access (API Access "Enabled").',
    fr: 'PVOutput refuse la clé d’API ({detail}) : vérifiez-la dans Settings → API Access (API Access « Enabled »).',
    de: 'PVOutput lehnt den API-Schlüssel ab ({detail}): Prüfe ihn unter Settings → API Access (API Access „Enabled“).',
    es: 'PVOutput rechaza la clave de API ({detail}): compruébela en Settings → API Access (API Access «Enabled»).',
  },
  errSystem: {
    en: 'PVOutput does not know the System Id {system} for this key (Settings → Registered Systems).',
    fr: 'PVOutput ne connaît pas le System Id {system} pour cette clé (Settings → Registered Systems).',
    de: 'PVOutput kennt die System-ID {system} für diesen Schlüssel nicht (Settings → Registered Systems).',
    es: 'PVOutput no conoce el System Id {system} para esta clave (Settings → Registered Systems).',
  },
  errUnreachable: {
    en: 'PVOutput cannot be reached ({detail}).',
    fr: 'PVOutput est injoignable ({detail}).',
    de: 'PVOutput ist nicht erreichbar ({detail}).',
    es: 'No se puede contactar con PVOutput ({detail}).',
  },
  errNoStatus: {
    en: 'The system published no status in the last 7 days.',
    fr: 'Le système n’a publié aucun statut ces 7 derniers jours.',
    de: 'Das System hat in den letzten 7 Tagen keinen Status veröffentlicht.',
    es: 'El sistema no ha publicado ningún estado en los últimos 7 días.',
  },
  errFailed: {
    en: 'PVOutput error: {detail}',
    fr: 'Erreur de PVOutput : {detail}',
    de: 'PVOutput-Fehler: {detail}',
    es: 'Error de PVOutput: {detail}',
  },

  // configuration buttons
  testLine: {
    en: '{name} ({id}): {size} kW, a status every {interval} min, {zone}',
    fr: '{name} ({id}) : {size} kWc, un statut toutes les {interval} min, {zone}',
    de: '{name} ({id}): {size} kWp, ein Status alle {interval} Min., {zone}',
    es: '{name} ({id}): {size} kWp, un estado cada {interval} min, {zone}',
  },
  testQuota: {
    en: 'requests left this hour: {remaining} of {limit}',
    fr: 'requêtes restantes cette heure : {remaining} sur {limit}',
    de: 'verbleibende Anfragen in dieser Stunde: {remaining} von {limit}',
    es: 'peticiones restantes esta hora: {remaining} de {limit}',
  },
  diagnosticDone: {
    en: 'State written to the logs of the integration ({count} line(s) "PVOutput diagnostic"), without the key.',
    fr: 'État écrit dans les journaux de l’intégration ({count} ligne(s) « PVOutput diagnostic »), sans la clé.',
    de: 'Zustand in die Logs der Integration geschrieben ({count} Zeile(n) „PVOutput diagnostic“), ohne den Schlüssel.',
    es: 'Estado escrito en los registros de la integración ({count} línea(s) «PVOutput diagnostic»), sin la clave.',
  },

  // widgets
  sizeKw: { en: '{value} kW', fr: '{value} kWc', de: '{value} kWp', es: '{value} kWp' },
  widgetWaiting: {
    en: 'Waiting for the first reading of this system on PVOutput.',
    fr: 'En attente de la première lecture de ce système sur PVOutput.',
    de: 'Warte auf die erste Abfrage dieses Systems auf PVOutput.',
    es: 'Esperando la primera lectura de este sistema en PVOutput.',
  },
  widgetCurveLoading: {
    en: 'The curve of the day comes with the next reading (a few minutes).',
    fr: 'La courbe du jour arrive avec la prochaine lecture (quelques minutes).',
    de: 'Die Tageskurve kommt mit der nächsten Abfrage (einige Minuten).',
    es: 'La curva del día llega con la próxima lectura (unos minutos).',
  },
  widgetCurveSoon: {
    en: 'Not enough statuses today for a curve yet.',
    fr: 'Pas encore assez de statuts aujourd’hui pour une courbe.',
    de: 'Heute noch nicht genug Status für eine Kurve.',
    es: 'Aún no hay suficientes estados hoy para una curva.',
  },
  widgetNoOutputs: {
    en: 'No daily output on PVOutput over the last 30 days.',
    fr: 'Aucune production journalière sur PVOutput ces 30 derniers jours.',
    de: 'Kein Tagesertrag auf PVOutput in den letzten 30 Tagen.',
    es: 'Ninguna producción diaria en PVOutput en los últimos 30 días.',
  },
  tilePower: { en: 'Power now', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  tileToday: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tileConsumed: { en: 'Consumed', fr: 'Consommé', de: 'Verbraucht', es: 'Consumido' },
  tileExported: { en: 'Exported', fr: 'Injecté', de: 'Eingespeist', es: 'Exportado' },
  tileYield: { en: 'Yield', fr: 'Rendement', de: 'Ertrag', es: 'Rendimiento' },
  tileMonth: { en: 'This month', fr: 'Ce mois-ci', de: 'Diesen Monat', es: 'Este mes' },
  tileBest: { en: 'Best day', fr: 'Meilleur jour', de: 'Bester Tag', es: 'Mejor día' },
  tileAverage: { en: 'Daily average', fr: 'Moyenne/jour', de: 'Mittel/Tag', es: 'Media diaria' },
  tileRecord: { en: 'Record yield', fr: 'Record', de: 'Rekord', es: 'Récord' },
  rowBestDay: {
    en: 'Best day',
    fr: 'Meilleur jour',
    de: 'Bester Tag',
    es: 'Mejor día',
  },
  rowBestDayValue: {
    en: '{date}, {value} kWh',
    fr: '{date}, {value} kWh',
    de: '{date}, {value} kWh',
    es: '{date}, {value} kWh',
  },
  rowRecord: {
    en: 'Record yield on',
    fr: 'Record de rendement le',
    de: 'Rekordertrag am',
    es: 'Récord de rendimiento el',
  },
  tileLifetime: { en: 'Lifetime', fr: 'Depuis le début', de: 'Insgesamt', es: 'Total' },
  seriesProduction: { en: 'Production', fr: 'Production', de: 'Erzeugung', es: 'Producción' },
  seriesConsumption: { en: 'Consumption', fr: 'Consommation', de: 'Verbrauch', es: 'Consumo' },
  chartToday: {
    en: 'Power today',
    fr: 'Puissance du jour',
    de: 'Leistung heute',
    es: 'Potencia de hoy',
  },
  chartDays: {
    en: 'Production, last 30 days',
    fr: 'Production, 30 derniers jours',
    de: 'Erzeugung, letzte 30 Tage',
    es: 'Producción, últimos 30 días',
  },
  annotationPeak: {
    en: 'Peak {value} W',
    fr: 'Pic {value} W',
    de: 'Spitze {value} W',
    es: 'Pico {value} W',
  },
  rowLastStatus: {
    en: 'Last status',
    fr: 'Dernier statut',
    de: 'Letzter Status',
    es: 'Último estado',
  },
  rowNoStatus: {
    en: 'None in 7 days',
    fr: 'Aucun en 7 jours',
    de: 'Keiner in 7 Tagen',
    es: 'Ninguno en 7 días',
  },
  rowSilent: {
    en: 'Silent since {time}',
    fr: 'Silencieux depuis {time}',
    de: 'Still seit {time}',
    es: 'En silencio desde las {time}',
  },
  rowNight: {
    en: 'Night (last {time})',
    fr: 'Nuit (dernier à {time})',
    de: 'Nacht (zuletzt {time})',
    es: 'Noche (último a las {time})',
  },
  rowNightUntil: {
    en: 'Night, sunrise {time}',
    fr: 'Nuit, lever à {time}',
    de: 'Nacht, Aufgang {time}',
    es: 'Noche, amanecer {time}',
  },
  rowAgo: {
    en: '{time} ({ago})',
    fr: '{time} ({ago})',
    de: '{time} ({ago})',
    es: '{time} ({ago})',
  },
  rowQuota: {
    en: 'PVOutput requests',
    fr: 'Requêtes PVOutput',
    de: 'PVOutput-Anfragen',
    es: 'Peticiones PVOutput',
  },
  rowQuotaLeft: {
    en: '{remaining} of {limit} left',
    fr: '{remaining} sur {limit} restantes',
    de: '{remaining} von {limit} übrig',
    es: 'quedan {remaining} de {limit}',
  },
  rowQuotaPaused: {
    en: 'Paused until {time}',
    fr: 'En pause jusqu’à {time}',
    de: 'Pausiert bis {time}',
    es: 'En pausa hasta las {time}',
  },

  // times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },
};

/**
 * @description Whether a value is a language of the integration.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago", "3 h ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('hoursAgo', language, { n: hours });
  }
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

/**
 * @description A number in the format of a language.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [decimals] - The decimals at most.
 * @returns {string} "12,5" in French.
 */
function formatNumber(value, language, decimals = 1) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: decimals,
  }).format(value);
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago, formatNumber };
