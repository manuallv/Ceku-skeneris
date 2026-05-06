import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ClipboardList,
  FileImage,
  Flashlight,
  ListFilter,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Upload,
  WandSparkles
} from "lucide-react";
import { api, fileUrl } from "./api";
import {
  captureVideoFrame,
  detectReceipt,
  fileToObjectUrl,
  percentToPoint,
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
  ProgressStepper,
  ReceiptPreview,
  RowLink,
  ScannerFrame,
  Select,
  StatusPill,
  Toast,
  WarningBanner
} from "./components";
import { formatCents, parseMoneyToCents } from "../shared/money";
import type { ImageQualityReport, ReceiptExtraction, ReceiptRecord, ReceiptStatus } from "../shared/receiptTypes";

type View = "welcome" | "scanner" | "crop" | "processing" | "review" | "list" | "detail" | "settings";

const stages = ["Augšupielāde", "Attēla apstrāde", "PDF izveide", "Čeka nolasīšana", "Datu validācija", "Saglabāšana datubāzē"];

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
  const [processingStage, setProcessingStage] = useState(0);

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

  async function handleFileSelected(file: File) {
    try {
      setProcessingStage(0);
      setOriginalFile(file);
      setOriginalUrl(await fileToObjectUrl(file));
      const upload = await api.uploadReceipt(file);
      setActiveReceipt(upload.receipt);
      setProcessingStage(1);
      const detected = await detectReceipt(file);
      setDetection(detected);
      setCorners(detected.corners.map((point) => pointToPercent(point, detected.imageWidth, detected.imageHeight)));
      setView("crop");
      void refreshReceipts();
    } catch (error) {
      showError(error);
    }
  }

  async function straightenReceipt() {
    if (!originalFile || !detection) return;
    try {
      const actualCorners = corners.map((point) => percentToPoint(point, detection.imageWidth, detection.imageHeight));
      const result = await processReceiptImage(originalFile, actualCorners);
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
    try {
      setView("processing");
      setProcessingStage(1);
      let blob = processedBlob;
      let quality = detection.quality;
      if (!blob) {
        const actualCorners = corners.map((point) => percentToPoint(point, detection.imageWidth, detection.imageHeight));
        const processed = await processReceiptImage(originalFile, actualCorners);
        blob = processed.blob;
        quality = mergeQuality(quality, processed.quality);
        setProcessedBlob(blob);
        setProcessedUrl(processed.dataUrl);
      }

      setProcessingStage(2);
      const processed = await api.processReceipt(activeReceipt.id, blob, quality, corners);
      setActiveReceipt(processed.receipt);
      setProcessingStage(3);
      const extracted = await api.extractReceipt(activeReceipt.id);
      setProcessingStage(5);
      setActiveReceipt(extracted.receipt);
      setView("review");
      showToast(extracted.receipt.status === "verified" ? "Čeks verificēts." : "Čeks saglabāts kā jāpārbauda.");
      void refreshReceipts();
    } catch (error) {
      setView("review");
      showError(error);
      if (activeReceipt) {
        const latest = await api.getReceipt(activeReceipt.id).catch(() => null);
        if (latest) setActiveReceipt(latest.receipt);
      }
    }
  }

  function showToast(message: string) {
    setToast({ message });
    window.setTimeout(() => setToast(null), 3500);
  }

  function showError(error: unknown) {
    setToast({ message: error instanceof Error ? error.message : "Darbība neizdevās.", tone: "danger" });
  }

  const uploadInput = (
    <input
      className="sr-only"
      id="receipt-upload"
      type="file"
      accept="image/jpeg,image/png"
      capture="environment"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void handleFileSelected(file);
        event.currentTarget.value = "";
      }}
    />
  );

  return (
    <div className="app-shell">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {uploadInput}
      {view !== "scanner" && view !== "crop" && view !== "processing" ? (
        <nav className="top-nav" aria-label="Galvenā navigācija">
          <button type="button" onClick={() => setView("welcome")}>Čeku skeneris</button>
          <div>
            <IconButton label="Saraksts" icon={ClipboardList} onClick={() => { setView("list"); void refreshReceipts(); }} />
            <IconButton label="Iestatījumi" icon={Settings} onClick={() => setView("settings")} />
          </div>
        </nav>
      ) : null}

      {view === "welcome" ? (
        <WelcomeScreen onScan={() => setView("scanner")} onUpload={() => document.getElementById("receipt-upload")?.click()} />
      ) : null}
      {view === "scanner" ? <ScannerScreen onClose={() => setView("welcome")} onCapture={handleFileSelected} onUpload={() => document.getElementById("receipt-upload")?.click()} /> : null}
      {view === "crop" && detection ? (
        <CropScreen
          imageUrl={originalUrl}
          detection={detection}
          corners={corners}
          processedUrl={processedUrl}
          setCorners={setCorners}
          onStraighten={straightenReceipt}
          onRetake={() => setView("scanner")}
          onContinue={continueProcessing}
        />
      ) : null}
      {view === "processing" ? <ProcessingScreen active={processingStage} /> : null}
      {view === "review" && activeReceipt ? (
        <ReviewScreen receipt={activeReceipt} processedUrl={processedUrl || (activeProcessedFile ? fileUrl(activeReceipt.id, activeProcessedFile.id) : "")} onReceipt={setActiveReceipt} onList={() => { setView("list"); void refreshReceipts(); }} />
      ) : null}
      {view === "list" ? (
        <ReceiptList receipts={receipts} onRefresh={refreshReceipts} onOpen={(receipt) => { setActiveReceipt(receipt); setView("detail"); }} onScan={() => setView("scanner")} />
      ) : null}
      {view === "detail" && activeReceipt ? (
        <ReceiptDetail receipt={activeReceipt} originalUrl={activeOriginalFile ? fileUrl(activeReceipt.id, activeOriginalFile.id) : ""} processedUrl={activeProcessedFile ? fileUrl(activeReceipt.id, activeProcessedFile.id) : ""} pdfUrl={activePdfFile ? fileUrl(activeReceipt.id, activePdfFile.id) : ""} onReview={() => setView("review")} />
      ) : null}
      {view === "settings" ? <SettingsScreen /> : null}
    </div>
  );
}

