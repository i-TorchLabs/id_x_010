import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // output: "export",
    // basePath: "/f",
    async redirects() {
        return [
            {
                source: "/",
                destination: "/f/login",
                permanent: false,
            },
            {
                source: "/admin",
                destination: "/f/admin-home",
                permanent: false,
            },
            {
                source: "/f/home",
                destination: "/f/user-home",
                permanent: false,
            },
        ];
    },
    allowedDevOrigins: ["*"],
};

export default nextConfig;
