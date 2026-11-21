import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirectThrow } from "@/lib/route-redirect";

export const Route = createFileRoute("/campanas")({
  beforeLoad: () => {
    legacyRedirectThrow("/campanas");
  },
});
