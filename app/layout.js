import "./globals.css";

export const metadata = {
  title: "C.R.B. Automotores | Presupuestos",
  description: "Creación e impresión de presupuestos de C.R.B. Automotores.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
