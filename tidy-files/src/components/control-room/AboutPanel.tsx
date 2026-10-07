const STORY = [
  "It started with a movie.",
  "I watched Finch and became fascinated by the relationship between a person and a robot companion. The robot wasn't just a machine built to perform tasks. It was something that could learn, communicate, help, and simply be there.",
  "That idea stayed with me.",
  "I started wondering—what if something like that could exist in real life?",
  "Not as a huge commercial product. Not as another AI service that collects everything about you.",
  "Just a personal companion that lives on your own computer.",
  "That thought became Finch.",
  "The first version is a small beginning: a local AI companion with voice conversation, text, search, research, planning, and support for different open-source AI models.",
  "The idea is simple:",
  "Build an AI that feels personal, stays as local as possible, and gives you control over how it works.",
  "Finch is still young. Version 1 is not meant to be perfect.",
  "It's the beginning of an experiment—to see how far a personal, local AI companion can grow.",
  "And maybe, one day, that idea from a movie won't feel so far away anymore.",
];

// Hardcoded: tidy-files/package.json has no version field (the Electron
// package.json carries 1.0.0, but the web bundle doesn't ship it).
const VERSION = "1.0.0";

export function AboutPanel() {
  return (
    <div className="space-y-6">
      <section className="space-y-3 p-4 bg-white/30 border border-white/40 rounded-xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/finch.ico" alt="" className="size-10" />
          <h2 className="text-lg font-semibold text-zinc-900">Finch</h2>
          <p className="text-xs text-zinc-500">Version {VERSION}</p>
        </div>
      </section>

      <section className="space-y-4 p-4 bg-white/30 border border-white/40 rounded-xl">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">The Story Behind Finch</h2>
        <div className="space-y-4">
          {STORY.map((paragraph) => (
            <p key={paragraph} className="text-[0.95rem] leading-[1.65] text-zinc-900">
              {paragraph}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
