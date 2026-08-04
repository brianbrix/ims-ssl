import { useEffect, useMemo, useState } from "react";
import { listLessons, type Lesson } from "../api/lessons";
import { deleteNote, listNotes, saveNote, type ReaderNote } from "../lib/notesStore";

const AUTOSAVE_DELAY_MS = 700;

function newNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function createBlankNote(): ReaderNote {
  const now = new Date().toISOString();
  return {
    id: newNoteId(),
    title: "Untitled note",
    body: "",
    lessonId: null,
    lessonTitle: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function upsertSorted(notes: ReaderNote[], note: ReaderNote): ReaderNote[] {
  const without = notes.filter((item) => item.id !== note.id);
  return [note, ...without].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getLessonLabel(lesson: Lesson): string {
  if (lesson.period?.trim()) return lesson.period.trim();
  const fallback = [lesson.year, lesson.quarter].filter(Boolean).join(" ").trim();
  return fallback || lesson.title;
}

export function NotesPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");

  useEffect(() => {
    let cancelled = false;

    Promise.all([listLessons().catch(() => []), listNotes()])
      .then(([lessonItems, noteItems]) => {
        if (cancelled) return;
        setLessons(lessonItems);
        setNotes(noteItems);
        setSelectedId(noteItems[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load notes.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId]
  );

  const lessonLabelById = useMemo(() => {
    const map = new Map<string, string>();
    lessons.forEach((lesson) => {
      map.set(lesson.id, getLessonLabel(lesson));
    });
    return map;
  }, [lessons]);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return notes;

    return notes.filter((note) => {
      const linkedLessonLabel =
        (note.lessonId ? lessonLabelById.get(note.lessonId) : null) || note.lessonTitle || "";
      const haystack = [
        note.title,
        note.body,
        linkedLessonLabel,
        note.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [notes, search, lessonLabelById]);

  useEffect(() => {
    if (!selectedNote) return;

    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      void saveNote(selectedNote)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [selectedNote]);

  function updateSelectedNote(update: (note: ReaderNote) => ReaderNote) {
    if (!selectedNote) return;
    const next = update({ ...selectedNote, updatedAt: new Date().toISOString() });
    setNotes((current) => upsertSorted(current, next));
  }

  function handleLessonChange(nextLessonId: string) {
    const lesson = lessons.find((item) => item.id === nextLessonId) ?? null;
    const lessonLabel = lesson ? getLessonLabel(lesson) : null;
    updateSelectedNote((note) => ({
      ...note,
      lessonId: lesson?.id ?? null,
      lessonTitle: lessonLabel,
      title:
        note.title === "Untitled note" && lesson
          ? `${lessonLabel} notes`
          : note.title,
    }));
  }

  function createNote() {
    const note = createBlankNote();
    setNotes((current) => upsertSorted(current, note));
    setSelectedId(note.id);
  }

  function removeSelectedNote() {
    if (!selectedNote) return;
    const deletedId = selectedNote.id;
    setNotes((current) => current.filter((item) => item.id !== deletedId));
    setSelectedId((currentId) => (currentId === deletedId ? null : currentId));
    void deleteNote(deletedId);
  }

  if (isLoading) return <p className="page-message">Loading notes…</p>;
  if (error) return <p className="page-message error">{error}</p>;

  return (
    <section className="notes-page" aria-labelledby="notes-title">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-top">
          <h2 id="notes-title">My Notes</h2>
          <button type="button" onClick={createNote}>
            New note
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          className="notes-search"
        />

        <div className="notes-list">
          {filteredNotes.length === 0 && <p className="notes-empty">No notes yet.</p>}
          {filteredNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`notes-item ${note.id === selectedId ? "notes-item-active" : ""}`}
              onClick={() => setSelectedId(note.id)}
            >
              <strong>{note.title || "Untitled note"}</strong>
              <span>
                {(note.lessonId ? lessonLabelById.get(note.lessonId) : null) ||
                  note.lessonTitle ||
                  "General note"}
              </span>
              <small>{new Date(note.updatedAt).toLocaleString()}</small>
            </button>
          ))}
        </div>
      </aside>

      <div className="notes-editor-wrap">
        {!selectedNote && (
          <div className="notes-empty-editor">
            <p>Select a note, or create a new one.</p>
          </div>
        )}

        {selectedNote && (
          <article className="notes-editor">
            <div className="notes-editor-top">
              <input
                type="text"
                value={selectedNote.title}
                onChange={(event) =>
                  updateSelectedNote((note) => ({ ...note, title: event.target.value }))
                }
                placeholder="Note title"
                className="notes-title-input"
              />
              <button type="button" className="notes-delete" onClick={removeSelectedNote}>
                Delete
              </button>
            </div>

            <label>
              Lesson
              <select
                value={selectedNote.lessonId || ""}
                onChange={(event) => handleLessonChange(event.target.value)}
              >
                <option value="">General note (not linked to a lesson)</option>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {getLessonLabel(lesson)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Tags (comma separated)
              <input
                type="text"
                value={selectedNote.tags.join(", ")}
                onChange={(event) => {
                  const tags = event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean);
                  updateSelectedNote((note) => ({ ...note, tags }));
                }}
                placeholder="example: memory verse, week 5"
              />
            </label>

            <label>
              Content
              <textarea
                value={selectedNote.body}
                onChange={(event) =>
                  updateSelectedNote((note) => ({ ...note, body: event.target.value }))
                }
                placeholder="Write your notes here..."
              />
            </label>

            <p className={`notes-status notes-status-${saveStatus}`}>
              {saveStatus === "saving" && "Saving..."}
              {saveStatus === "saved" && "Saved"}
              {saveStatus === "error" && "Could not save. Changes remain in this tab."}
            </p>
          </article>
        )}
      </div>
    </section>
  );
}
