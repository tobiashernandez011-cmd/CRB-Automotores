"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

const initialQuote = {
  customer: "",
  vehicle: "",
  plate: "",
  year: "",
  phone: "",
  date: "",
  repair: "",
  replace: "",
  parts: "",
  labor: "",
};

const PDF_LAYOUT = {
  pageHeight: 1123,
  pageWidth: 794,
  logo: { x: 521, y: 40, width: 220, height: 112 },
};

const QUOTE_PAGE_SIZE = 25;

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$ 0,00";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function splitLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function localDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function quoteFileName(quote) {
  const customer = quote.customer
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const plate = quote.plate.replace(/[^a-zA-Z0-9]+/g, "");
  return `Presupuesto-CRB${customer ? `-${customer}` : ""}${plate ? `-${plate}` : ""}.pdf`;
}

function quoteFromRecord(record) {
  return {
    customer: record.customer ?? "",
    vehicle: record.vehicle ?? "",
    plate: record.plate ?? "",
    year: record.year ?? "",
    phone: record.phone ?? "",
    date: record.quote_date ?? "",
    repair: record.repair ?? "",
    replace: record.replace ?? "",
    parts: String(record.parts ?? ""),
    labor: String(record.labor ?? ""),
  };
}

async function svgToPng(svgElement) {
  const svg = svgElement.cloneNode(true);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "960");
  svg.setAttribute("height", "480");
  const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new window.Image();
    image.src = svgUrl;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar el logo para el PDF.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function CrbLogo({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 160"
      role="img"
      aria-label="C.R.B. Automotores"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse
        cx="160"
        cy="80"
        rx="149"
        ry="65"
        transform="rotate(-12 160 80)"
        fill="#176195"
        stroke="#f1d947"
        strokeWidth="4"
      />
      <ellipse
        cx="183"
        cy="78"
        rx="83"
        ry="37"
        transform="rotate(-12 183 78)"
        fill="#f4f3e9"
      />
      <text
        x="185"
        y="99"
        fill="#f1d947"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="62"
        fontStyle="italic"
        fontWeight="900"
        letterSpacing="-4"
        textAnchor="middle"
      >
        C.R.B.
      </text>
      <text
        x="31"
        y="117"
        fill="#f1d947"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="18"
        fontWeight="700"
        letterSpacing="0.3"
      >
        AUTOMOTORES
      </text>
    </svg>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

function ListField({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <small>Una línea por cada ítem.</small>
    </label>
  );
}

export default function Home() {
  const supabase = createSupabaseClient();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfMessage, setPdfMessage] = useState("");
  const [whatsAppError, setWhatsAppError] = useState("");
  const [screen, setScreen] = useState("new");
  const [mobileShowPaper, setMobileShowPaper] = useState(false);
  const [savedQuotes, setSavedQuotes] = useState([]);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [previewScale, setPreviewScale] = useState(1);
  const [quote, setQuote] = useState(initialQuote);
  const paperRef = useRef(null);
  const previewAreaRef = useRef(null);

  useEffect(() => {
    // Set the local date after hydration to avoid a server/client date mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuote((current) => ({
      ...current,
      date: localDateInputValue(),
    }));
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (active) {
        setSession(currentSession);
        setAuthReady(true);
      }
    });

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAuthError(error.message);
        setSession(data.session);
        setAuthReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setAuthError(error instanceof Error ? error.message : "No se pudo verificar la sesión.");
        setAuthReady(true);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session || screen !== "history" || !supabase) return undefined;

    let active = true;
    const loadQuotes = async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        let query = supabase
          .from("quotes")
          .select("id, customer, vehicle, plate, year, phone, quote_date, repair, replace, parts, labor, created_at, created_by", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(historyPage * QUOTE_PAGE_SIZE, (historyPage + 1) * QUOTE_PAGE_SIZE - 1);
        const search = historySearch.trim().replace(/[%_\\]/g, "\\$&");
        if (search) query = query.ilike("customer", `%${search}%`);

        const { data, error, count } = await query;
        if (error) throw error;
        if (active) {
          setSavedQuotes(data ?? []);
          setHistoryCount(count ?? 0);
        }
      } catch (error) {
        if (active) {
          setHistoryError(error instanceof Error ? error.message : "No se pudieron cargar los presupuestos.");
          setSavedQuotes([]);
          setHistoryCount(0);
        }
      } finally {
        if (active) setHistoryLoading(false);
      }
    };

    loadQuotes();
    return () => {
      active = false;
    };
  }, [historyPage, historySearch, screen, session, supabase]);

  useEffect(() => {
    const previewArea = previewAreaRef.current;
    if (!previewArea) return undefined;

    const updateScale = () => {
      const availableWidth = previewArea.clientWidth - 20;
      setPreviewScale(Math.min(1, Math.max(0.25, availableWidth / PDF_LAYOUT.pageWidth)));
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(previewArea);
    requestAnimationFrame(updateScale);
    return () => observer.disconnect();
  }, [authReady, screen]);

  async function signIn(event) {
    event.preventDefault();
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setAuthError(error.message);
      else setSession(data.session);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "No se pudo conectar con Supabase.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setAuthError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) setAuthError(error.message);
      else setSession(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "No se pudo cerrar la sesión.");
    }
  }

  async function createQuotePdf() {
    if (!paperRef.current) {
      throw new Error("No se encontró la hoja del presupuesto para generar el PDF.");
    }
    const logoElement = paperRef.current.querySelector(".brand-logo");
    if (!logoElement) {
      throw new Error("No se encontró el logo de la hoja para incluirlo en el PDF.");
    }

    await document.fonts.ready;
    const logoPng = await svgToPng(logoElement);
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(paperRef.current, {
      backgroundColor: "#ffffff",
      height: 1123,
      logging: false,
      onclone: (clonedDocument) => {
        const paper = clonedDocument.querySelector(".paper");
        if (paper) {
          paper.style.width = `${PDF_LAYOUT.pageWidth}px`;
          paper.style.height = `${PDF_LAYOUT.pageHeight}px`;
          paper.style.minHeight = `${PDF_LAYOUT.pageHeight}px`;
          paper.style.padding = "48px 48px 34px";
          paper.style.transform = "none";
        }
        const clonedLogo = paper?.querySelector(".brand-logo");
        if (clonedLogo) clonedLogo.style.visibility = "hidden";
      },
      scale: 3,
      useCORS: true,
      width: PDF_LAYOUT.pageWidth,
    });
    const pdf = new jsPDF({
      compress: true,
      format: "a4",
      orientation: "portrait",
      unit: "mm",
    });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    pdf.addImage(
      logoPng,
      "PNG",
      (PDF_LAYOUT.logo.x / PDF_LAYOUT.pageWidth) * 210,
      (PDF_LAYOUT.logo.y / PDF_LAYOUT.pageHeight) * 297,
      (PDF_LAYOUT.logo.width / PDF_LAYOUT.pageWidth) * 210,
      (PDF_LAYOUT.logo.height / PDF_LAYOUT.pageHeight) * 297,
    );
    return {
      blob: pdf.output("blob"),
      fileName: quoteFileName(quote),
    };
  }

  function downloadPdf(blob, fileName) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function downloadQuotePdf() {
    setPdfLoading(true);
    setPdfError("");
    setPdfMessage("");
    try {
      const { blob, fileName } = await createQuotePdf();
      downloadPdf(blob, fileName);
      setPdfMessage("El presupuesto se descargó en PDF.");
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "No se pudo generar el PDF.");
    } finally {
      setPdfLoading(false);
    }
  }

  async function saveQuote() {
    if (!supabase || !session) return;
    if (!quote.customer.trim()) {
      setSaveError("Ingresá el nombre del cliente antes de guardar el presupuesto.");
      setSaveMessage("");
      return;
    }

    setSaveLoading(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const { data, error } = await supabase
        .from("quotes")
        .insert({
          customer: quote.customer.trim(),
          vehicle: quote.vehicle.trim(),
          plate: quote.plate.trim(),
          year: quote.year.trim(),
          phone: quote.phone.trim(),
          quote_date: quote.date || localDateInputValue(),
          repair: quote.repair,
          replace: quote.replace,
          parts: Number(quote.parts || 0),
          labor: Number(quote.labor || 0),
          created_by: session.user.id,
        })
        .select("id, customer, vehicle, plate, year, phone, quote_date, repair, replace, parts, labor, created_at, created_by")
        .single();
      if (error) throw error;
      setSelectedQuote(data);
      setQuote(quoteFromRecord(data));
      setSaveMessage("Presupuesto guardado. Ya está disponible en el historial.");
      setScreen("detail");
      setMobileShowPaper(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar el presupuesto en Supabase.");
    } finally {
      setSaveLoading(false);
    }
  }

  function startNewQuote() {
    setQuote({ ...initialQuote, date: localDateInputValue() });
    setSelectedQuote(null);
    setSaveError("");
    setSaveMessage("");
    setPdfError("");
    setPdfMessage("");
    setWhatsAppError("");
    setScreen("new");
    setMobileShowPaper(false);
  }

  function openSavedQuote(record) {
    setSelectedQuote(record);
    setQuote(quoteFromRecord(record));
    setSaveError("");
    setSaveMessage("");
    setScreen("detail");
    setMobileShowPaper(false);
    setPdfError("");
    setPdfMessage("");
  }

  function openWhatsApp() {
    const phone = quote.phone.replace(/\D/g, "");
    if (phone.length < 8 || phone.length > 15) {
      setWhatsAppError("Ingresá un número válido con código de país, por ejemplo 5492342483605.");
      return;
    }
    setWhatsAppError("");
    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
  }

  function update(field, value) {
    setQuote((current) => ({ ...current, [field]: value }));
  }

  const repairLines = splitLines(quote.repair);
  const replaceLines = splitLines(quote.replace);
  const finalAmount = Number(quote.parts || 0) + Number(quote.labor || 0);

  if (!authReady) {
    return <main className="auth-page"><div className="auth-card">Verificando acceso…</div></main>;
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <CrbLogo className="auth-logo" />
          <p className="eyebrow">CENTRO DE REPARACIONES BRAGADO</p>
          <h1>Ingreso del personal</h1>
          {!supabase ? (
            <div className="auth-message" role="alert">
              Falta configurar Supabase. Copiá <code>.env.example</code> a <code>.env.local</code>, completá la URL y la clave pública del proyecto y reiniciá el servidor.
            </div>
          ) : (
            <form className="auth-form" onSubmit={signIn}>
              <Field label="Correo electrónico" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
              <Field label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <button className="button button-primary" type="submit" disabled={authLoading}>
                {authLoading ? "Ingresando…" : "Iniciar sesión"}
              </button>
              <p className="auth-help">Las cuentas del personal se crean desde el panel de Supabase.</p>
            </form>
          )}
          {!supabase && authError && <p className="auth-error" role="alert">{authError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <div className="mobile-view-toggle no-print">
        <button type="button" className={!mobileShowPaper ? "is-active" : ""} onClick={() => setMobileShowPaper(false)}>Panel</button>
        <button type="button" className={mobileShowPaper ? "is-active" : ""} onClick={() => setMobileShowPaper(true)}>Hoja A4</button>
      </div>
      <aside className={`editor no-print${mobileShowPaper ? " mobile-hidden" : ""}`}>
        <div className="editor-heading">
          <CrbLogo className="mini-logo" />
          <div>
            <p className="eyebrow">CENTRO DE REPARACIONES BRAGADO</p>
            <h1>{screen === "history" ? "Presupuestos guardados" : screen === "detail" ? "Detalle del presupuesto" : "Nuevo presupuesto"}</h1>
          </div>
        </div>

        <div className="account-bar no-print">
          <span>{session.user.email}</span>
          <button type="button" onClick={signOut}>Cerrar sesión</button>
        </div>

        <nav className="section-nav" aria-label="Secciones de presupuestos">
          <button className={screen === "new" ? "is-active" : ""} type="button" onClick={startNewQuote}>Nuevo presupuesto</button>
          <button className={screen === "history" || screen === "detail" ? "is-active" : ""} type="button" onClick={() => { setScreen("history"); setHistoryPage(0); setMobileShowPaper(false); }}>Historial</button>
        </nav>

        {screen === "new" ? (
          <>
            <div className="editor-actions">
              <button className="button button-primary" type="button" onClick={saveQuote} disabled={saveLoading}>
                {saveLoading ? "Guardando…" : "Guardar presupuesto"}
              </button>
              <button className="button button-download" type="button" onClick={downloadQuotePdf} disabled={pdfLoading}>
                {pdfLoading ? "Preparando PDF…" : "Descargar PDF"}
              </button>
              <button className="button button-whatsapp" type="button" onClick={openWhatsApp}>
                Abrir WhatsApp
              </button>
            </div>
            {saveError && <p className="pdf-feedback pdf-error no-print" role="alert">{saveError}</p>}
            {saveMessage && <p className="pdf-feedback no-print" role="status">{saveMessage}</p>}
            {pdfError && <p className="pdf-feedback pdf-error no-print" role="alert">{pdfError}</p>}
            {pdfMessage && <p className="pdf-feedback no-print" role="status">{pdfMessage}</p>}
            {whatsAppError && <p className="pdf-feedback pdf-error no-print" role="alert">{whatsAppError}</p>}

            <section className="form-section">
              <h2>Datos del presupuesto</h2>
              <Field label="Fecha" type="date" value={quote.date} onChange={(event) => update("date", event.target.value)} />
              <Field label="Señor" value={quote.customer} onChange={(event) => update("customer", event.target.value)} placeholder="Nombre del cliente" />
              <Field label="Vehículo" value={quote.vehicle} onChange={(event) => update("vehicle", event.target.value)} placeholder="Marca y modelo" />
              <div className="field-row">
                <Field label="Dominio" value={quote.plate} onChange={(event) => update("plate", event.target.value)} placeholder="AB123CD" />
                <Field label="Año" value={quote.year} onChange={(event) => update("year", event.target.value)} placeholder="2020" />
              </div>
              <Field label="WhatsApp del cliente" type="tel" value={quote.phone} onChange={(event) => { update("phone", event.target.value); setWhatsAppError(""); }} placeholder="5492342483605" />
              <small className="phone-hint">Ingresá país, área y número para abrir su chat sin mensaje automático.</small>
            </section>

            <section className="form-section">
              <h2>Trabajos y repuestos</h2>
              <ListField label="Reparar" value={quote.repair} onChange={(value) => update("repair", value)} placeholder={"Reparación de paragolpes\nPintura de guardabarros"} />
              <ListField label="Reemplazar" value={quote.replace} onChange={(value) => update("replace", value)} placeholder={"Paragolpes delantero\nÓptica derecha"} />
            </section>

            <section className="form-section">
              <h2>Importes (ARS)</h2>
              <Field label="Repuestos" type="number" min="0" step="0.01" value={quote.parts} onChange={(event) => update("parts", event.target.value)} placeholder="0,00" />
              <Field label="Mano de obra chapa y pintura" type="number" min="0" step="0.01" value={quote.labor} onChange={(event) => update("labor", event.target.value)} placeholder="0,00" />
              <div className="total-preview">FINAL <strong>{formatAmount(finalAmount)}</strong></div>
            </section>
            <p className="editor-note">La vista previa se actualiza al escribir. Guardá el presupuesto para consultarlo luego desde el historial.</p>
          </>
        ) : screen === "history" ? (
          <section className="history-section">
            <label className="field">
              <span>Buscar por cliente</span>
              <input type="search" value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(0); }} placeholder="Nombre del cliente" />
            </label>
            {historyError && <p className="pdf-feedback pdf-error" role="alert">{historyError}</p>}
            {historyLoading ? <p className="history-empty">Cargando presupuestos…</p> : savedQuotes.length ? (
              <div className="quote-list">
                {savedQuotes.map((record) => (
                  <button className="quote-card" type="button" key={record.id} onClick={() => openSavedQuote(record)}>
                    <strong>{record.customer}</strong>
                    <span>{record.vehicle || "Vehículo sin especificar"}{record.plate ? ` · ${record.plate}` : ""}</span>
                    <span>{formatDate(record.quote_date)} · Final {formatAmount(Number(record.parts || 0) + Number(record.labor || 0))}</span>
                  </button>
                ))}
              </div>
            ) : !historyError && <p className="history-empty">{historySearch ? "No hay presupuestos para esa búsqueda." : "Todavía no hay presupuestos guardados."}</p>}
            {historyCount > QUOTE_PAGE_SIZE && (
              <div className="pagination">
                <button type="button" disabled={historyPage === 0 || historyLoading} onClick={() => setHistoryPage((page) => page - 1)}>Anterior</button>
                <span>{historyPage + 1} / {Math.ceil(historyCount / QUOTE_PAGE_SIZE)}</span>
                <button type="button" disabled={(historyPage + 1) * QUOTE_PAGE_SIZE >= historyCount || historyLoading} onClick={() => setHistoryPage((page) => page + 1)}>Siguiente</button>
              </div>
            )}
          </section>
        ) : (
          <section className="saved-detail">
            <p className="saved-detail-date">Presupuesto del {formatDate(selectedQuote?.quote_date)}</p>
            <h2>{selectedQuote?.customer}</h2>
            {saveMessage && <p className="pdf-feedback" role="status">{saveMessage}</p>}
            <dl>
              <div><dt>Vehículo</dt><dd>{selectedQuote?.vehicle || "—"}</dd></div>
              <div><dt>Dominio</dt><dd>{selectedQuote?.plate || "—"}</dd></div>
              <div><dt>Año</dt><dd>{selectedQuote?.year || "—"}</dd></div>
              <div><dt>WhatsApp</dt><dd>{selectedQuote?.phone || "—"}</dd></div>
              <div><dt>Repuestos</dt><dd>{formatAmount(selectedQuote?.parts)}</dd></div>
              <div><dt>Mano de obra</dt><dd>{formatAmount(selectedQuote?.labor)}</dd></div>
              <div><dt>Total final</dt><dd>{formatAmount(Number(selectedQuote?.parts || 0) + Number(selectedQuote?.labor || 0))}</dd></div>
            </dl>
            <div className="detail-actions">
              <button className="button button-primary" type="button" onClick={downloadQuotePdf} disabled={pdfLoading}>{pdfLoading ? "Preparando PDF…" : "Descargar PDF"}</button>
              <button className="button button-whatsapp" type="button" onClick={openWhatsApp}>Abrir WhatsApp</button>
              <button className="history-back" type="button" onClick={() => { setScreen("history"); setMobileShowPaper(false); }}>Volver al historial</button>
            </div>
            {pdfError && <p className="pdf-feedback pdf-error" role="alert">{pdfError}</p>}
            {whatsAppError && <p className="pdf-feedback pdf-error" role="alert">{whatsAppError}</p>}
          </section>
        )}
      </aside>

      <section ref={previewAreaRef} className={`preview-area${mobileShowPaper ? " mobile-paper-active" : ""}`} aria-label={screen === "detail" ? "Detalle impreso del presupuesto" : "Vista previa del presupuesto"}>
        <div className="preview-toolbar no-print">
          <span>{screen === "detail" ? "DETALLE DEL PRESUPUESTO · A4" : "VISTA PREVIA · A4"}</span>
          <span>{screen === "detail" ? selectedQuote?.customer : screen === "new" ? "Borrador sin guardar" : "Seleccioná un presupuesto para ver el detalle"}</span>
        </div>
        {screen === "detail" && (
          <div className="detail-preview-actions no-print">
            <button type="button" className="button button-primary" onClick={downloadQuotePdf} disabled={pdfLoading}>{pdfLoading ? "Preparando PDF…" : "Descargar este PDF"}</button>
            <button type="button" className="button button-whatsapp" onClick={openWhatsApp}>Abrir WhatsApp</button>
          </div>
        )}
        {screen === "detail" && pdfError && <p className="pdf-feedback pdf-error no-print" role="alert">{pdfError}</p>}
        <div className="paper-frame" style={{ width: PDF_LAYOUT.pageWidth * previewScale, height: PDF_LAYOUT.pageHeight * previewScale }}>
        <article className="paper" ref={paperRef} style={{ transform: `scale(${previewScale})` }}>
          <header className="stationery-header">
            <div className="header-stripe">
              <span className="header-name">CENTRO DE REPARACIONES BRAGADO</span>
              <CrbLogo className="brand-logo" />
            </div>
          </header>

          <div className="document-content">
            <div className="place-date">BRAGADO {formatDate(quote.date)}</div>

            <div className="vehicle-data">
              <p><strong>SEÑOR:</strong><span>{quote.customer}</span></p>
              <p><strong>VEHICULO:</strong><span>{quote.vehicle}</span></p>
              <div className="vehicle-inline">
                <p><strong>DOMINIO:</strong><span>{quote.plate}</span></p>
                <p><strong>AÑO:</strong><span>{quote.year}</span></p>
              </div>
            </div>

            <div className="work-section">
              <h2>REPARAR:</h2>
              {repairLines.map((line, index) => <p className="work-line" key={`repair-${index}`}>* {line}</p>)}
            </div>

            <div className="work-section replace-section">
              <h2>REEMPLAZAR:</h2>
              {replaceLines.map((line, index) => <p className="work-line" key={`replace-${index}`}>* {line}</p>)}
            </div>

            <div className="amount-boxes">
              <div className="amount-row"><strong>REPUESTOS</strong><span>{formatAmount(quote.parts)}</span></div>
              <div className="amount-row"><strong>MANO DE OBRA CHAPA Y PINTURA</strong><span>{formatAmount(quote.labor)}</span></div>
              <div className="amount-row amount-final"><strong>FINAL</strong><span>{formatAmount(finalAmount)}</span></div>
            </div>
          </div>

          <footer className="stationery-footer">
            <div className="legal-copy">AL RETIRAR EL VEHÍCULO DEL TALLER SE ABONARA EL TOTAL DE ESTE PRESUPUESTO EN EFECTIVO Y / O VALORES A CONVENIR</div>
            <div className="footer-yellow" />
            <div className="footer-blue">
              General Paz 1643 · Cel: 2342 483605 · E-mail: crbautomotores@hotmail.com · CP: B6640BXC · BRAGADO (BS. AS.)
            </div>
          </footer>
        </article>
        </div>
      </section>
    </main>
  );
}
