import type { LegalSection } from "@/components/public/legal-document";

const todo = (text: string) => <strong>[TODO: {text}]</strong>;

export const germanLegalNotice: LegalSection[] = [
  {
    title: "Angaben gemäß § 5 DDG",
    content: (
      <>
        <p>{todo("Vollständiger bürgerlicher Name des Einzelunternehmers")}</p>
        <p>Munir Visuals</p>
        <p>
          {todo("ladungsfähige Geschäftsanschrift: Straße, Hausnummer, PLZ, Ort, Land")}
        </p>
      </>
    ),
  },
  {
    title: "Kontakt",
    content: (
      <p>
        E-Mail: {todo("geschäftliche Kontakt-E-Mail")}<br />
        Telefon: {todo("Telefonnummer, sofern für eine schnelle Kontaktaufnahme erforderlich")}
      </p>
    ),
  },
  {
    title: "Register- und Steuerangaben",
    content: (
      <>
        <p>{todo("Register, Registergericht und Registernummer einfügen, falls vorhanden; andernfalls diesen Punkt entfernen")}</p>
        <p>{todo("Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG einfügen, falls vorhanden; keine persönliche Steuernummer veröffentlichen")}</p>
        <p>{todo("zuständige Aufsichtsbehörde und berufsrechtliche Angaben nur einfügen, falls die Tätigkeit dies erfordert")}</p>
      </>
    ),
  },
  {
    title: "Redaktionell verantwortlich",
    content: <p>{todo("Name und Anschrift nach § 18 Abs. 2 MStV prüfen und einfügen, falls anwendbar")}</p>,
  },
  {
    title: "Verbraucherstreitbeilegung",
    content: <p>{todo("Teilnahmebereitschaft oder -verpflichtung nach VSBG rechtlich prüfen und die zutreffende Erklärung einfügen")}</p>,
  },
];

export const englishLegalNotice: LegalSection[] = [
  {
    title: "Information under section 5 DDG",
    content: (
      <>
        <p>{todo("full legal name of the sole proprietor")}</p>
        <p>Munir Visuals</p>
        <p>{todo("serviceable business address: street, number, postcode, city, country")}</p>
      </>
    ),
  },
  {
    title: "Contact",
    content: (
      <p>
        Email: {todo("business contact email")}<br />
        Telephone: {todo("telephone number if required for rapid contact")}
      </p>
    ),
  },
  {
    title: "Registration and tax information",
    content: (
      <>
        <p>{todo("insert register, registry court and registration number if applicable; otherwise remove this item")}</p>
        <p>{todo("insert VAT identification number under section 27a UStG if applicable; do not publish a personal tax number")}</p>
        <p>{todo("insert competent supervisory authority and professional rules only if the activity requires them")}</p>
      </>
    ),
  },
  {
    title: "Editorial responsibility",
    content: <p>{todo("check applicability of section 18(2) MStV and insert name and address if required")}</p>,
  },
  {
    title: "Consumer dispute resolution",
    content: <p>{todo("obtain legal review of participation or obligation under the VSBG and insert the applicable statement")}</p>,
  },
];

