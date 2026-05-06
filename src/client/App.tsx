import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bug,
  Camera,
  Check,
  ClipboardList,
  FileImage,
  ListFilter,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import { api, fileUrl, type AiDebugResponse } from "./api";
import {
  detectReceipt,
  fileToObjectUrl,
  pointToPercent,
  processReceiptImage,
  type DetectionResult,
  type Point
} from "./imageProcessing";
import {
  Button,
  Card,
  DateField,
  EmptyState,
  FieldGroup,
  IconButton,
  Input,
  ReceiptPreview,
  RowLink,
  Select,
  StatusPill,
  Toast,
  WarningBanner
} from "./components";
import { formatCents, parseMoneyToCents } from "../shared/money";
import type { ImageQualityReport, ReceiptExtraction, ReceiptRecord, ReceiptStatus } from "../shared/receiptTypes";

type View = "welcome" | "crop" | "review" | "list" | "detail" | "settings" | "debug";

const stages = ["Augšupielāde", "Attēla apstrāde", "PDF izveide", "Čeka nolasīšana", "Datu validācija", "Saglabāšana datubāzē"];

interface BackgroundJob {
  id: string;
  stage: number;
  startedAt: number;
}

export default function App() {
  const [view, setView] = useState<View>("welcome");
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptRecord | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [processedUrl, setProcessedUrl] = useState<string>("");
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "danger" } | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refreshReceipts();
  }, []);

  const activeProcessedFile = activeReceipt?.files.find((file) => file.kind === "processed_image");
  const activeOriginalFile = activeReceipt?.files.find((file) => file.kind === "original_image");
  const activePdfFile = activeReceipt?.files.find((file) => file.kind === "generated_pdf");

  async function refreshReceipts() {
    try {
      const response = await api.listReceipts();
      setReceipts(response.receipts);
    } catch (error) {
      showError(error);
    }
  }

  async function refreshActiveReceipt(id: string) {
    try {
      const response = await api.getReceipt(id);
      setActiveReceipt(response.receipt);
      void refreshReceipts();
    } catch (error) {
      showError(error);
    }
  }

  function openCameraCapture() {
    cameraInputRef.current?.click();
  }

  function openGalleryPicker() {
    galleryInputRef.current?.click();
  }

  async function handleFileSelected(file: File) {
    try {
      setOriginalFile(file);
      setOriginalUrl(await fileToObjectUrl(file));
      const upload = await api.uploadReceipt(file);
      setActiveReceipt(upload.receipt);
      const detected = await detectReceipt(file);
      setDetection(detected);
      setCorners(insetInitialCorners(detected.corners, detected.imageWidth, detected.imageHeight));
      setView("crop");
      void refreshReceipts();
    } catch (error) {
      showError(error);
    }
  }

  async function straightenReceipt() {
    if (!originalFile || !detection) return;
    try {
      const result = await processReceiptImage(originalFile, corners);
      setProcessedBlob(result.blob);
      setProcessedUrl(result.dataUrl);
      setDetection({ ...detection, quality: mergeQuality(detection.quality, result.quality) });
      showToast("Čeks iztaisnots un uzlabots.");
    } catch (error) {
      showError(error);
    }
  }

  async function continueProcessing() {
    if (!activeReceipt || !originalFile || !detection) return;
    const jobInput = {
      receipt: activeReceipt,
      file: originalFile,
      detection,
      corners: [...corners],
      processedBlob
    };

    setBackgroundJobs((jobs) => [...jobs.filter((job) => job.id !== activeReceipt.id), { id: activeReceipt.id, stage: 1, startedAt: Date.now() }]);
    resetScanDraft();
    setView("welcome");
    showToast("Čeks apstrādājas fonā. Vari skenēt nākamo.");
    openCameraCapture();
    void processReceiptInBackground(jobInput);
  }

  async function processReceiptInBackground(input: { receipt: ReceiptRecord; file: File; detection: DetectionResult; corners: Point[]; processedBlob: Blob | null }) {
    try {
      updateBackgroundJob(input.receipt.id, 1);
      let blob = input.processedBlob;
      let quality = input.detection.quality;
      if (!blob) {
        const processed = await processReceiptImage(input.file, input.corners);
        blob = processed.blob;
        quality = mergeQuality(quality, processed.quality);
      }

      updateBackgroundJob(input.receipt.id, 2);
      const processed = await api.processReceipt(input.receipt.id, blob, quality, input.corners);
      setActiveReceipt((current) => current?.id === input.receipt.id ? processed.receipt : current);
      updateBackgroundJob(input.receipt.id, 3);
      const extracted = await api.extractReceipt(input.receipt.id);
      updateBackgroundJob(input.receipt.id, 5);
      setActiveReceipt((current) => current?.id === input.receipt.id ? extracted.receipt : current);
      showToast(extracted.receipt.status === "verified" ? "Čeks verificēts." : "Čeks saglabāts kā jāpārbauda.");
      void refreshReceipts();
    } catch (error) {
      showError(error);
      const latest = await api.getReceipt(input.receipt.id).catch(() => null);
      if (latest) {
        setActiveReceipt((current) => current?.id === input.receipt.id ? latest.receipt : current);
      }
      void refreshReceipts();
    } finally {
      setBackgroundJobs((jobs) => jobs.filter((job) => job.id !== input.receipt.id));
    }
  }

  function updateBackgroundJob(id: string, stage: number) {
    setBackgroundJobs((jobs) => jobs.map((job) => job.id === id ? { ...job, stage } : job));
  }

  function resetScanDraft() {
    setActiveReceipt(null);
    setOriginalFile(null);
    setOriginalUrl("");
    setProcessedUrl("");
    setProcessedBlob(null);
    setDetection(null);
    setCorners([]);
  }

  function showToast(message: string) {
    setToast({ message });
    window.setTimeout(() => setToast(null), 3500);
  }

  function showError(error: unknown) {
    setToast({ message: error instanceof Error ? error.message : "Darbība neizdevās.", tone: "danger" });
  }

  async function deleteReceipt(receipt: ReceiptRecord) {
    const name = receipt.merchantDisplayName ?? "šo čeku";
    if (!window.confirm(`Dzēst ${name}? Šo darbību nevarēs atsaukt.`)) return;
    try {
      await api.deleteReceipt(receipt.id);
      setReceipts((items) => items.filter((item) => item.id !== receipt.id));
      if (activeReceipt?.id === receipt.id) {
        setActiveReceipt(null);
        setView("list");
      }
      showToast("Čeks izdzēsts.");
      void refreshReceipts();
    } catch (error) {
      showError(error);
    }
  }

  async function resumeReceiptFromOriginal(receipt: ReceiptRecord) {
    const original = receipt.files.find((file) => file.kind === "original_image");
    if (!original) {
      showError(new Error("Oriģinālais fails nav atrasts."));
      return;
    }

    try {
      const sourceUrl = fileUrl(receipt.id, original.id);
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error("Oriģinālo attēlu neizdevās ielādēt.");
      const blob = await response.blob();
      const file = new File([blob], original.originalName || "receipt.jpg", { type: original.mimeType || blob.type || "image/jpeg" });
      setActiveReceipt(receipt);
      setOriginalFile(file);
      setOriginalUrl(await fileToObjectUrl(file));
      setProcessedBlob(null);
      setProcessedUrl("");
      const detected = await detectReceipt(file);
      setDetection(detected);
      setCorners(insetInitialCorners(detected.corners, detected.imageWidth, detected.imageHeight));
      setView("crop");
    } catch (error) {
      showError(error);
    }
  }

  const fileInputs = (
    <>
      <input
        ref={cameraInputRef}
        hidden
        id="receipt-camera"
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleFileSelected(file);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={galleryInputRef}
        hidden
        id="receipt-gallery"
        type="file"
        accept="image/jpeg,image/png"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleFileSelected(file);
          event.currentTarget.value = "";
        }}
      />
    </>
  );

  return (
    <div className="app-shell">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {backgroundJobs.length ? <BackgroundProcessingBadge jobs={backgroundJobs} /> : null}
      {fileInputs}
      {view !== "crop" ? (
        <nav className="top-nav" aria-label="Galvenā navigācija">
          <button type="button" onClick={() => setView("welcome")}>Čeku skeneris</button>
          <div>
            <IconButton label="Skenēt čeku" icon={Camera} onClick={openCameraCapture} />
            <IconButton label="Saraksts" icon={ClipboardList} onClick={() => { setView("list"); void refreshReceipts(); }} />
            <IconButton label="AI tests" icon={Bug} onClick={() => setView("debug")} />
            <IconButton label="Iestatījumi" icon={Settings} onClick={() => setView("settings")} />
          </div>
        </nav>
      ) : null}

      {view === "welcome" ? (
        <WelcomeScreen onScan={openCameraCapture} onUpload={openGalleryPicker} onDebug={() => setView("debug")} />
      ) : null}
      {view === "crop" && detection ? (
        <CropScreen
          imageUrl={originalUrl}
          detection={detection}
          corners={corners}
          processedUrl={processedUrl}
          setCorners={setCorners}
          onBack={() => { resetScanDraft(); setView("welcome"); }}
          onStraighten={straightenReceipt}
          onRetake={openCameraCapture}
          onContinue={continueProcessing}
        />
      ) : null}
      {view === "review" && activeReceipt ? (
        <ReviewScreen receipt={activeReceipt} processedUrl={processedUrl || (activeProcessedFile ? fileUrl(activeReceipt.id, activeProcessedFile.id) : "")} onReceipt={setActiveReceipt} onList={() => { setView("list"); void refreshReceipts(); }} />
      ) : null}
      {view === "list" ? (
        <ReceiptList receipts={receipts} onRefresh={refreshReceipts} onOpen={(receipt) => { setActiveReceipt(receipt); setView("detail"); }} onDelete={deleteReceipt} onScan={openCameraCapture} onResume={resumeReceiptFromOriginal} />
      ) : null}
      {view === "detail" && activeReceipt ? (
        <ReceiptDetail
          receipt={activeReceipt}
          originalUrl={activeOriginalFile ? fileUrl(activeReceipt.id, activeOriginalFile.id) : ""}
          processedUrl={activeProcessedFile ? fileUrl(activeReceipt.id, activeProcessedFile.id) : ""}
          pdfUrl={activePdfFile ? fileUrl(activeReceipt.id, activePdfFile.id) : ""}
          onBack={() => { setView("list"); void refreshReceipts(); }}
          onRefresh={() => void refreshActiveReceipt(activeReceipt.id)}
          onReview={() => setView("review")}
          onResume={resumeReceiptFromOriginal}
          onDelete={deleteReceipt}
        />
      ) : null}
      {view === "settings" ? <SettingsScreen /> : null}
      {view === "debug" ? <AiDebugScreen /> : null}
    </div>
  );
}

