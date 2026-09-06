import { AppProvider } from "@/components/market/app-context";
import { AppShell } from "@/components/market/app-shell";

export default function Home() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
