import { FloatingInformation } from "./FloatingInformation";
import type { ResearchItem } from "@/types/mode";
import "./researchCardImage.css";

export function GlassResearchField({
  items,
  onSelect,
}: {
  items: ResearchItem[];
  onSelect: (item: ResearchItem) => void;
}) {
  return (
    <div className="research-field">
      <svg
        className="research-connections"
        viewBox="0 0 1000 700"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M160 160 C340 90 430 270 510 340 S730 260 850 150" />
        <path d="M120 520 C300 620 430 410 510 340 S720 510 880 540" />
        <path d="M510 340 C540 170 680 110 850 150" />
      </svg>
      {items.map((item) => (
        <FloatingInformation
          key={item.id}
          className={item.position}
          depth={item.depth}
          onClick={() => onSelect(item)}
        >
          {item.image && (
            <img
              src={item.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="research-card-image"
            />
          )}
          <p className="information-category">{item.category}</p>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </FloatingInformation>
      ))}
    </div>
  );
}