function WelcomeScreen(props: {
  onScan: () => void;
  onUpload: () => void;
  onDebug: () => void;
}) {
  return (
    <main className="welcome-screen">
      <Card className="welcome-card">
        <div className="app-mark" aria-hidden="true">
          <FileImage size={34} />
        </div>
        <h1>Čeku skeneris</h1>
        <p>Ātra čeku nolasīšana ar stingru pārbaudi pirms dati nonāk grāmatvedībā.</p>
        <div className="stack">
          <Button icon={Camera} full onClick={props.onScan}>Skenēt čeku</Button>
          <Button icon={Upload} variant="secondary" full onClick={props.onUpload}>Augšupielādēt no galerijas</Button>
          <Button icon={Bug} variant="ghost" full onClick={props.onDebug}>AI tests</Button>
        </div>
      </Card>
    </main>
  );
}

function CropScreen(props: {
  imageUrl: string;
  detection: DetectionResult;
  corners: Point[];
  processedUrl: string;
  setCorners: (points: Point[]) => void;
  onBack: () => void;
  onStraighten: () => void;
  onRetake: () => void;
  onContinue: () => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [dragState, setDragState] = useState<{ index: number; offset: Point } | null>(null);
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);
  const warnings = props.detection.quality.warnings;

  function cornerToDisplayPercent(point: Point): Point {
    return pointToPercent(point, props.detection.imageWidth, props.detection.imageHeight);
  }

  function pointerToImagePoint(event: React.PointerEvent): Point | null {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * props.detection.imageWidth, 0, props.detection.imageWidth),
      y: clamp(((event.clientY - rect.top) / rect.height) * props.detection.imageHeight, 0, props.detection.imageHeight)
    };
  }

  function beginCornerDrag(event: React.PointerEvent) {
    const pointer = pointerToImagePoint(event);
    if (!pointer) return;
    const index = nearestCornerIndex(pointer, props.corners);
    const corner = props.corners[index];
    setSelectedCorner(index);
    setDragState({
      index,
      offset: {
        x: corner.x - pointer.x,
        y: corner.y - pointer.y
      }
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateCorner(event: React.PointerEvent) {
    if (!dragState) return;
    const pointer = pointerToImagePoint(event);
    if (!pointer) return;
    const next = [...props.corners];
    next[dragState.index] = {
      x: clamp(pointer.x + dragState.offset.x, 0, props.detection.imageWidth),
      y: clamp(pointer.y + dragState.offset.y, 0, props.detection.imageHeight)
    };
    props.setCorners(next);
  }

  return (
    <main className="crop-screen">
      <header className="screen-header row-header">
        <div>
          <h1>Iztaisnot čeku</h1>
          <p>Pārbaudi stūrus pirms nolasīšanas.</p>
        </div>
        <IconButton label="Atpakaļ" icon={ArrowLeft} onClick={props.onBack} />
      </header>
      {warnings.length ? <WarningBanner>{warnings.join(" ")}</WarningBanner> : null}
      <div className="crop-layout">
        <div className="crop-canvas">
          <div className="crop-image-stage" onPointerDown={beginCornerDrag} onPointerMove={updateCorner} onPointerUp={() => setDragState(null)} onPointerCancel={() => setDragState(null)}>
            <img ref={imageRef} src={props.imageUrl} alt="Uzņemtais čeks" />
            <svg className="crop-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon points={props.corners.map((point) => {
                const percent = cornerToDisplayPercent(point);
                return `${percent.x},${percent.y}`;
              }).join(" ")} />
            </svg>
            {props.corners.map((point, index) => {
              const percent = cornerToDisplayPercent(point);
              return (
                <button
                  className={`corner-handle ${selectedCorner === index ? "active" : ""}`}
                  key={index}
                  style={{ left: `${percent.x}%`, top: `${percent.y}%` }}
                  type="button"
                  aria-label={`Stūris ${index + 1}`}
                />
              );
            })}
          </div>
        </div>
        {props.processedUrl ? <ReceiptPreview src={props.processedUrl} title="Apstrādāts priekšskatījums" /> : null}
      </div>
      <div className="bottom-actions">
        <Button variant="secondary" icon={RotateCcw} onClick={props.onRetake}>Uzņemt vēlreiz</Button>
        <Button variant="secondary" icon={WandSparkles} onClick={props.onStraighten}>Iztaisnot čeku</Button>
        <Button icon={Check} onClick={props.onContinue}>Turpināt</Button>
      </div>
    </main>
  );
}

