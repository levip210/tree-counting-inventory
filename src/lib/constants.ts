export const APP_NAME = "Powers Tree Farm Counting";
export const APP_SHORT = "PTF Count";
export const FARM_PLACE = "Lansing, NC — Wholesale Fraser Fir";
export const TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";

export const SUGGESTED_SIZES = ["5–6", "6–7", "7–8", "8–9", "9–10", "10+"];
export const SUGGESTED_GRADES = ["Premium", "#1", "#2"];

export const ACTIONS = {
  YARD: "Yard Received",
  SHIP: "Shipped",
} as const;

export type ActionType = (typeof ACTIONS)[keyof typeof ACTIONS];
export type CounterAccess = "yard" | "shipping" | "both";
export type Role = "admin" | "counter";

export const PIN_MIN = 4;
export const PIN_MAX = 10;
export const DOUBLE_TAP_MS = 250;
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export const CHECKLIST_STEPS = [
  { id: "farms", label: "Add farms", href: "/admin/farms" },
  { id: "sizes", label: "Add / confirm tree sizes", href: "/admin/sizes" },
  { id: "grades", label: "Add / confirm tree grades", href: "/admin/grades" },
  { id: "order", label: "Arrange display order", href: "/admin/sizes" },
  { id: "counters", label: "Create counter-access accounts", href: "/admin/counters" },
  { id: "receiving", label: "Test Yard Receiving", href: "/receiving" },
  { id: "shipping", label: "Test Shipping", href: "/shipping" },
  { id: "feedback", label: "Test sound and vibration", href: "/admin/feedback" },
  { id: "offline", label: "Test offline counting", href: "/admin/feedback" },
  { id: "excel", label: "Find Excel export settings", href: "/admin/export" },
] as const;

export const INVENTORY_DISCLAIMER =
  "Inventory here is category counting only: Yard trees ≈ Received − Shipped for each size and grade. This is not a full inventory-management system. It does not track individual trees, lots, or customer orders.";
