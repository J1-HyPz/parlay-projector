import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const siteUrl = new URL(process.env.SITE_URL ?? 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: 'Parlay Projector by HyPz',
  description: 'A responsive multi-sport analytics and future parlay projection interface.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Parlay Projector by HyPz',
    description: 'Multi-sport analytics, reimagined.',
    type: 'website',
    images: [{ url: '/og.png', width: 1792, height: 947, alt: 'Parlay Projector by HyPz' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Parlay Projector by HyPz',
    description: 'Multi-sport analytics, reimagined.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
