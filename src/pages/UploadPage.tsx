import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminToken, setAdminToken, uploadLesson } from "../api/lessons";

export function UploadPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("");
  const [year, setYear] = useState("");
  const [quarter, setQuarter] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState(getAdminToken());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Please choose a PDF file.");
      return;
    }

    setAdminToken(token);
    setIsSubmitting(true);
    setError(null);
    try {
      const lesson = await uploadLesson(file, title, period, year, quarter);
      navigate(`/lesson/${lesson.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <h2>Upload a lesson</h2>

      <label>
        Admin passcode
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
      </label>

      <label>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Sabbath School Lessons"
        />
      </label>

      <label>
        Period
        <input
          type="text"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="e.g. Second Half 2026"
        />
      </label>

      <label>
        Year
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="e.g. 2026"
        />
      </label>

      <label>
        Quarter
        <input
          type="text"
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
          placeholder="e.g. 1 & 2 quarter"
        />
      </label>

      <label>
        PDF file
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
