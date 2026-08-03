import type { ChangeEvent } from "react";

interface FileDropProps {
  onFileSelected: (file: File) => void;
}

export function FileDrop({ onFileSelected }: FileDropProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <label className="file-drop">
      <input type="file" accept="application/pdf" onChange={handleChange} />
      <span>Upload a PDF to get started</span>
    </label>
  );
}