export const germanPrivacy: LegalSection[] = [
  {
    title: "1. Verantwortlicher",
    content: (
      <p>
        {todo("vollständiger bürgerlicher Name")}, handelnd als Munir Visuals<br />
        {todo("ladungsfähige Anschrift")}<br />
        E-Mail: {todo("Datenschutz-Kontaktadresse")}<br />
        Telefon: {todo("Telefonnummer, falls vorgesehen")}
      </p>
    ),
  },
  {
    title: "2. Hosting und Serverprotokolle",
    content: (
      <>
        <p>Die Anwendung ist für eine Bereitstellung über Netlify konfiguriert. Beim Abruf können technisch erforderliche Verbindungs- und Protokolldaten durch den Hosting-Anbieter verarbeitet werden.</p>
        <p>{todo("tatsächlichen Hosting-Anbieter, Vertrags-/AVV-Status, verarbeitete Protokolldaten, Verarbeitungsregionen, Empfänger, Rechtsgrundlage, Speicherdauer und etwaige Drittlandgarantien bestätigen")}</p>
      </>
    ),
  },
  {
    title: "3. Medieninhalte",
    content: (
      <>
        <p>Öffentliche Bilder können, sofern konfiguriert, von einem Cloudflare-R2-Auslieferungsursprung geladen werden. YouTube- und Vimeo-Inhalte werden erst nach einer aktiven Auswahl geladen.</p>
        <p>{todo("R2-/CDN-Konto, Anbietervereinbarungen, Regionen, Rechtsgrundlage, Speicherdauer und Drittlandgarantien bestätigen")}</p>
      </>
    ),
  },
  {
    title: "4. Kontakt- und Projektanfragen",
    content: (
      <>
        <p>Das Formular verarbeitet Name, E-Mail-Adresse, optionale Telefon-, WhatsApp-, Unternehmens-, Datums-, Orts-, Budget- und Empfehlungsangaben sowie Projekttyp, gewählte Leistung und Nachricht. Die Angaben werden in einer PostgreSQL-Datenbank bei Neon gespeichert und zur Bearbeitung der Anfrage im internen CRM angezeigt.</p>
        <p>Bei konfiguriertem E-Mail-Versand erhält der Betreiber über Resend eine Benachrichtigung. Die anfragende Person erhält nur eine allgemeine Eingangsbestätigung; ihre Formulardaten werden darin nicht wiederholt.</p>
        <p>{todo("Zwecke, konkrete Rechtsgrundlage(n), Neon- und Resend-Vertrags-/AVV-Status, Verarbeitungsregionen, Empfänger, Drittlandtransfers und Garantien sowie Aufbewahrungs- und Löschfristen bestätigen")}</p>
      </>
    ),
  },
  {
    title: "5. Missbrauchsschutz mit Cloudflare Turnstile",
    content: (
      <>
        <p>Ist Turnstile konfiguriert, wird das Cloudflare-Skript erst nach der Hydrierung auf der Kontaktseite geladen. Das Prüfungstoken und gegebenenfalls die von Netlify bereitgestellte Client-IP werden serverseitig an Cloudflare übermittelt. Token und rohe Prüfantworten werden nicht gespeichert oder protokolliert. Ratenbegrenzungsschlüssel werden mit einem serverseitigen Geheimnis pseudonymisiert.</p>
        <p>Turnstile wird derzeit ohne vorgeschaltete Einwilligungsabfrage geladen. {todo("Rechtsgrundlage, Erforderlichkeit, Cloudflare-Vertrags-/AVV-Status, Verarbeitungsregionen, Drittlandtransfer und Garantien rechtlich prüfen")}</p>
      </>
    ),
  },
  {
    title: "6. Reichweitenmessung mit Umami",
    content: (
      <>
        <p>Umami ist optional. Ohne Website-ID wird kein Analyseskript geladen und keine Anfrage gesendet. Bei Konfiguration lädt die öffentliche Website das Skript nach der Interaktion; der Adminbereich wird nicht gemessen. Der Anwendungscode setzt dafür keine Cookies oder Browser-Speicher.</p>
        <p>Umami wird derzeit ohne vorgeschaltete Einwilligungsabfrage geladen. {todo("bestätigen, ob Umami Cloud oder eine eigene Instanz eingesetzt wird; tatsächliche Datenerhebung, Hostingort, Aufbewahrung, Empfänger, Rechtsgrundlage und etwaige Einwilligungspflicht rechtlich prüfen")}</p>
      </>
    ),
  },
  {
    title: "7. Fehlerüberwachung",
    content: (
      <>
        <p>Sentry ist optional, nur in Produktion aktiv und wird ohne konfigurierte DSN nicht initialisiert. Tracing, Sitzungsaufzeichnung und Profiling sind deaktiviert; Benutzerangaben, IP-Adressen, Cookies, Header, Anfrageinhalte und URL-Parameter werden nicht zur Übermittlung vorgesehen. Zusätzlich werden ausgehende Ereignisse gefiltert. Eine vollständige Entfernung aller möglichen Freitextangaben kann durch Musterfilter jedoch nicht garantiert werden.</p>
        <p>{todo("Sentry-Einsatz, Rechtsgrundlage, Projektregion, AVV, Aufbewahrung und etwaige Drittlandgarantien bestätigen")}</p>
      </>
    ),
  },
  {
    title: "8. Speicherdauer und Löschung",
    content: (
      <>
        <p>Die Anwendung enthält keine allgemeine automatische Löschfrist. Berechtigte Administratoren können Kundendaten lokal exportieren oder anonymisieren. Die Anonymisierung entfernt Kontaktdaten, Nachrichten, Notizen, Orts-, Empfehlungs- und Projekttyp-Freitext, behält aber nicht identifizierende Betriebsdaten. Bereits an E-Mail- oder andere Anbieter übermittelte Daten werden dadurch nicht automatisch gelöscht.</p>
        <p>{todo("verbindliche Aufbewahrungs- und Löschfristen je Datenkategorie sowie den Prozess für Löschung bei Auftragsverarbeitern festlegen")}</p>
      </>
    ),
  },
  {
    title: "9. Rechte betroffener Personen",
    content: (
      <>
        <p>Nach Maßgabe der DSGVO können insbesondere Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch bestehen. Eine erteilte Einwilligung kann mit Wirkung für die Zukunft widerrufen werden. Zudem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.</p>
        <p>{todo("zuständige deutsche Datenschutzaufsichtsbehörde und deren Kontaktdaten bestätigen")}</p>
      </>
    ),
  },
  {
    title: "10. Pflicht zur Bereitstellung und automatisierte Entscheidungen",
    content: <p>Als Pflichtfelder sind Name, E-Mail-Adresse, Projekttyp und Nachricht vorgesehen. Ohne diese Angaben kann das Formular nicht abgesendet werden. Eine automatisierte Entscheidungsfindung einschließlich Profiling ist im Anwendungscode nicht vorgesehen. {todo("betriebliche Praxis bestätigen")}</p>,
  },
  {
    title: "11. Stand und Änderungen",
    content: <p>Entwurfsstand: 23. Oktober 2026. {todo("Datum der rechtlich freigegebenen Fassung eintragen und Änderungsprozess festlegen")}</p>,
  },
];

