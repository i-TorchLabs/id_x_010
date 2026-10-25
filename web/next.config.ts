import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // output: "export",
    // basePath: "/f",
    async redirects() {
        return [
            {
                source: "/",
                destination: "/f/010/login",
                permanent: false,
            },
            {
                source: "/admin",
                destination: "/f/010/admin-home",
                permanent: false,
            },
            {
                source: "/f/010/home",
                destination: "/f/010/user-home",
                permanent: false,
            },
        ];
    },
    allowedDevOrigins: ["*"],
};

export default nextConfig;
