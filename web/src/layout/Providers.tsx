"use client";

import { ThemeProvider } from "@/context/ThemeContext";
import { I18nProvider } from "@/context/I18nContext";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider>
            <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
    );
}
