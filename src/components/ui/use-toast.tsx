"use client";
import { toast as sonner } from "sonner";

type ToastArgs = {
  title?: string;
  description?: string;
} & Record<string, unknown>; // forward extras to sonner without `any`

export function useToast() {
  return {
    toast: ({ title, description, ...opts }: ToastArgs = {}) => {
      if (title && description) return sonner(String(title), { description, ...opts });
      if (title) return sonner(String(title), opts);
      if (description) return sonner(String(description), opts);
      return sonner("Done", opts);
    },
  };
}
