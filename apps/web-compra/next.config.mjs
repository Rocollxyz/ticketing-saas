/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Incrustación: SOLO las rutas /embed/* se pueden meter en un iframe de otra web (la del
  // promotor). El resto de la tienda lo prohíbe: nadie puede envolver la compra en una
  // web falsa (clickjacking). Futuro: limitar /embed a los dominios que declare el promotor.
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        source: "/((?!embed/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