function BackgroundProcessingBadge({ jobs }: { jobs: BackgroundJob[] }) {
  const count = jobs.length;
  const latestStage = Math.max(...jobs.map((job) => job.stage));
  const stage = stages[clamp(latestStage, 0, stages.length - 1)] ?? stages[0];
  const label = count === 1 ? "Apstrādājas 1 dokuments" : `Apstrādājas ${count} dokumenti`;

  return (
    <div className="background-jobs" role="status" aria-live="polite">
      <span>{label}</span>
      <small>{stage}</small>
    </div>
  );
}

function ReviewScreen(props: { receipt: ReceiptRecord; processedUrl: string; onReceipt: (receipt: ReceiptRecord) => void; onList: () => void }) {
  const [extraction, setExtraction] = useState<ReceiptExtraction | null>(props.receipt.extraction);
  const [saving, setSaving] = useState(false);
  const issues = props.receipt.validation?.issues ?? [];

  useEffect(() => setExtraction(props.receipt.extraction), [props.receipt]);

  async function save() {
    if (!extraction) return;
    setSaving(true);
    try {
      const parsed = parseMoneyToCents(extraction.totals.grand_total.raw);
      const next: ReceiptExtraction = {
        ...extraction,
        totals: {
          ...extraction.totals,
          grand_total: { ...extraction.totals.grand_total, cents: parsed?.cents ?? extraction.totals.grand_total.cents }
        }
      };
      const response = await api.updateExtraction(props.receipt.id, next);
      props.onReceipt(response.receipt);
    } finally {
      setSaving(false);
    }
  }

  if (!extraction) {
    return (
      <main className="review-screen">
        <ReceiptPreview src={props.processedUrl} title="Čeks" />
        <EmptyState title="Dati vēl nav nolasīti" text="Ekstrakcija neizdevās vai vēl nav palaista." />
      </main>
    );
  }

  return (
    <main className="review-screen">
      <section className="review-media">
        <ReceiptPreview src={props.processedUrl} title="Apstrādāts čeks" />
      </section>
      <section className="review-fields">
        <div className="review-title">
          <div>
            <h1>Pārbaude</h1>
            <p>{props.receipt.merchantDisplayName ?? "Tirgotājs nav drošs"}</p>
          </div>
          <StatusPill status={props.receipt.status} />
        </div>
        {issues.length ? (
          <WarningBanner tone={issues.some((issue) => issue.severity === "critical") ? "danger" : "warning"}>
            {issues.slice(0, 4).map((issue) => issue.message).join(" ")}
          </WarningBanner>
        ) : (
          <WarningBanner tone="success">Validācija pašlaik neatklāj kritiskas problēmas.</WarningBanner>
        )}
        <FieldGroup title="Tirgotājs">
          <Input label="Tirgotājs" value={extraction.merchant.merchant_display_name ?? ""} onChange={(value) => setExtraction({ ...extraction, merchant: { ...extraction.merchant, merchant_display_name: value || null } })} />
          <Input label="Reģ. nr." value={extraction.merchant.registration_number ?? ""} onChange={(value) => setExtraction({ ...extraction, merchant: { ...extraction.merchant, registration_number: value || null } })} />
          <Input label="PVN nr." value={extraction.merchant.vat_number ?? ""} onChange={(value) => setExtraction({ ...extraction, merchant: { ...extraction.merchant, vat_number: value || null } })} />
        </FieldGroup>
        <FieldGroup title="Čeks">
          <DateField label="Datums" value={normalizeDateInput(extraction.identity.date)} onChange={(value) => setExtraction({ ...extraction, identity: { ...extraction.identity, date: value || null } })} />
          <Input label="Laiks" value={extraction.identity.time ?? ""} onChange={(value) => setExtraction({ ...extraction, identity: { ...extraction.identity, time: value || null } })} />
          <Input label="Čeka nr." value={extraction.identity.receipt_number ?? ""} onChange={(value) => setExtraction({ ...extraction, identity: { ...extraction.identity, receipt_number: value || null } })} />
          <Input label="Valūta" value={extraction.identity.currency ?? ""} onChange={(value) => setExtraction({ ...extraction, identity: { ...extraction.identity, currency: value || null } })} />
        </FieldGroup>
        <FieldGroup title="Summa un maksājums">
          <Input label="Summa" value={extraction.totals.grand_total.raw ?? ""} onChange={(value) => setExtraction({ ...extraction, totals: { ...extraction.totals, grand_total: { ...extraction.totals.grand_total, raw: value } } })} />
          <Input label="PVN" value={extraction.totals.vat_total.raw ?? ""} onChange={(value) => setExtraction({ ...extraction, totals: { ...extraction.totals, vat_total: { ...extraction.totals.vat_total, raw: value } } })} />
          <Input label="Maksājums" value={extraction.payment.payment_method ?? ""} onChange={(value) => setExtraction({ ...extraction, payment: { ...extraction.payment, payment_method: value || null } })} />
        </FieldGroup>
        <LineItemsEditor extraction={extraction} setExtraction={setExtraction} />
        <div className="bottom-actions inline-actions">
          <Button variant="secondary" onClick={() => void api.markNeedsReview(props.receipt.id, "manual").then((response) => props.onReceipt(response.receipt))}>Saglabāt kā jāpārbauda</Button>
          <Button icon={Save} onClick={save} disabled={saving}>Saglabāt</Button>
          <Button icon={Check} onClick={() => void api.verifyReceipt(props.receipt.id).then((response) => props.onReceipt(response.receipt))}>Apstiprināt</Button>
        </div>
        <Button variant="ghost" onClick={props.onList}>Atpakaļ uz sarakstu</Button>
      </section>
    </main>
  );
}

