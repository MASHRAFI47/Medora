import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Medora — Multi-Hospital Online Prescription Platform",
  description:
    "Medora gives patients and healthcare teams one clear, secure place to send, review, and track prescriptions across participating hospitals and pharmacies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="medora" className={plusJakarta.variable}>
      <body className="font-sans text-medora-navy antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
