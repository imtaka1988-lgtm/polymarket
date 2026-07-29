import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Event Forecast Lab',
  description: 'Entertainment forecasting platform engineering baseline.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