function LineItemsEditor({ extraction, setExtraction }: { extraction: ReceiptExtraction; setExtraction: (value: ReceiptExtraction) => void }) {
  return (
    <Card className="line-items-editor">
      <h2>Pozīcijas</h2>
      {extraction.line_items.length === 0 ? <p className="muted">Pozīcijas nav droši atrastas.</p> : null}
      {extraction.line_items.map((item, index) => (
        <div className="line-item-row" key={`${item.raw_line_text}-${index}`}>
          <Input
            label="Nosaukums"
            value={item.item_name ?? item.raw_line_text}
            onChange={(value) => {
              const line_items = [...extraction.line_items];
              line_items[index] = { ...item, item_name: value, raw_line_text: item.raw_line_text || value };
              setExtraction({ ...extraction, line_items });
            }}
          />
          <Input
            label="Summa"
            value={item.line_total.raw ?? ""}
            onChange={(value) => {
              const line_items = [...extraction.line_items];
              line_items[index] = { ...item, line_total: { ...item.line_total, raw: value, cents: parseMoneyToCents(value)?.cents ?? null } };
              setExtraction({ ...extraction, line_items });
            }}
          />
        </div>
      ))}
    </Card>
  );
}

function ReceiptList(props: {
  receipts: ReceiptRecord[];
  onRefresh: () => void;
  onOpen: (receipt: ReceiptRecord) => void;
  onDelete: (receipt: ReceiptRecord) => void;
  onScan: () => void;
  onResume: (receipt: ReceiptRecord) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ReceiptStatus | "all">("all");
  const filtered = useMemo(() => props.receipts.filter((receipt) => {
    const matchesStatus = status === "all" || receipt.status === status;
    const query = q.toLowerCase();
    const matchesQuery = !query || [receipt.merchantDisplayName, receipt.receiptDate, receipt.grandTotalRaw].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  }), [props.receipts, q, status]);
  const canResume = (receipt: ReceiptRecord) => receipt.files.some((file) => file.kind === "original_image") && !receipt.files.some((file) => file.kind === "processed_image");

  return (
    <main className="list-screen">
      <header className="screen-header row-header">
        <div>
          <h1>Čeki</h1>
          <p>Meklē, filtrē un pārbaudi nolasītos čekus.</p>
        </div>
        <IconButton label="Atsvaidzināt" icon={RefreshCw} onClick={props.onRefresh} />
      </header>
      <div className="filters">
        <Input label="Meklēt" value={q} onChange={setQ} placeholder="Tirgotājs, datums, summa" />
        <Select
          label="Statuss"
          value={status}
          onChange={(value) => setStatus(value as ReceiptStatus | "all")}
          options={[
            { value: "all", label: "Visi" },
            { value: "uploaded", label: "Augšupielādēts" },
            { value: "needs_review", label: "Jāpārbauda" },
            { value: "verified", label: "Verificēts" },
            { value: "failed", label: "Kļūda" }
          ]}
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="Nav čeku" text="Sāc ar pirmo skenēšanu vai augšupielādi." action={<Button icon={Camera} onClick={props.onScan}>Skenēt čeku</Button>} />
      ) : (
        <div className="receipt-list">
          {filtered.map((receipt) => (
            <Card key={receipt.id}>
              <div className={`receipt-list-item ${canResume(receipt) ? "has-resume" : ""}`}>
                <RowLink onClick={() => props.onOpen(receipt)}>
                  <div className="receipt-row">
                    <div>
                      <strong>{receipt.merchantDisplayName ?? "Nezināms tirgotājs"}</strong>
                      <span>{receipt.receiptDate ?? "Datums nav drošs"}</span>
                    </div>
                    <div>
                      <StatusPill status={receipt.status} />
                      <strong>{formatCents(receipt.grandTotalCents, receipt.currency ?? "EUR")}</strong>
                    </div>
                  </div>
                </RowLink>
                {canResume(receipt) ? (
                  <button className="receipt-action-button" type="button" onClick={() => props.onResume(receipt)} aria-label="Apstrādāt čeku" title="Apstrādāt čeku">
                    <WandSparkles aria-hidden="true" size={20} />
                  </button>
                ) : null}
                <button className="receipt-delete-button" type="button" onClick={() => props.onDelete(receipt)} aria-label="Dzēst čeku" title="Dzēst čeku">
                  <Trash2 aria-hidden="true" size={20} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <button className="floating-scan" type="button" onClick={props.onScan} aria-label="Skenēt čeku">
        <Camera size={24} />
      </button>
    </main>
  );
}

function ReceiptDetail(props: {
  receipt: ReceiptRecord;
  originalUrl: string;
  processedUrl: string;
  pdfUrl: string;
  onBack: () => void;
  onRefresh: () => void;
  onReview: () => void;
  onResume: (receipt: ReceiptRecord) => void;
  onDelete: (receipt: ReceiptRecord) => void;
}) {
  const canResume = props.receipt.files.some((file) => file.kind === "original_image") && !props.receipt.files.some((file) => file.kind === "processed_image");
  const lastIssue = props.receipt.failureReason ?? props.receipt.validation?.issues[0]?.message ?? null;
  const rawAiFile = props.receipt.files.find((file) => file.kind === "raw_ai_response_json");

  return (
    <main className="detail-screen">
      <header className="screen-header row-header">
        <div>
          <h1>{props.receipt.merchantDisplayName ?? "Čeka detaļas"}</h1>
          <p>{props.receipt.receiptDate ?? "Datums nav drošs"} · {formatCents(props.receipt.grandTotalCents, props.receipt.currency ?? "EUR")}</p>
        </div>
        <div className="detail-actions">
          <IconButton label="Atpakaļ" icon={ArrowLeft} onClick={props.onBack} />
          <IconButton label="Atsvaidzināt" icon={RefreshCw} onClick={props.onRefresh} />
          <StatusPill status={props.receipt.status} />
          {canResume ? <Button variant="secondary" icon={WandSparkles} onClick={() => props.onResume(props.receipt)}>Apstrādāt</Button> : null}
          <Button variant="danger" icon={Trash2} onClick={() => props.onDelete(props.receipt)}>Dzēst</Button>
        </div>
      </header>
      {canResume ? (
        <WarningBanner>
          Šim čekam ir saglabāts oriģināls, bet nav pabeigta attēla apstrāde. Spied “Apstrādāt”, lai turpinātu no oriģinālā faila.
        </WarningBanner>
      ) : null}
      {lastIssue ? <WarningBanner tone={props.receipt.status === "failed" ? "danger" : "warning"}>{lastIssue}</WarningBanner> : null}
      <div className="detail-grid">
        <ReceiptPreview src={props.originalUrl} title="Oriģināls" />
        <ReceiptPreview src={props.processedUrl} title="Apstrādāts attēls" />
      </div>
      {props.pdfUrl ? <a className="pdf-link" href={props.pdfUrl} target="_blank" rel="noreferrer">Atvērt PDF</a> : null}
      <ReceiptSummary receipt={props.receipt} />
      <JsonPanel title="Validācija" data={props.receipt.validation ?? {}} defaultOpen={Boolean(props.receipt.validation?.issues.length)} />
      <JsonPanel title="Strukturētais AI JSON" data={props.receipt.extraction ?? {}} />
      {rawAiFile ? <a className="pdf-link secondary-link" href={fileUrl(props.receipt.id, rawAiFile.id)} target="_blank" rel="noreferrer">Atvērt raw AI atbildi</a> : null}
      <Card>
        <h2>Audit log</h2>
        {props.receipt.auditLog.length === 0 ? <p className="muted">Nav ierakstu.</p> : null}
        {props.receipt.auditLog.map((entry) => (
          <div className="audit-row" key={entry.id}>
            <strong>{entry.action}</strong>
            <span>{new Date(entry.createdAt).toLocaleString("lv-LV")}</span>
          </div>
        ))}
      </Card>
      <Button icon={ListFilter} onClick={props.onReview}>Labot</Button>
    </main>
  );
}

function AiDebugScreen() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<AiDebugResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function selectFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setPreviewUrl(await fileToObjectUrl(nextFile));
    setResult(null);
    setError("");
  }

  async function runDebug() {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      setResult(await api.debugAi(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI tests neizdevās.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="ai-debug-screen">
      <header className="screen-header row-header">
        <div>
          <h1>AI tests</h1>
          <p>Nosūti vienu bildi backend AI servisam un pārbaudi tieši to, ko modelis atgriež.</p>
        </div>
        <IconButton label="Atsvaidzināt" icon={RefreshCw} onClick={() => { setResult(null); setError(""); }} />
      </header>
      <div className="debug-layout">
        <Card className="debug-upload-card">
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/jpeg,image/png"
            onChange={(event) => {
              void selectFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <div className="debug-actions">
            <Button icon={Upload} variant="secondary" onClick={() => inputRef.current?.click()}>Izvēlēties bildi</Button>
            <Button icon={Send} onClick={runDebug} disabled={!file || loading}>{loading ? "Sūta..." : "Sūtīt AI"}</Button>
          </div>
          {file ? (
            <div className="debug-file">
              <strong>{file.name}</strong>
              <span>{file.type || "image"} · {Math.round(file.size / 1024)} KB</span>
            </div>
          ) : (
            <p className="muted">Izvēlies JPG vai PNG čeka bildi. Atslēga un modelis paliek tikai serverī.</p>
          )}
          {previewUrl ? <ReceiptPreview src={previewUrl} title="Nosūtāmā bilde" /> : null}
        </Card>
        <section className="debug-result">
          {error ? <WarningBanner tone="danger">{error}</WarningBanner> : null}
          {!result && !error ? <EmptyState title="AI atbilde vēl nav palaista" text="Te būs modelis, raw atbilde, strukturētais JSON un validācija." /> : null}
          {result ? <AiDebugResultView result={result} /> : null}
        </section>
      </div>
    </main>
  );
}

function AiDebugResultView({ result }: { result: AiDebugResponse }) {
  const extraction = result.extraction;
  const issues = result.validation?.issues ?? [];
  return (
    <div className="debug-result-stack">
      <Card className="summary-card">
        <div className="review-title">
          <div>
            <h2>{result.ok ? "AI atbilde saņemta" : "AI kļūda"}</h2>
            <p>{result.provider} · {result.model} · {result.ms} ms</p>
          </div>
          <span className={`status-pill ${result.ok ? "status-verified" : "status-failed"}`}>{result.ok ? "OK" : "Kļūda"}</span>
        </div>
        {result.error ? <WarningBanner tone="danger">{result.error.message} ({result.error.code})</WarningBanner> : null}
        {extraction ? (
          <div className="summary-grid">
            <SummaryTile label="Tirgotājs" value={extraction.merchant.merchant_display_name ?? extraction.merchant.legal_company_name ?? "nav atrasts"} />
            <SummaryTile label="Datums" value={extraction.identity.date ?? "nav atrasts"} />
            <SummaryTile label="Summa" value={extraction.totals.grand_total.raw ?? "nav atrasta"} />
            <SummaryTile label="Pozīcijas" value={String(extraction.line_items.length)} />
          </div>
        ) : null}
      </Card>
      {issues.length ? (
        <WarningBanner tone={issues.some((issue) => issue.severity === "critical") ? "danger" : "warning"}>
          {issues.slice(0, 5).map((issue) => issue.message).join(" ")}
        </WarningBanner>
      ) : result.ok ? (
        <WarningBanner tone="success">Lokālā validācija neatgrieza kritiskus brīdinājumus.</WarningBanner>
      ) : null}
      <JsonPanel title="Raw AI response" data={result.rawResponse ?? result.error ?? {}} defaultOpen={!result.ok} />
      <JsonPanel title="Strukturētais JSON" data={result.extraction ?? {}} defaultOpen={result.ok} />
      <JsonPanel title="Lokālā validācija" data={result.validation ?? {}} defaultOpen={Boolean(issues.length)} />
    </div>
  );
}

function ReceiptSummary({ receipt }: { receipt: ReceiptRecord }) {
  return (
    <Card className="summary-card">
      <h2>Kopsavilkums</h2>
      <div className="summary-grid">
        <SummaryTile label="Statuss" value={receipt.status} />
        <SummaryTile label="Tirgotājs" value={receipt.merchantDisplayName ?? "nav drošs"} />
        <SummaryTile label="Datums" value={receipt.receiptDate ?? "nav drošs"} />
        <SummaryTile label="Summa" value={formatCents(receipt.grandTotalCents, receipt.currency ?? "EUR")} />
      </div>
    </Card>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function JsonPanel({ title, data, defaultOpen = false }: { title: string; data: unknown; defaultOpen?: boolean }) {
  return (
    <details className="json-panel" open={defaultOpen}>
      <summary>{title}</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

function SettingsScreen() {
  const [check, setCheck] = useState<unknown>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.systemCheck().then((response) => setCheck(response)).catch((err) => setError(err instanceof Error ? err.message : "Health check neizdevās."));
  }, []);

  return (
    <main className="settings-screen">
      <header className="screen-header">
        <h1>Sistēmas pārbaude</h1>
        <p>Konfigurācijas statuss bez slepenu vērtību rādīšanas.</p>
      </header>
      {error ? <WarningBanner tone="danger">{error}</WarningBanner> : null}
      <JsonPanel title="Sistēmas statuss" data={check ?? { loading: true }} defaultOpen />
    </main>
  );
}

function mergeQuality(a: ImageQualityReport, b: ImageQualityReport): ImageQualityReport {
  return {
    ...b,
    edgeConfidence: a.edgeConfidence,
    warnings: Array.from(new Set([...a.warnings, ...b.warnings]))
  };
}

function normalizeDateInput(value: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(value);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nearestCornerIndex(pointer: Point, corners: Point[]): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  corners.forEach((corner, index) => {
    const distance = Math.hypot(corner.x - pointer.x, corner.y - pointer.y);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function insetInitialCorners(corners: Point[], width: number, height: number): Point[] {
  const minX = width * 0.07;
  const maxX = width * 0.93;
  const minY = height * 0.07;
  const maxY = height * 0.93;
  return corners.map((point) => ({
    x: clamp(point.x, minX, maxX),
    y: clamp(point.y, minY, maxY)
  }));
}
