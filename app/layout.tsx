import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conferência Laboratorial",
  description:
    "Conciliação de coletas e cobranças laboratoriais com revisão auditável.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