export const englishPrivacy: LegalSection[] = [
  {
    title: "1. Controller",
    content: <p>{todo("full legal name")}, trading as Munir Visuals<br />{todo("serviceable address")}<br />Email: {todo("privacy contact address")}<br />Telephone: {todo("telephone number, if provided")}</p>,
  },
  {
    title: "2. Hosting and server logs",
    content: <><p>The application is configured for deployment through Netlify. Technically necessary connection and log data may be processed by the hosting provider when the site is requested.</p><p>{todo("confirm the actual host, processor agreement status, log data, processing regions, recipients, legal basis, retention and any international-transfer safeguards")}</p></>,
  },
  {
    title: "3. Media content",
    content: <><p>Public images may be loaded from a Cloudflare R2 delivery origin when configured. YouTube and Vimeo content loads only after the visitor actively selects it.</p><p>{todo("confirm the R2/CDN account, provider agreements, regions, legal basis, retention and international-transfer safeguards")}</p></>,
  },
  {
    title: "4. Contact and project inquiries",
    content: <><p>The form processes name, email address, optional telephone, WhatsApp, company, date, location, budget and referral details, as well as project type, selected service and message. The data is stored in a PostgreSQL database at Neon and displayed in the internal CRM to handle the inquiry.</p><p>When email delivery is configured, the operator receives a notification through Resend. The person making the inquiry receives only a generic receipt confirmation; their form data is not repeated in it.</p><p>{todo("confirm purposes, specific legal basis or bases, Neon and Resend processor-agreement status, processing regions, recipients, international transfers and safeguards, and retention/deletion periods")}</p></>,
  },
  {
    title: "5. Abuse protection with Cloudflare Turnstile",
    content: <><p>When Turnstile is configured, the Cloudflare script loads on the contact page after hydration. The verification token and, where available from Netlify, the client IP are sent to Cloudflare server-side. Tokens and raw verification responses are not stored or logged. Rate-limit keys are pseudonymised with a server-side secret.</p><p>Turnstile currently loads without a prior consent prompt. {todo("legally assess the legal basis, necessity, Cloudflare processor-agreement status, processing regions, international transfer and safeguards")}</p></>,
  },
  {
    title: "6. Audience measurement with Umami",
    content: <><p>Umami is optional. Without a website ID, no analytics script is loaded and no request is sent. When configured, the public site loads the script after interaction; the admin area is not measured. The application code sets no analytics cookie or browser storage.</p><p>Umami currently loads without a prior consent prompt. {todo("confirm whether Umami Cloud or a self-hosted instance is used and legally assess the actual data collected, hosting location, retention, recipients, legal basis and any consent requirement")}</p></>,
  },
  {
    title: "7. Error monitoring",
    content: <><p>Sentry is optional, production-only and is not initialised without a configured DSN. Tracing, session replay and profiling are disabled; user details, IP addresses, cookies, headers, request bodies and URL parameters are configured not to be sent. Outgoing events are additionally filtered, although pattern filtering cannot guarantee removal of every possible piece of free text.</p><p>{todo("confirm Sentry use, legal basis, project region, processor agreement, retention and any international-transfer safeguards")}</p></>,
  },
  {
    title: "8. Retention and deletion",
    content: <><p>The application has no universal automatic deletion period. Authorised administrators can export or locally anonymise customer data. Anonymisation removes contact details, messages, notes, location, referral and project-type free text while retaining non-identifying operational records. It does not automatically erase data already sent to email or other providers.</p><p>{todo("set binding retention and deletion periods for each data category and a process for deletion at processors")}</p></>,
  },
  {
    title: "9. Data subject rights",
    content: <><p>Subject to the GDPR, individuals may in particular have rights of access, rectification, erasure, restriction, portability and objection. Consent may be withdrawn for the future. Individuals may also complain to a data protection supervisory authority.</p><p>{todo("confirm the competent German data protection supervisory authority and its contact details")}</p></>,
  },
  {
    title: "10. Required information and automated decisions",
    content: <p>Name, email address, project type and message are required form fields. The form cannot be submitted without them. The application code performs no automated decision-making, including profiling. {todo("confirm operational practice")}</p>,
  },
  {
    title: "11. Version and changes",
    content: <p>Draft dated 23 October 2026. {todo("insert the date of the legally approved version and define the update process")}</p>,
  },
];
