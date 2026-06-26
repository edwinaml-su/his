import type { Metadata } from "next";
import "@his/ui/globals.css";
import { Providers } from "./providers";
import { UppercaseEnforcer } from "@/components/uppercase-enforcer";

export const metadata: Metadata = {
  title: "HIS Avante",
  description: "Sistema de Información Hospitalaria — Inversiones Avante",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-SV" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <UppercaseEnforcer />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