function WelcomeScreen(props: {
  onScan: () => void;
  onUpload: () => void;
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
        </div>
      </Card>
    </main>
  );
}

function ScannerScreen(props: { onClose: () => void; onCapture: (file: File) => void; onUpload: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 2560 } }, audio: false })
      .then((stream) => {
        if (!alive) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setReady(true);
        }
      })
      .catch(() => setError("Kameru neizdevās atvērt. Izmanto galerijas augšupielādi."));
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    if (!track || !capabilities?.torch) return;
    await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
    setTorchOn(!torchOn);
  }

  async function capture() {
    if (!videoRef.current) return;
    props.onCapture(await captureVideoFrame(videoRef.current));
  }

  return (
    <main className="scanner-screen">
      <video ref={videoRef} autoPlay playsInline muted />
      <ScannerFrame />
      <div className="scanner-guidance">Novieto čeku rāmī</div>
      {error ? <div className="scanner-error">{error}</div> : null}
      <div className="scanner-top">
        <IconButton label="Aizvērt" icon={RotateCcw} onClick={props.onClose} />
        <IconButton label="Zibspuldze" icon={Flashlight} onClick={toggleTorch} />
      </div>
      <div className="scanner-actions">
        <Button variant="secondary" icon={Upload} onClick={props.onUpload}>Galerija</Button>
        <button className="capture-button" type="button" aria-label="Uzņemt čeku" onClick={capture} disabled={!ready} />
      </div>
    </main>
  );
}

function CropScreen(props: {
  imageUrl: string;
  detection: DetectionResult;
  corners: Point[];
  processedUrl: string;
  setCorners: (points: Point[]) => void;
  onStraighten: () => void;
  onRetake: () => void;
  onContinue: () => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const warnings = props.detection.quality.warnings;

  function updateCorner(event: React.PointerEvent, index: number) {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = [...props.corners];
    next[index] = {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
    };
    props.setCorners(next);
  }

  return (
    <main className="crop-screen">
      <header className="screen-header">
        <h1>Iztaisnot čeku</h1>
        <p>Pārbaudi stūrus pirms nolasīšanas.</p>
      </header>
      {warnings.length ? <WarningBanner>{warnings.join(" ")}</WarningBanner> : null}
      <div className="crop-layout">
        <div className="crop-canvas">
          <img ref={imageRef} src={props.imageUrl} alt="Uzņemtais čeks" />
          <svg className="crop-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={props.corners.map((point) => `${point.x},${point.y}`).join(" ")} />
          </svg>
          {props.corners.map((point, index) => (
            <button
              className="corner-handle"
              key={index}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              type="button"
              aria-label={`Stūris ${index + 1}`}
              onPointerDown={(event) => {
                setDragIndex(index);
                updateCorner(event, index);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragIndex === index) updateCorner(event, index);
              }}
              onPointerUp={() => setDragIndex(null)}
            />
          ))}
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

function ProcessingScreen({ active }: { active: number }) {
  return (
    <main className="processing-screen">
      <Card>
        <div className="processing-ring" aria-hidden="true" />
        <h1>Apstrādājam čeku</h1>
        <p>Dati tiks saglabāti tikai pēc stingras validācijas.</p>
        <ProgressStepper stages={stages} active={active} />
      </Card>
    </main>
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

function ReceiptList(props: { receipts: ReceiptRecord[]; onRefresh: () => void; onOpen: (receipt: ReceiptRecord) => void; onScan: () => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ReceiptStatus | "all">("all");
  const filtered = useMemo(() => props.receipts.filter((receipt) => {
    const matchesStatus = status === "all" || receipt.status === status;
    const query = q.toLowerCase();
    const matchesQuery = !query || [receipt.merchantDisplayName, receipt.receiptDate, receipt.grandTotalRaw].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  }), [props.receipts, q, status]);

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

function ReceiptDetail(props: { receipt: ReceiptRecord; originalUrl: string; processedUrl: string; pdfUrl: string; onReview: () => void }) {
  return (
    <main className="detail-screen">
      <header className="screen-header row-header">
        <div>
          <h1>{props.receipt.merchantDisplayName ?? "Čeka detaļas"}</h1>
          <p>{props.receipt.receiptDate ?? "Datums nav drošs"} · {formatCents(props.receipt.grandTotalCents, props.receipt.currency ?? "EUR")}</p>
        </div>
        <StatusPill status={props.receipt.status} />
      </header>
      <div className="detail-grid">
        <ReceiptPreview src={props.originalUrl} title="Oriģināls" />
        <ReceiptPreview src={props.processedUrl} title="Apstrādāts attēls" />
      </div>
      {props.pdfUrl ? <a className="pdf-link" href={props.pdfUrl} target="_blank" rel="noreferrer">Atvērt PDF</a> : null}
      <Card>
        <h2>Validācija</h2>
        <pre>{JSON.stringify(props.receipt.validation ?? {}, null, 2)}</pre>
      </Card>
      <Card>
        <h2>Raw dati</h2>
        <pre>{JSON.stringify(props.receipt.extraction ?? {}, null, 2)}</pre>
      </Card>
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
      <Card>
        <pre>{JSON.stringify(check ?? { loading: true }, null, 2)}</pre>
      </Card>
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
