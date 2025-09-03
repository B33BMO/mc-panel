"use client";
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  // richColors = nicer defaults; theme=dark fits our UI
  return <SonnerToaster richColors theme="dark" closeButton />;
}
