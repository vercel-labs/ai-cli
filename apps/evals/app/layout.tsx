import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppHeader } from '@/components/app-header';
import { AppShell } from '@/components/app-shell';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'AI CLI Evals',
  description: 'Run and monitor eval suites for ai-cli',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <div className="sticky top-0 z-50 bg-background">
            <AppHeader />
          </div>
          <main className="h-[calc(100vh-3rem)]">
            <AppShell>{children}</AppShell>
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
