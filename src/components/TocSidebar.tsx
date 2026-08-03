import type { TocEntry } from "../lib/toc";

interface TocSidebarProps {
  entries: TocEntry[];
  currentPage: number;
  onSelect: (pageNumber: number) => void;
}

export function TocSidebar({ entries, currentPage, onSelect }: TocSidebarProps) {
  if (entries.length === 0) {
    return <p className="toc-empty">No table of contents found.</p>;
  }

  return (
    <nav className="toc-sidebar">
      <ul>
        {entries.map((entry, index) => (
          <li
            key={`${entry.pageNumber}-${index}`}
            style={{ paddingLeft: `${entry.level * 12}px` }}
          >
            <button
              className={entry.pageNumber === currentPage ? "toc-active" : ""}
              onClick={() => onSelect(entry.pageNumber)}
            >
              {entry.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
