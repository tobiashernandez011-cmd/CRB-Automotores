"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

const initialQuote = {
  customer: "",
  vehicle: "",
  plate: "",
  year: "",
  phone: "",
  customerEmail: "",
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
const QUOTE_PDF_BUCKET = "quote-pdfs";
const HISTORY_PAGE_SIZE = 25;

function cleanText(value, multiline = false) {
  const normalized = value.replace(/\r\n?/g, "\n");
  return multiline
    ? normalized.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim()
    : normalized.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function validateQuote(quote) {
  if (!cleanText(quote.customer)) return "Ingresá el nombre del cliente para guardar el presupuesto.";
  const date = new Date(`${quote.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== quote.date) {
    return "Ingresá una fecha válida para el presupuesto.";
  }
  if (cleanText(quote.customerEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(quote.customerEmail))) {
    return "Ingresá un correo electrónico válido o dejá el campo vacío.";
  }
  if (quote.customer.length > 200 || quote.vehicle.length > 120 || quote.plate.length > 20 ||
      quote.year.length > 10 || quote.phone.length > 32 || quote.customerEmail.length > 254 ||
      quote.repair.length > 10000 || quote.replace.length > 10000) {
    return "Uno o más campos superan el largo permitido.";
  }
  for (const amount of [quote.parts, quote.labor]) {
    if (amount !== "" && (!Number.isFinite(Number(amount)) || Number(amount) < 0 || Number(amount) > 999999999999.99)) {
      return "Los importes deben ser números positivos válidos.";
    }
  }
  return "";
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function createUuid() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("El navegador necesita una conexión segura para guardar el PDF.");
  }
  if (cryptoApi.randomUUID) return cryptoApi.randomUUID();

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

function wrapWorkLine(value, maxLength = 72) {
  const parts = [];
  let remaining = value;

  while (remaining.length > maxLength) {
    let breakAt = remaining.lastIndexOf(" ", maxLength);
    if (breakAt < 1) breakAt = maxLength;
    parts.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  parts.push(remaining);
  return parts.map((text, index) => ({ text, continuation: index > 0 }));
}

function paginateWork(repairLines, replaceLines, includeAmounts) {
  const pages = [{ repair: [], replace: [] }];
  const capacities = includeAmounts ? [12, 18] : [17, 24];
  let used = 0;
  let pageIndex = 0;

  for (const [section, lines] of [["repair", repairLines], ["replace", replaceLines]]) {
    for (const line of lines.flatMap((item) => wrapWorkLine(item))) {
      let sectionLines = pages[pageIndex][section];
      const headingCost = sectionLines.length === 0 ? 1.5 : 0;
      if (used + headingCost + 1 > (capacities[pageIndex] ?? capacities[1]) && used > 0) {
        pages.push({ repair: [], replace: [] });
        pageIndex += 1;
        used = 0;
        sectionLines = pages[pageIndex][section];
      }
      if (sectionLines.length === 0) used += 1.5;
      sectionLines.push(line);
      used += 1;
    }
  }

  return pages;
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
        maxLength={10000}
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
  const [staffAuthorization, setStaffAuthorization] = useState({ userId: "", authorized: false, error: "" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfMessage, setPdfMessage] = useState("");
  const [shareFallback, setShareFallback] = useState(null);
  const [whatsAppError, setWhatsAppError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [mobileShowPaper, setMobileShowPaper] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [quote, setQuote] = useState(initialQuote);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyDeletingId, setHistoryDeletingId] = useState("");
  const [historyPdfLoading, setHistoryPdfLoading] = useState("");
  const paperStackRef = useRef(null);

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
    if (!session || !supabase) {
      return undefined;
    }

    let active = true;
    supabase.rpc("is_authorized_staff")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setStaffAuthorization({
            userId: session.user.id,
            authorized: false,
            error: `No se pudo verificar el permiso de personal: ${error.message}`,
          });
          return;
        }
        setStaffAuthorization({
          userId: session.user.id,
          authorized: data === true,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        setStaffAuthorization({
          userId: session.user.id,
          authorized: false,
          error: error instanceof Error ? error.message : "No se pudo verificar el permiso de personal.",
        });
      });

    return () => {
      active = false;
    };
  }, [session, supabase]);

  useEffect(() => {
    const updateScale = () => {
      const availableWidth = document.documentElement.clientWidth;
      if (availableWidth > 760) {
        setPreviewScale(1);
        return;
      }
      const horizontalPadding = 16;
      const width = Math.max(280, availableWidth - horizontalPadding);
      setPreviewScale(Math.min(1, width / PDF_LAYOUT.pageWidth));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [authReady]);

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

  async function saveQuotePdf(blob) {
    if (!supabase || !session?.user?.id) {
      throw new Error("Tu sesión venció. Iniciá sesión antes de guardar el presupuesto.");
    }
    const validationError = validateQuote(quote);
    if (validationError) throw new Error(validationError);

    const pdfPath = `${createUuid()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(QUOTE_PDF_BUCKET)
      .upload(pdfPath, blob, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      throw new Error(`No se pudo guardar el PDF en el historial: ${uploadError.message}`);
    }

    const quoteRecord = {
      customer: cleanText(quote.customer),
      vehicle: cleanText(quote.vehicle),
      plate: cleanText(quote.plate),
      year: cleanText(quote.year),
      phone: cleanText(quote.phone),
      customer_email: cleanText(quote.customerEmail),
      quote_date: quote.date,
      repair: cleanText(quote.repair, true),
      replace: cleanText(quote.replace, true),
      parts: quote.parts === "" ? 0 : Number(quote.parts),
      labor: quote.labor === "" ? 0 : Number(quote.labor),
      created_by: session.user.id,
      pdf_path: pdfPath,
    };
    const { error: insertError } = await supabase.from("quotes").insert(quoteRecord);
    if (insertError) {
      const { error: cleanupError } = await supabase.storage
        .from(QUOTE_PDF_BUCKET)
        .remove([pdfPath]);
      if (cleanupError) {
        throw new Error(`No se pudo registrar el presupuesto (${insertError.message}) ni limpiar el PDF temporal (${cleanupError.message}).`);
      }
      throw new Error(`No se pudo registrar el presupuesto: ${insertError.message}`);
    }
  }

  async function loadHistory({ append = false, filters } = {}) {
    if (!supabase || !session?.user?.id || historyLoading) return;
    const search = filters?.search ?? historySearch;
    const from = filters?.from ?? historyFrom;
    const to = filters?.to ?? historyTo;
    if (from && to && from > to) {
      setHistoryError("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }

    setHistoryLoading(true);
    setHistoryError("");
    try {
      const offset = append ? historyRows.length : 0;
      let request = supabase
        .from("quotes")
        .select("id, customer, vehicle, plate, year, phone, customer_email, quote_date, repair, replace, parts, labor, created_at, pdf_path", { count: "exact" })
        .order("quote_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + HISTORY_PAGE_SIZE - 1);
      if (search.trim()) {
        request = request.ilike("customer", `%${escapeLike(search.trim())}%`);
      }
      if (from) request = request.gte("quote_date", from);
      if (to) request = request.lte("quote_date", to);

      const { data, error, count } = await request;
      if (error) throw error;
      const rows = data || [];
      setHistoryRows((current) => append ? [...current, ...rows] : rows);
      setHistoryHasMore(offset + rows.length < (count ?? offset + rows.length));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "No se pudo consultar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openSavedPdf(row) {
    if (!row.pdf_path) {
      setHistoryError("Este presupuesto es anterior al historial de archivos y no tiene un PDF guardado.");
      return;
    }
    const pdfWindow = window.open("", "_blank");
    if (!pdfWindow) {
      setHistoryError("El navegador bloqueó la ventana del PDF. Permití las ventanas emergentes para este sitio.");
      return;
    }
    pdfWindow.opener = null;

    setHistoryPdfLoading(row.id);
    setHistoryError("");
    try {
      const { data, error } = await supabase.storage
        .from(QUOTE_PDF_BUCKET)
        .download(row.pdf_path);
      if (error) throw error;
      const pdfUrl = URL.createObjectURL(data);
      pdfWindow.location.href = pdfUrl;
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
    } catch (error) {
      pdfWindow.close();
      setHistoryError(error instanceof Error ? error.message : "No se pudo abrir el PDF guardado.");
    } finally {
      setHistoryPdfLoading("");
    }
  }

  async function deleteSavedQuote(row) {
    if (!supabase || !row?.id || historyDeletingId) return;
    const customer = cleanText(row.customer) || "este cliente";
    if (!window.confirm(`¿Eliminar definitivamente el presupuesto de ${customer} del ${formatDate(row.quote_date)}? Esta acción no se puede deshacer.`)) {
      return;
    }

    setHistoryDeletingId(row.id);
    setHistoryError("");
    setHistoryMessage("");
    let pdfBackup = null;
    let pdfRemoved = false;
    try {
      if (row.pdf_path) {
        const { data, error } = await supabase.storage
          .from(QUOTE_PDF_BUCKET)
          .download(row.pdf_path);
        if (error) throw new Error(`No se pudo preparar el PDF para eliminar el presupuesto: ${error.message}`);
        pdfBackup = data;

        const { error: removeError } = await supabase.storage
          .from(QUOTE_PDF_BUCKET)
          .remove([row.pdf_path]);
        if (removeError) throw new Error(`No se pudo eliminar el PDF: ${removeError.message}`);
        pdfRemoved = true;
      }

      const { data, error } = await supabase
        .from("quotes")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      if (!data?.some((deletedRow) => deletedRow.id === row.id)) {
        throw new Error("El presupuesto no se eliminó. Verificá los permisos y volvé a intentar.");
      }

      setHistoryRows((current) => current.filter((item) => item.id !== row.id));
      setHistoryMessage("Presupuesto eliminado correctamente.");
    } catch (error) {
      if (pdfBackup && pdfRemoved) {
        const { error: restoreError } = await supabase.storage
          .from(QUOTE_PDF_BUCKET)
          .upload(row.pdf_path, pdfBackup, { contentType: "application/pdf", upsert: false });
        if (restoreError) {
          setHistoryError(`No se pudo completar la eliminación y tampoco restaurar el PDF. Contactá al administrador. Error al eliminar: ${error instanceof Error ? error.message : "error desconocido"}. Error al restaurar: ${restoreError.message}`);
          setHistoryDeletingId("");
          return;
        }
      }
      setHistoryError(error instanceof Error ? error.message : "No se pudo eliminar el presupuesto.");
    } finally {
      setHistoryDeletingId("");
    }
  }

  async function createQuotePdf() {
    if (!paperStackRef.current) {
      throw new Error("No se encontró la hoja del presupuesto para generar el PDF.");
    }
    const paperElements = [...paperStackRef.current.querySelectorAll(".paper")];
    if (paperElements.length === 0) {
      throw new Error("No se encontraron hojas del presupuesto para generar el PDF.");
    }
    const logoElement = paperElements[0].querySelector(".brand-logo");
    if (!logoElement) {
      throw new Error("No se encontró el logo de la hoja para incluirlo en el PDF.");
    }

    await document.fonts.ready;
    const logoPng = await svgToPng(logoElement);
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const pdf = new jsPDF({
      compress: true,
      format: "a4",
      orientation: "portrait",
      unit: "mm",
    });
    for (const [index, paperElement] of paperElements.entries()) {
      const canvas = await html2canvas(paperElement, {
        backgroundColor: "#ffffff",
        foreignObjectRendering: false,
        height: PDF_LAYOUT.pageHeight,
        logging: false,
        onclone: (clonedDocument) => {
          const preview = clonedDocument.querySelector(".preview-area");
          if (preview) {
            preview.style.display = "block";
            preview.style.width = `${PDF_LAYOUT.pageWidth}px`;
            preview.style.height = "auto";
            preview.style.overflow = "visible";
            preview.style.padding = "0";
          }
          const frame = clonedDocument.querySelector(`[data-paper-frame="${index}"]`);
          if (frame) {
            frame.style.width = `${PDF_LAYOUT.pageWidth}px`;
            frame.style.height = `${PDF_LAYOUT.pageHeight}px`;
            frame.style.margin = "0";
          }
          const paper = clonedDocument.querySelector(`[data-pdf-page="${index}"]`);
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
      if (!Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
        throw new Error(`No se pudo preparar la hoja ${index + 1} del presupuesto para el PDF.`);
      }
      if (index > 0) pdf.addPage("a4", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", 0, 0, 210, 297, undefined, "FAST");
      pdf.addImage(
        logoPng,
        "PNG",
        (PDF_LAYOUT.logo.x / PDF_LAYOUT.pageWidth) * 210,
        (PDF_LAYOUT.logo.y / PDF_LAYOUT.pageHeight) * 297,
        (PDF_LAYOUT.logo.width / PDF_LAYOUT.pageWidth) * 210,
        (PDF_LAYOUT.logo.height / PDF_LAYOUT.pageHeight) * 297,
      );
    }
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
    setShareFallback(null);
    try {
      const { blob, fileName } = await createQuotePdf();
      await saveQuotePdf(blob);
      downloadPdf(blob, fileName);
      setPdfMessage("El PDF se guardó en el historial y se descargó correctamente.");
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "No se pudo generar el PDF.");
    } finally {
      setPdfLoading(false);
    }
  }

  function getWhatsAppUrl() {
    const phone = quote.phone.replace(/\D/g, "");
    if (phone.length < 8 || phone.length > 15) {
      setWhatsAppError("Ingresá un número válido con código de país, por ejemplo 5492342483605.");
      return "";
    }
    setWhatsAppError("");
    return `https://wa.me/${phone}`;
  }

  function openWhatsApp() {
    const url = getWhatsAppUrl();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function getEmailUrl() {
    const recipient = quote.customerEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setEmailError("Ingresá una dirección de correo válida para abrir el mensaje.");
      return "";
    }
    setEmailError("");
    const composeUrl = new URL("https://mail.google.com/mail/");
    composeUrl.searchParams.set("view", "cm");
    composeUrl.searchParams.set("fs", "1");
    composeUrl.searchParams.set("to", recipient);
    return composeUrl.toString();
  }

  function canSharePdfFile() {
    if (typeof navigator === "undefined" || typeof File === "undefined" ||
        typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
      return false;
    }
    const testFile = new File([""], "presupuesto.pdf", { type: "application/pdf" });
    return navigator.canShare({ files: [testFile] });
  }

  async function shareQuote(channel) {
    setPdfLoading(true);
    setPdfError("");
    setPdfMessage("");
    setShareFallback(null);
    setWhatsAppError("");
    setEmailError("");

    const fallbackUrl = channel === "whatsapp" ? getWhatsAppUrl() : getEmailUrl();
    if (!fallbackUrl) {
      setPdfLoading(false);
      return;
    }

    try {
      const { blob, fileName } = await createQuotePdf();
      const file = typeof File === "undefined"
        ? null
        : new File([blob], fileName, { type: "application/pdf" });
      let sharePromise = null;
      let shareError = null;

      if (file && canSharePdfFile() && navigator.canShare({ files: [file] })) {
        try {
          const customer = cleanText(quote.customer);
          const vehicle = cleanText(quote.vehicle);
          const destination = channel === "whatsapp"
            ? `Presupuesto de ${customer}${vehicle ? ` para ${vehicle}` : ""}.`
            : `Presupuesto de ${customer}${vehicle ? ` para ${vehicle}` : ""}. Destinatario: ${quote.customerEmail.trim()}.`;
          sharePromise = navigator.share({
            files: [file],
            title: `Presupuesto C.R.B. - ${customer}`,
            text: destination,
          }).then(
            () => ({ error: null }),
            (error) => ({ error }),
          );
        } catch (error) {
          shareError = error;
        }
      }

      await saveQuotePdf(blob);

      if (sharePromise) {
        const { error } = await sharePromise;
        if (!error) {
          setPdfMessage(
            channel === "whatsapp"
              ? "PDF listo para compartir. Elegí WhatsApp y luego el contacto del cliente."
              : "PDF listo para compartir. Elegí una app de correo y verificá el destinatario antes de enviarlo.",
          );
          return;
        }
        if (error instanceof Error && error.name === "AbortError") {
          setPdfMessage("Se canceló el menú de compartir. El presupuesto quedó guardado en el historial.");
          return;
        }
        shareError = error;
      }

      downloadPdf(blob, fileName);
      setShareFallback({
        href: fallbackUrl,
        label: channel === "whatsapp" ? "Abrir WhatsApp" : "Abrir Gmail",
      });
      setPdfMessage(
        shareError
          ? "No se pudo abrir el menú para compartir. Se descargó el PDF; abrí la app y adjuntalo para enviarlo."
          : "Este navegador no permite adjuntar archivos al compartir. Se descargó el PDF; abrí la app y adjuntalo para enviarlo.",
      );
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "No se pudo preparar el presupuesto para compartir.");
    } finally {
      setPdfLoading(false);
    }
  }

  function update(field, value) {
    setQuote((current) => ({ ...current, [field]: value }));
  }

  const repairLines = splitLines(quote.repair);
  const replaceLines = splitLines(quote.replace);
  const finalAmount = Number(quote.parts || 0) + Number(quote.labor || 0);
  const hasAmounts = quote.parts !== "" || quote.labor !== "";
  const documentPages = paginateWork(repairLines, replaceLines, hasAmounts);

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

  if (staffAuthorization.userId !== session.user.id) {
    return <main className="auth-page"><div className="auth-card">Verificando autorización del personal…</div></main>;
  }

  if (!staffAuthorization.authorized) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <CrbLogo className="auth-logo" />
          <p className="eyebrow">CENTRO DE REPARACIONES BRAGADO</p>
          <h1>Acceso no autorizado</h1>
          <p className="auth-help">Esta cuenta todavía no está habilitada para el historial del taller. Pedile al administrador que ejecute la configuración de Supabase y agregue tu usuario a `staff_members`.</p>
          {staffAuthorization.error && <p className="auth-error" role="alert">{staffAuthorization.error}</p>}
          <button className="button button-primary" type="button" onClick={signOut}>Cerrar sesión</button>
        </section>
      </main>
    );
  }

  if (historyOpen) {
    return (
      <main className="history-page">
        <header className="history-header">
          <div>
            <p className="eyebrow">CENTRO DE REPARACIONES BRAGADO</p>
            <h1>Presupuestos guardados</h1>
            <p>Historial compartido del taller · {session.user.email}</p>
          </div>
          <div className="history-header-actions">
            <button className="button button-primary" type="button" onClick={() => setHistoryOpen(false)}>Nuevo presupuesto</button>
            <button className="history-logout" type="button" onClick={signOut}>Cerrar sesión</button>
          </div>
        </header>

        <form
          className="history-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void loadHistory();
          }}
        >
          <label className="field">
            <span>Buscar por cliente</span>
            <input maxLength={200} type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Nombre o parte del nombre" />
          </label>
          <label className="field">
            <span>Desde</span>
            <input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} />
          </label>
          <label className="field">
            <span>Hasta</span>
            <input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} />
          </label>
          <div className="history-filter-actions">
            <button className="button button-primary" type="submit" disabled={historyLoading}>Buscar</button>
            <button
              className="history-reset"
              type="button"
              disabled={historyLoading}
              onClick={() => {
                setHistorySearch("");
                setHistoryFrom("");
                setHistoryTo("");
                void loadHistory({ filters: { search: "", from: "", to: "" } });
              }}
            >
              Limpiar
            </button>
          </div>
        </form>

        {historyError && <p className="history-error" role="alert">{historyError}</p>}
        {historyMessage && <p className="history-message" role="status">{historyMessage}</p>}
        {historyLoading && historyRows.length === 0 && <p className="history-empty">Cargando presupuestos…</p>}
        {!historyLoading && historyRows.length === 0 && !historyError && <p className="history-empty">No se encontraron presupuestos con esos filtros.</p>}

        <section className="history-list" aria-label="Resultados del historial">
          {historyRows.map((row) => (
            <article className="history-card" key={row.id}>
              <div className="history-card-header">
                <div>
                  <h2>{row.customer}</h2>
                  <time dateTime={row.quote_date}>{formatDate(row.quote_date)}</time>
                </div>
                <div className="history-card-actions">
                  <button className="button button-primary" type="button" onClick={() => openSavedPdf(row)} disabled={!row.pdf_path || historyPdfLoading === row.id || historyDeletingId === row.id}>
                    {historyPdfLoading === row.id ? "Abriendo…" : "Abrir PDF"}
                  </button>
                  <button className="button button-danger" type="button" onClick={() => deleteSavedQuote(row)} disabled={historyDeletingId === row.id || historyPdfLoading === row.id}>
                    {historyDeletingId === row.id ? "Eliminando…" : "Eliminar"}
                  </button>
                </div>
              </div>
              <p className="history-summary">{[row.vehicle, row.plate, row.year].filter(Boolean).join(" · ") || "Sin datos del vehículo"}</p>
              <details className="history-details">
                <summary>Ver datos del presupuesto</summary>
                <dl>
                  <div><dt>Vehículo</dt><dd>{row.vehicle || "—"}</dd></div>
                  <div><dt>Dominio</dt><dd>{row.plate || "—"}</dd></div>
                  <div><dt>Año</dt><dd>{row.year || "—"}</dd></div>
                  <div><dt>WhatsApp</dt><dd>{row.phone || "—"}</dd></div>
                  <div><dt>Correo</dt><dd>{row.customer_email || "—"}</dd></div>
                  <div><dt>Reparar</dt><dd>{row.repair || "—"}</dd></div>
                  <div><dt>Reemplazar</dt><dd>{row.replace || "—"}</dd></div>
                  <div><dt>Repuestos</dt><dd>{formatAmount(row.parts)}</dd></div>
                  <div><dt>Mano de obra</dt><dd>{formatAmount(row.labor)}</dd></div>
                </dl>
              </details>
              {!row.pdf_path && <p className="history-legacy-note">Registro previo: no hay un PDF archivado para este presupuesto.</p>}
            </article>
          ))}
        </section>

        {historyHasMore && (
          <button className="button button-primary history-load-more" type="button" onClick={() => void loadHistory({ append: true })} disabled={historyLoading}>
            {historyLoading ? "Cargando…" : "Cargar más presupuestos"}
          </button>
        )}
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
            <h1>Nuevo presupuesto</h1>
          </div>
        </div>

        <div className="account-bar no-print">
          <span>{session.user.email}</span>
          <div className="account-actions">
            <button type="button" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>Historial</button>
            <button type="button" onClick={signOut}>Cerrar sesión</button>
          </div>
        </div>

        <div className="editor-actions">
          <button className="button button-primary" type="button" onClick={downloadQuotePdf} disabled={pdfLoading}>
            {pdfLoading ? "Preparando PDF…" : "Descargar PDF"}
          </button>
          <button className="button button-whatsapp" type="button" onClick={openWhatsApp}>
            Abrir WhatsApp
          </button>
          <button className="button button-email" type="button" onClick={() => shareQuote("email")} disabled={pdfLoading}>
            {pdfLoading ? "Preparando…" : "PDF + correo"}
          </button>
        </div>
        <p className="editor-note action-note">WhatsApp abre el chat del número ingresado. Para adjuntar el PDF, descargalo primero y adjuntalo desde el chat.</p>
        {pdfError && <p className="pdf-feedback pdf-error no-print" role="alert">{pdfError}</p>}
        {pdfMessage && <p className="pdf-feedback no-print" role="status">{pdfMessage}</p>}
        {shareFallback && (
          <a className="button button-primary share-fallback no-print" href={shareFallback.href} target="_blank" rel="noopener noreferrer">
            {shareFallback.label}
          </a>
        )}
        {whatsAppError && <p className="pdf-feedback pdf-error no-print" role="alert">{whatsAppError}</p>}
        {emailError && <p className="pdf-feedback pdf-error no-print" role="alert">{emailError}</p>}

        <section className="form-section">
          <h2>Datos del presupuesto</h2>
          <Field label="Fecha" type="date" value={quote.date} onChange={(event) => update("date", event.target.value)} />
          <Field label="Señor" maxLength={200} value={quote.customer} onChange={(event) => update("customer", event.target.value)} placeholder="Nombre del cliente" />
          <Field label="Vehículo" maxLength={120} value={quote.vehicle} onChange={(event) => update("vehicle", event.target.value)} placeholder="Marca y modelo" />
          <div className="field-row">
            <Field label="Dominio" maxLength={20} value={quote.plate} onChange={(event) => update("plate", event.target.value)} placeholder="AB123CD" />
            <Field label="Año" maxLength={10} value={quote.year} onChange={(event) => update("year", event.target.value)} placeholder="2020" />
          </div>
          <Field label="WhatsApp del cliente" type="tel" maxLength={32} value={quote.phone} onChange={(event) => { update("phone", event.target.value); setWhatsAppError(""); }} placeholder="5492342483605" />
          <small className="phone-hint">Ingresá país, área y número para abrir su chat sin mensaje automático.</small>
          <Field label="Correo electrónico del cliente" type="email" maxLength={254} autoComplete="email" value={quote.customerEmail} onChange={(event) => { update("customerEmail", event.target.value); setEmailError(""); }} placeholder="cliente@correo.com" />
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
      </aside>

      <section className={`preview-area${mobileShowPaper ? " mobile-paper-active" : ""}`} aria-label="Vista previa del presupuesto">
        <div className="preview-toolbar no-print">
          <span>VISTA PREVIA · A4 · {documentPages.length} {documentPages.length === 1 ? "HOJA" : "HOJAS"}</span>
          <span>Presupuesto en edición</span>
        </div>
        <div className="paper-stack" ref={paperStackRef}>
          {documentPages.map((page, pageIndex) => (
            <div
              className="paper-frame"
              data-paper-frame={pageIndex}
              key={`paper-frame-${pageIndex}`}
              style={{ width: PDF_LAYOUT.pageWidth * previewScale, height: PDF_LAYOUT.pageHeight * previewScale }}
            >
              <article
                className={`paper${documentPages.length > 1 ? " paper-multipage" : ""}`}
                data-pdf-page={pageIndex}
                style={{ transform: `scale(${previewScale})` }}
              >
                <header className="stationery-header">
                  <div className="header-stripe">
                    <span className="header-name">CENTRO DE REPARACIONES BRAGADO</span>
                    <CrbLogo className="brand-logo" />
                  </div>
                </header>

                <div className="document-content">
                  {pageIndex === 0 ? (
                    <>
                      <div className="place-date">BRAGADO {formatDate(quote.date)}</div>

                      {(cleanText(quote.customer) || cleanText(quote.vehicle) || cleanText(quote.plate) || cleanText(quote.year)) && (
                        <div className="vehicle-data">
                          {cleanText(quote.customer) && <p><strong>SEÑOR:</strong><span>{quote.customer}</span></p>}
                          {cleanText(quote.vehicle) && <p><strong>VEHICULO:</strong><span>{quote.vehicle}</span></p>}
                          {(cleanText(quote.plate) || cleanText(quote.year)) && (
                            <div className="vehicle-inline">
                              {cleanText(quote.plate) && <p><strong>DOMINIO:</strong><span>{quote.plate}</span></p>}
                              {cleanText(quote.year) && <p><strong>AÑO:</strong><span>{quote.year}</span></p>}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="continuation-label">CONTINUACIÓN · {cleanText(quote.customer)}</div>
                  )}

                  {page.repair.length > 0 && (
                    <div className="work-section">
                      <h2>REPARAR:</h2>
                      {page.repair.map((line, index) => (
                        <p className={`work-line${line.continuation ? " work-line-continuation" : ""}`} key={`repair-${pageIndex}-${index}`}>
                          {line.continuation ? null : "* "}{line.text}
                        </p>
                      ))}
                    </div>
                  )}

                  {page.replace.length > 0 && (
                    <div className="work-section replace-section">
                      <h2>REEMPLAZAR:</h2>
                      {page.replace.map((line, index) => (
                        <p className={`work-line${line.continuation ? " work-line-continuation" : ""}`} key={`replace-${pageIndex}-${index}`}>
                          {line.continuation ? null : "* "}{line.text}
                        </p>
                      ))}
                    </div>
                  )}

                  {hasAmounts && pageIndex === documentPages.length - 1 && (
                    <div className="amount-boxes">
                      {quote.parts !== "" && <div className="amount-row"><strong>REPUESTOS</strong><span>{formatAmount(quote.parts)}</span></div>}
                      {quote.labor !== "" && <div className="amount-row"><strong>MANO DE OBRA CHAPA Y PINTURA</strong><span>{formatAmount(quote.labor)}</span></div>}
                      <div className="amount-row amount-final"><strong>FINAL</strong><span>{formatAmount(finalAmount)}</span></div>
                    </div>
                  )}
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
          ))}
        </div>
      </section>
    </main>
  );
}
