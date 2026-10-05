import { THEME_SCRIPT, themeRootProps, type ThemePreference } from '@adili/ui';
import { HeadContent, Scripts, ScriptOnce } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** The page shell: `<html>` with the theme, the head and the router's scripts. */
export function RootDocument({
  theme,
  children,
}: Readonly<{ theme: ThemePreference; children: ReactNode }>) {
  return (
    // An explicit choice is on <html> from the server; the head script handles `system` and
    // later changes, so the attributes may differ by hydration.
    <html lang="en" suppressHydrationWarning {...themeRootProps(theme)}>
      <head>
        {/*
         * Sets the theme before the first paint: the shared cookie's choice, or the device's.
         * Server-rendered with the request's CSP nonce, without which the browser blocks it.
         */}
        <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
        <HeadContent />
      </head>
      <body>
        <div className="flex min-h-dvh flex-col">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
