import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { readRuntimeConfiguration } from '@/lib/runtime-config';
import './globals.css';

export const metadata: Metadata = {
  title: 'R2RPC 控制台',
  description: '设备侧 RPC 中继平台管理控制台',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const runtimeConfiguration = JSON.stringify(
    readRuntimeConfiguration(),
  ).replace(/</g, '\\u003c');
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__R2RPC_CONFIG__=${runtimeConfiguration};`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
