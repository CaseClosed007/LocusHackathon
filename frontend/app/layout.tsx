import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Locus Auto-Heal | Autonomous Deployment Agent",
  description:
    "Deploy anything with a sentence. AI writes, deploys, and auto-heals your application on Locus PaaS.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jetBrainsMono.variable}>
      <body className="bg-gray-950 antialiased">{children}</body>
    </html>
  );
}
