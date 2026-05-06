import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import type { ReceiptStatus } from "../shared/receiptTypes";

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  icon?: LucideIcon;
  full?: boolean;
}) {
  const Icon = props.icon;
  return (
    <button
      className={`button button-${props.variant ?? "primary"} ${props.full ? "button-full" : ""}`}
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {Icon ? <Icon aria-hidden="true" size={20} /> : null}
      <span>{props.children}</span>
    </button>
  );
}

export function IconButton(props: { label: string; icon: LucideIcon; onClick?: () => void; disabled?: boolean }) {
  const Icon = props.icon;
  return (
    <button className="icon-button" type="button" aria-label={props.label} title={props.label} onClick={props.onClick} disabled={props.disabled}>
      <Icon aria-hidden="true" size={21} />
    </button>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <section className={`card ${props.className ?? ""}`}>{props.children}</section>;
}

export function Input(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} type={props.type ?? "text"} placeholder={props.placeholder} inputMode={props.inputMode} />
    </label>
  );
}

export function Select(props: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusPill({ status }: { status: ReceiptStatus }) {
  const labels: Record<ReceiptStatus, string> = {
    uploaded: "Augšupielādēts",
    image_processed: "Attēls apstrādāts",
    extracted: "Nolasīts",
    needs_review: "Jāpārbauda",
    verified: "Verificēts",
    failed: "Kļūda"
  };
  return <span className={`status-pill status-${status}`}>{labels[status]}</span>;
}

export function WarningBanner({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "danger" | "success" }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : AlertTriangle;
  return (
    <div className={`warning-banner warning-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon aria-hidden="true" size={20} />
      <div>{children}</div>
    </div>
  );
}

export function ReceiptPreview(props: { src?: string; title?: string; collapsible?: boolean }) {
  return (
    <figure className="receipt-preview">
      {props.title ? <figcaption>{props.title}</figcaption> : null}
      {props.src ? <img src={props.src} alt={props.title ?? "Čeka priekšskatījums"} /> : <SkeletonLoader label="Nav priekšskatījuma" />}
    </figure>
  );
}

export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="field-group">
      <h2>{title}</h2>
      <div className="field-grid">{children}</div>
    </Card>
  );
}

export function MoneyField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <Input label={props.label} value={props.value} onChange={props.onChange} inputMode="decimal" />;
}

export function DateField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <Input label={props.label} type="date" value={props.value} onChange={props.onChange} />;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Toast({ message, tone = "success" }: { message: string; tone?: "success" | "danger" }) {
  return <div className={`toast toast-${tone}`}>{message}</div>;
}

export function SkeletonLoader({ label }: { label: string }) {
  return <div className="skeleton-loader" aria-label={label} />;
}

export function Sheet({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="sheet">
        <div className="sheet-header">
          <h2 id="sheet-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Aizvērt">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="row-link" type="button" onClick={onClick}>
      <span>{children}</span>
      <ChevronRight aria-hidden="true" size={18} />
    </button>
  );
}
