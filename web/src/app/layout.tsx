import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invoice Review",
  description: "Review supplier invoices read by AI before they are paid.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
