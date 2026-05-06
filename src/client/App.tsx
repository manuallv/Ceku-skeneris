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
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import { api, fileUrl } from "./api";
import {
  captureVideoFrame,
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
  const [processingStage, setProcessingStage] = useState(0);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);

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
    setView("scanner");
    showToast("Čeks apstrādājas fonā. Vari skenēt nākamo.");
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
    setProcessingStage(0);
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
      {backgroundJobs.length ? <BackgroundProcessingBadge jobs={backgroundJobs} /> : null}
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
        <ReceiptList receipts={receipts} onRefresh={refreshReceipts} onOpen={(receipt) => { setActiveReceipt(receipt); setView("detail"); }} onDelete={deleteReceipt} onScan={() => setView("scanner")} />
      ) : null}
      {view === "detail" && activeReceipt ? (
        <ReceiptDetail receipt={activeReceipt} originalUrl={activeOriginalFile ? fileUrl(activeReceipt.id, activeOriginalFile.id) : ""} processedUrl={activeProcessedFile ? fileUrl(activeReceipt.id, activeProcessedFile.id) : ""} pdfUrl={activePdfFile ? fileUrl(activeReceipt.id, activePdfFile.id) : ""} onReview={() => setView("review")} onDelete={deleteReceipt} />
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
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    let alive = true;
    const browserMediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;

    async function startCamera() {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setReady(false);
      setTorchOn(false);
      setError("");
      try {
        const video: MediaTrackConstraints = {
          width: { ideal: 1920 },
          height: { ideal: 2560 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } })
        };
        const stream = await browserMediaDevices?.getUserMedia({ video, audio: false });
        if (!stream) throw new Error("camera_unavailable");
        if (!alive) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setReady(true);
        }
        const available = await browserMediaDevices.enumerateDevices?.() ?? [];
        if (alive) setDevices(available.filter((device) => device.kind === "videoinput"));
      } catch {
        if (alive) setError("Kameru neizdevās atvērt. Izmanto galerijas augšupielādi.");
      }
    }

    void startCamera();

    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

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
        <div className="scanner-controls">
          {devices.length > 1 ? (
            <label className="camera-select">
              <span>Kamera</span>
              <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} aria-label="Izvēlēties kameru">
                <option value="">Auto</option>
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Kamera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <IconButton label="Zibspuldze" icon={Flashlight} onClick={toggleTorch} />
        </div>
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
      <header className="screen-header">
        <h1>Iztaisnot čeku</h1>
        <p>Pārbaudi stūrus pirms nolasīšanas.</p>
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

function ReceiptList(props: { receipts: ReceiptRecord[]; onRefresh: () => void; onOpen: (receipt: ReceiptRecord) => void; onDelete: (receipt: ReceiptRecord) => void; onScan: () => void }) {
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
              <div className="receipt-list-item">
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

function ReceiptDetail(props: { receipt: ReceiptRecord; originalUrl: string; processedUrl: string; pdfUrl: string; onReview: () => void; onDelete: (receipt: ReceiptRecord) => void }) {
  return (
    <main className="detail-screen">
      <header className="screen-header row-header">
        <div>
          <h1>{props.receipt.merchantDisplayName ?? "Čeka detaļas"}</h1>
          <p>{props.receipt.receiptDate ?? "Datums nav drošs"} · {formatCents(props.receipt.grandTotalCents, props.receipt.currency ?? "EUR")}</p>
        </div>
        <div className="detail-actions">
          <StatusPill status={props.receipt.status} />
          <Button variant="danger" icon={Trash2} onClick={() => props.onDelete(props.receipt)}>Dzēst</Button>
        </div>
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
