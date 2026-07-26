import type { ComponentProps } from "react";
import type { Badge } from "../components/ui/badge";

export function statusVariant(status: string): ComponentProps<typeof Badge>["variant"] {
  if (status === "completed") return "success";
  if (status === "running" || status === "retrying") return "secondary";
  if (status === "escalated") return "warning";
  if (status === "failed" || status === "aborted") return "destructive";
  return "outline";
}

export function statusLabel(status: string): string {
  if (status === "sin_iniciar") return "Sin iniciar";
  return status;
}
