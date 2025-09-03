import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "MC Multi-Server Panel",
  description: "Control multiple Minecraft servers with RCON, logs, and stats",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className="mx-auto max-w-7xl p-6">{children}</div>
      </body>
    </html>
  );
}
