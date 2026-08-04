import type { Metadata } from "next";
import { Providers } from "@/layout/Providers";
import "@/assets/styles/globals.css";

export const metadata: Metadata = {
    title: "SME AI Labs",
    description:
        "Natural language Q&A, database retrieval, and executable code generation powered by advanced AI.",
    icons: {
        icon: "/favicon.ico",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="antialiased">
            <body className="h-screen overflow-hidden">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
