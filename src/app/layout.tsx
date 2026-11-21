import Header from "@/components/Header";
import "./ui.css";

export const metadata = { title: "brim-ap" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
