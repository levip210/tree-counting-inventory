"use client";

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="row">
          <button
            className="btn ghost"
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ color: "#1b1710" }}
          >
            Cancel
          </button>
          <button
            className={`btn ${danger ? "danger" : "gold"}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
