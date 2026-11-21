import Header from "@/components/Header";
import { CurrentUserProvider } from "@/components/CurrentUser";
import { DATA_AS_OF } from "@/components/ui";
import "./ui.css";

export const metadata = { title: "Harborline AP" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CurrentUserProvider>
          <Header />
          {children}
        </CurrentUserProvider>
        <footer className="footer">Harborline AP · demo data as of {DATA_AS_OF} · amounts in the invoice currency unless marked CAD</footer>
      </body>
    </html>
  );
}
