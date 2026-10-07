import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LiquidGlassEnvironment } from "@/components/finch/LiquidGlassEnvironment";
import { TabBar } from "@/components/control-room/TabBar";
import { ThemePanel } from "@/components/control-room/ThemePanel";
import { ModesPanel } from "@/components/control-room/ModesPanel";
import { MemoryPanel } from "@/components/control-room/MemoryPanel";
import { PromptsPanel } from "@/components/control-room/PromptsPanel";
import { ResearchResourcesPanel } from "@/components/control-room/ResearchResourcesPanel";
import { OrganizerPanel } from "@/components/control-room/OrganizerPanel";
import { AboutPanel } from "@/components/control-room/AboutPanel";

export const Route = createFileRoute("/control-room")({
  head: () => ({
    meta: [
      { title: "Finch Control Room" },
      {
        name: "description",
        content: "Configure Finch's appearance, modes, memory, and system prompts.",
      },
      { property: "og:title", content: "Finch Control Room" },
      {
        property: "og:description",
        content: "Configure Finch's appearance, modes, memory, and system prompts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ControlRoom,
});

function ControlRoom() {
  const [activeTab, setActiveTab] = React.useState<
    "theme" | "modes" | "memory" | "prompts" | "resources" | "organizer" | "about"
  >("theme");

  const renderPanel = () => {
    switch (activeTab) {
      case "theme":
        return <ThemePanel />;
      case "modes":
        return <ModesPanel />;
      case "organizer":
        return <OrganizerPanel />;
      case "memory":
        return <MemoryPanel />;
      case "prompts":
        return <PromptsPanel />;
      case "resources":
        return <ResearchResourcesPanel />;
      case "about":
        return <AboutPanel />;
    }
  };

  return (
    <LiquidGlassEnvironment active={true}>
      <div className="relative w-full h-screen flex flex-col">
        <main className="min-h-0 flex-1 flex flex-col items-center px-4 py-16 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <h1 className="text-sm font-medium tracking-[0.2em] uppercase text-zinc-500 text-center mb-8">
            FINCH CONTROL ROOM
          </h1>

          <TabBar activeTab={activeTab} onChange={setActiveTab} />

          <div className="w-full max-w-[1100px] mt-8">
            <div className="bg-white/60 backdrop-blur-xl border border-white/40 rounded-2xl shadow-sm p-8 md:p-8 sm:p-6 xs:p-5">
              <div
                id="panel-theme"
                role="tabpanel"
                aria-labelledby="tab-theme"
                hidden={activeTab !== "theme"}
              >
                {renderPanel()}
              </div>
              <div
                id="panel-modes"
                role="tabpanel"
                aria-labelledby="tab-modes"
                hidden={activeTab !== "modes"}
              >
                {renderPanel()}
              </div>
              <div
                id="panel-organizer"
                role="tabpanel"
                aria-labelledby="tab-organizer"
                hidden={activeTab !== "organizer"}
              >
                {renderPanel()}
              </div>
              <div
                id="panel-memory"
                role="tabpanel"
                aria-labelledby="tab-memory"
                hidden={activeTab !== "memory"}
              >
                {renderPanel()}
              </div>
              <div
                id="panel-prompts"
                role="tabpanel"
                aria-labelledby="tab-prompts"
                hidden={activeTab !== "prompts"}
              >
                {renderPanel()}
              </div>
              <div
                id="panel-resources"
                role="tabpanel"
                aria-labelledby="tab-resources"
                hidden={activeTab !== "resources"}
              >
                {renderPanel()}
              </div>
              <div
                id="panel-about"
                role="tabpanel"
                aria-labelledby="tab-about"
                hidden={activeTab !== "about"}
              >
                {renderPanel()}
              </div>
            </div>
          </div>
        </main>

        <footer className="flex justify-center pb-8">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            Back to Finch
          </Link>
        </footer>
      </div>
    </LiquidGlassEnvironment>
  );
}
