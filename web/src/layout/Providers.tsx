"use client";

import { ThemeProvider } from "@/context/ThemeContext";
import { I18nProvider } from "@/context/I18nContext";
import { ViewportScaleProvider } from "@/components/ViewportScaleProvider";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider>
            <I18nProvider>
                <ViewportScaleProvider>{children}</ViewportScaleProvider>
            </I18nProvider>
        </ThemeProvider>
    );
}
