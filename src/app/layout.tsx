import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { AppProviders } from '@/providers/app-providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'OpenRouter Chat',
  description: 'Resumable streaming chat powered by OpenRouter',
};
const RootLayout = async ({ children }: Readonly<{ children: React.ReactNode }>) => {
  const messages = await getMessages();
  return (
    <html lang="ko">
      <body>
        <NextIntlClientProvider locale="ko" messages={messages}>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
};
export default RootLayout;
