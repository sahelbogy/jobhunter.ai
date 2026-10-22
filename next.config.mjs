/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["unpdf", "nodemailer"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*.e2b.app", "*.vercel.app", "localhost:3000"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
