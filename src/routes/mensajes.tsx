import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RealChatsPage } from "@/features/real-chats";

export const Route = createFileRoute("/mensajes")({
  component: () => (
    <AppShell bleed>
      <RealChatsPage />
    </AppShell>
  ),
});
